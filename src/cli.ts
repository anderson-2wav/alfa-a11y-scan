// Copyright (C) 2026 2wav inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.
//
// For commercial licensing, contact 2wav — https://2wav.com

import { promises as fs } from "fs";
import { resolve as resolvePath } from "path";
import readline from "readline";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { chromium } from "playwright";
import pLimit from "p-limit";
import { fetchSitemapUrls } from "./sitemap.js";
import { auditUrl } from "./run-audit.js";
import { buildReport, writeReport, formatDuration } from "./report.js";
import type { CliOptions, PageResult } from "./types.js";

const argv = await yargs(hideBin(process.argv))
  .scriptName("sitemap-checker")
  .usage("Usage: $0 [sitemap-url] [options]")
  .option("output", {
    alias: "o",
    type: "string",
    describe: "Output file path without extension (default: ./report; OUTPUT env var)",
  })
  .option("name", {
    type: "string",
    describe: "Site name; prefixes the report title as \"<name> Accessibility Scan Report\" (NAME env var)",
  })
  .option("format", {
    alias: "f",
    choices: ["csv", "xlsx", "json", "html"] as const,
    default: "csv" as const,
    describe: "Output format",
  })
  .option("engine", {
    choices: ["alfa", "opena11y", "both"] as const,
    describe: "Accessibility engine: alfa, opena11y, or both (default: alfa)",
  })
  .option("concurrency", {
    alias: "c",
    type: "number",
    describe: "Number of pages to check in parallel",
  })
  .option("filter", {
    type: "string",
    describe: "Regex to filter URLs from sitemap",
  })
  .option("timeout", {
    type: "number",
    default: 30000,
    describe: "Page load timeout in ms",
  })
  .option("wait", {
    type: "number",
    default: 2000,
    describe: "Additional wait after load in ms",
  })
  .option("pause", {
    type: "number",
    default: 0,
    describe: "Delay between page loads in ms (rate limiting)",
  })
  .option("wcag-level", {
    choices: ["a", "aa", "aaa"] as const,
    default: "aa" as const,
    describe: "WCAG conformance level (default: WCAG 2.1 AA)",
  })
  .option("aria", {
    type: "boolean",
    describe: "Include WAI-ARIA authoring practice rules (default: true, matches Siteimprove scanner; INCLUDE_ARIA env)",
  })
  .option("verbose", {
    alias: "v",
    type: "boolean",
    default: false,
    describe: "Print progress to console",
  })
  .option("urls", {
    type: "string",
    describe: "Path to a JSON file containing an array of URLs to audit directly (bypasses sitemap)",
  })
  .option("base-url", {
    type: "string",
    describe: "Base URL (with scheme) prepended to relative paths in the URL file, e.g. https://example.com",
  })
  .option("jwt-token", {
    type: "string",
    describe: "JWT token to inject as a cookie on all page requests",
  })
  .option("jwt-cookie-name", {
    type: "string",
    default: "token",
    describe: "Cookie name for the JWT token (default: token)",
  })
  .option("capture-console", {
    type: "boolean",
    default: false,
    describe: "Capture browser console output (log, warn, error) per page",
  })
  .option("retry", {
    type: "number",
    default: 0,
    describe: "Number of times to retry a page if it errors or has violations (default: 0)",
  })
  .option("stop-on-fail", {
    type: "boolean",
    default: false,
    describe: "Stop scanning after the first page error or violation and write a partial report",
  })
  .option("only-rules", {
    type: "string",
    describe: "Comma-separated rule IDs to include (all others are excluded), e.g. sia-r55,sia-r81",
  })
  .option("warnings-alfa", {
    type: "boolean",
    describe: "Include Alfa cantTell results (needs-review warnings) in the report (default: true)",
  })
  .option("warnings-opena11y", {
    type: "boolean",
    describe: "Include OpenA11Y manual checks/warnings (cantTell) in the report (default: false)",
  })
  .option("console-log-file", {
    type: "string",
    describe: "File path to write browser console output (relative paths resolve to cwd)",
  })
  .check((argv) => {
    const hasSitemap = argv._.length > 0 || !!process.env.SITEMAP;
    const hasUrls = !!(argv.urls || process.env.URLS);
    if (!hasSitemap && !hasUrls)
      throw new Error("Provide a sitemap URL (positional or SITEMAP env var) or --urls / URLS env var (path to JSON file).");
    return true;
  })
  .help()
  .parseAsync();

