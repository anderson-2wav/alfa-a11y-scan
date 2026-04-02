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
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { chromium } from "playwright";
import pLimit from "p-limit";
import { fetchSitemapUrls } from "./sitemap.js";
import { auditPage } from "./auditor.js";
import { buildReport, writeReport } from "./report.js";
import type { CliOptions, PageResult } from "./types.js";

const argv = await yargs(hideBin(process.argv))
  .scriptName("sitemap-checker")
  .usage("Usage: $0 [sitemap-url] [options]")
  .option("output", {
    alias: "o",
    type: "string",
    default: "./report",
    describe: "Output file path (without extension)",
  })
  .option("format", {
    alias: "f",
    choices: ["csv", "xlsx", "json", "html"] as const,
    default: "csv" as const,
    describe: "Output format",
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
  .check((argv) => {
    const hasSitemap = argv._.length > 0;
    const hasUrls = !!(argv.urls || process.env.URLS);
    if (!hasSitemap && !hasUrls)
      throw new Error("Provide a sitemap URL (positional) or --urls / URLS env var (path to JSON file).");
    return true;
  })
  .help()
  .parseAsync();

const options: CliOptions = {
  sitemapUrl: argv._.length > 0 ? String(argv._[0]) : undefined,
  urlsFile: argv.urls ?? process.env.URLS,
  baseUrl: argv["base-url"] ?? process.env.BASE_URL,
  output: argv.output,
  format: argv.format,
  concurrency: argv.concurrency ?? Number(process.env.CONCURRENCY ?? 3),
  filter: argv.filter ?? process.env.FILTER,
  timeout: argv.timeout,
  wait: argv.wait,
  pause: argv.pause,
  wcagLevel: argv["wcag-level"],
  verbose: argv.verbose,
  ignoreRules: process.env.IGNORE_RULES
    ? process.env.IGNORE_RULES.split(",").map((r) => r.trim()).filter(Boolean)
    : [],
  showWarnings: process.env.WARNINGS === "true",
  jwtToken: argv["jwt-token"] ?? process.env.JWT_TOKEN,
  jwtCookieName: argv["jwt-cookie-name"] ?? process.env.JWT_COOKIE_NAME ?? "token",
};

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

  console.log(`Starting audit with concurrency=${options.concurrency}...\n`);

  const browser = await chromium.launch({ headless: true });
  const limit = pLimit(options.concurrency);
  const results: PageResult[] = new Array(urls.length);
  let completed = 0;

  const tasks = urls.map((url, index) =>
    limit(async () => {
      if (options.verbose) {
        process.stdout.write(`[${index + 1}/${urls.length}] Checking: ${url}\n`);
      }
      const result = await auditPage(browser, url, options);
      results[index] = result;
      completed++;

      if (options.pause > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.pause));
      }

      if (!options.verbose && completed % 10 === 0) {
        process.stdout.write(`  Progress: ${completed}/${urls.length}\n`);
      }

      return result;
    })
  );

  await Promise.all(tasks);
  await browser.close();

  const report = buildReport(results, options, sourceUrl);

  await writeReport(report, options);

  const ext = options.format;
  const outputFile = `${options.output}.${ext}`;

  console.log(`\nScan complete!`);
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
