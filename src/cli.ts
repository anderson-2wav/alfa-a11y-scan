// Copyright (c) 2026 2wav inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

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
  .usage("Usage: $0 <sitemap-url> [options]")
  .demandCommand(1, "Please provide a sitemap URL as the first argument.")
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
  .help()
  .parseAsync();

const sitemapUrl = String(argv._[0]);

const options: CliOptions = {
  sitemapUrl,
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
};

async function main(): Promise<void> {
  console.log(`Fetching sitemap: ${sitemapUrl}`);
  let urls: string[];
  try {
    urls = await fetchSitemapUrls(sitemapUrl, options.filter);
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

  const report = buildReport(results, options);

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