const options: CliOptions = {
  sitemapUrl: argv._.length > 0 ? String(argv._[0]) : process.env.SITEMAP,
  urlsFile: argv.urls ?? process.env.URLS,
  baseUrl: argv["base-url"] ?? process.env.BASE_URL,
  name: argv.name ?? process.env.NAME,
  output: argv.output ?? process.env.OUTPUT ?? "./report",
  format: argv.format,
  engine: (() => {
    const raw = argv.engine ?? process.env.ENGINE ?? "alfa";
    if (raw !== "alfa" && raw !== "opena11y" && raw !== "both")
      throw new Error(`Invalid ENGINE "${raw}" — expected "alfa", "opena11y", or "both".`);
    return raw;
  })(),
  concurrency: argv.concurrency ?? Number(process.env.CONCURRENCY ?? 3),
  filter: argv.filter ?? process.env.FILTER,
  timeout: argv.timeout,
  wait: argv.wait,
  pause: argv.pause,
  wcagLevel: argv["wcag-level"],
  includeAria: argv.aria ?? (process.env.INCLUDE_ARIA !== "false"),
  verbose: argv.verbose,
  ignoreRules: process.env.IGNORE_RULES
    ? process.env.IGNORE_RULES.split(",").map((r) => r.trim()).filter(Boolean)
    : [],
  onlyRules: (() => {
    const raw = argv["only-rules"] ?? process.env.ONLY_RULES;
    return raw ? raw.split(",").map((r) => r.trim()).filter(Boolean) : [];
  })(),
  // Precedence: CLI flag > env var > hardcoded default. Alfa cantTell warnings
  // are useful and default on; OpenA11Y manual checks are voluminous and default off.
  showWarningsAlfa:
    argv["warnings-alfa"] ??
    (process.env.WARNINGS_ALFA !== undefined ? process.env.WARNINGS_ALFA === "true" : true),
  showWarningsOpena11y:
    argv["warnings-opena11y"] ??
    (process.env.WARNINGS_OPENA11Y !== undefined ? process.env.WARNINGS_OPENA11Y === "true" : false),
  jwtToken: argv["jwt-token"] ?? process.env.JWT_TOKEN,
  jwtCookieName: argv["jwt-cookie-name"] ?? process.env.JWT_COOKIE_NAME ?? "token",
  consoleLogFile: (() => {
    const raw = argv["console-log-file"] ?? process.env.CONSOLE_LOG_FILE;
    return raw ? resolvePath(raw) : undefined;
  })(),
  captureConsole: !!(argv["capture-console"] || process.env.CAPTURE_CONSOLE === "true" || argv["console-log-file"] || process.env.CONSOLE_LOG_FILE),
  retry: argv.retry ?? Number(process.env.RETRY ?? 0),
  stopOnFail: argv["stop-on-fail"] || process.env.STOP_ON_FAIL === "true",
};

function askQuestion(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => { rl.close(); resolve(answer); });
    rl.on("close", () => resolve(""));
  });
}

async function main(): Promise<void> {
  let urls: string[];
  let sourceUrl: string;

  if (options.urlsFile) {
    let raw: string;
    try {
      raw = await fs.readFile(options.urlsFile, "utf-8");
    } catch (err) {
      console.error(`Failed to read URL file: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(`${options.urlsFile} is not valid JSON.`);
      process.exit(1);
    }
    if (!Array.isArray(parsed) || !parsed.every((u) => typeof u === "string")) {
      console.error(`${options.urlsFile} must contain a JSON array of strings.`);
      process.exit(1);
    }
    const base = options.baseUrl?.replace(/\/$/, "") ?? "";
    urls = [...new Set(
      (parsed as string[])
        .filter((u) => !u.startsWith("//") && !u.startsWith("#"))
        .map((u) => u.startsWith("http") ? u : `${base}${u}`)
    )];
    sourceUrl = `direct URLs from ${options.urlsFile} (${urls.length} provided)`;
    if (options.filter) console.warn("Warning: --filter is ignored when --urls is provided.");
    console.log(`Loaded ${urls.length} URL${urls.length === 1 ? "" : "s"} from ${options.urlsFile}`);
  } else {
    sourceUrl = options.sitemapUrl!;
    console.log(`Fetching sitemap: ${sourceUrl}`);
    try {
      urls = await fetchSitemapUrls(sourceUrl, options.filter, {
        jwtToken: options.jwtToken,
        jwtCookieName: options.jwtCookieName,
      });
    } catch (err) {
      console.error(`Failed to fetch sitemap: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
    if (urls.length === 0) {
      console.error("No URLs found in sitemap (filter may be too restrictive).");
      process.exit(1);
    }
    console.log(
      `Found ${urls.length} URL${urls.length === 1 ? "" : "s"}${options.filter ? ` (filtered by /${options.filter}/)` : ""}`
    );
  }

  console.log(`Starting audit with engine=${options.engine} concurrency=${options.concurrency}...\n`);

  if (options.consoleLogFile) {
    await fs.writeFile(options.consoleLogFile, `Scan started: ${new Date().toISOString()}\nSource: ${sourceUrl}\n\n`);
    console.log(`Browser console log: ${options.consoleLogFile}\n`);
  }

  const scanStart = Date.now();
  const browser = await chromium.launch({ headless: true });
  const limit = pLimit(options.concurrency);
  const results: PageResult[][] = new Array(urls.length);
  let completed = 0;
  let stopFlag = false;
  let interrupted = false;

  const handleSigint = () => {
    if (interrupted) {
      process.stdout.write("\nForce exit.\n");
      process.exit(1);
    }
    interrupted = true;
    stopFlag = true;
    process.stdout.write("\n\n^C received — finishing in-flight pages (^C again to force exit)...\n");
  };
  process.on("SIGINT", handleSigint);

  const tasks = urls.map((url, index) =>
    limit(async () => {
      if (stopFlag) return;

      if (options.verbose) {
        process.stdout.write(`[${index + 1}/${urls.length}] Checking: ${url}\n`);
      }
      const pageResults = await auditUrl(browser, url, options);
      results[index] = pageResults;
      completed++;

      if (options.consoleLogFile) {
        for (const result of pageResults) {
          const header = `=== [${result.engine}] ${result.url} ===\n`;
          const messages = result.consoleMessages.length > 0
            ? result.consoleMessages.map((m) => `[${m.type}] ${m.text}`).join("\n") + "\n"
            : "";
          await fs.appendFile(options.consoleLogFile, header + messages + "\n");
        }
      }

      const failed = pageResults.find(
        (r) => r.status === "error" || r.violations.length > 0,
      );
      if (options.stopOnFail && failed) {
        stopFlag = true;
        console.log(`\nStopping scan: ${failed.status === "error" ? "page error" : "violations found"} on ${url}`);
      }

      if (options.pause > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.pause));
      }

      if (!options.verbose && completed % 10 === 0) {
        process.stdout.write(`  Progress: ${completed}/${urls.length}\n`);
      }

      return pageResults;
    })
  );

  await Promise.all(tasks);
  await browser.close();
  process.removeListener("SIGINT", handleSigint);

  const completedResults: PageResult[] = results
    .filter((r): r is PageResult[] => r !== undefined)
    .flat();

  if (interrupted) {
    console.log(`\nScan interrupted. ${completedResults.length} of ${urls.length} pages completed.`);
    if (completedResults.length > 0) {
      const answer = await askQuestion("Write partial report? [y/N] ");
      if (answer.trim().toLowerCase().startsWith("y")) {
        const report = buildReport(completedResults, options, sourceUrl, Date.now() - scanStart);
        await writeReport(report, options);
        console.log(`Partial report written to: ${options.output}.${options.format}`);
      }
    }
    process.exit(0);
  }

  if (stopFlag) {
    console.log(`  Partial scan: ${completedResults.length} of ${urls.length} pages checked.\n`);
  }

  const report = buildReport(completedResults, options, sourceUrl, Date.now() - scanStart);

  await writeReport(report, options);

  const ext = options.format;
  const outputFile = `${options.output}.${ext}`;

  console.log(`\nScan complete!`);
  console.log(`  Elapsed time:               ${formatDuration(report.durationMs)}`);
  console.log(`  Pages checked:              ${report.summary.totalPages}`);
  console.log(`  Pages with errors:          ${report.summary.pagesWithErrors}`);
  console.log(`  Total violations (failed):  ${report.summary.totalViolations}`);
  console.log(`  Needs review (cantTell):    ${report.summary.totalCantTell}`);
  if (report.summary.violationsByRule.length > 0) {
    console.log(`\n  Top violations:`);
    for (const v of report.summary.violationsByRule.slice(0, 5)) {
      console.log(`    ${v.ruleId.padEnd(12)} ${v.count.toString().padStart(4)}x  ${v.ruleTitle}`);
    }
  }
  console.log(`\n  Report written to: ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
