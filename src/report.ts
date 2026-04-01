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

import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import ExcelJS from "exceljs";
import type { AuditReport, CliOptions, PageResult, ViolationRecord } from "./types.js";

export function buildReport(pages: PageResult[], options: CliOptions): AuditReport {
  const allViolations = pages.flatMap((p) => p.violations);

  const ruleCounts = new Map<string, { ruleTitle: string; count: number }>();
  for (const v of allViolations) {
    if (v.outcome === "failed") {
      const existing = ruleCounts.get(v.ruleId);
      if (existing) {
        existing.count++;
      } else {
        ruleCounts.set(v.ruleId, { ruleTitle: v.ruleTitle, count: 1 });
      }
    }
  }

  const violationsByRule = [...ruleCounts.entries()]
    .map(([ruleId, { ruleTitle, count }]) => ({ ruleId, ruleTitle, count }))
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    sitemapUrl: options.sitemapUrl,
    options,
    summary: {
      totalPages: pages.length,
      pagesWithErrors: pages.filter((p) => p.status === "error").length,
      totalViolations: allViolations.filter((v) => v.outcome === "failed").length,
      totalCantTell: allViolations.filter((v) => v.outcome === "cantTell").length,
      violationsByRule,
    },
    pages,
  };
}

export async function writeReport(report: AuditReport, options: CliOptions): Promise<void> {
  switch (options.format) {
    case "csv":
      return writeCSV(report, options.output);
    case "xlsx":
      return writeXLSX(report, options.output);
    case "json":
      return writeJSON(report, options.output);
    case "html":
      return writeHTML(report, options.output);
  }
}

function escapeCSV(value: string): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCSV(values: string[]): string {
  return values.map(escapeCSV).join(",");
}

async function writeCSV(report: AuditReport, outputPath: string): Promise<void> {
  const headers = [
    "URL",
    "Rule ID",
    "Rule Title",
    "WCAG Criteria",
    "WCAG Level",
    "Outcome",
    "Element XPath",
    "Element Tag",
    "Element HTML",
    "Diagnostic Message",
    "How To Fix",
  ];

  const rows: string[] = [rowToCSV(headers)];

  for (const page of report.pages) {
    if (page.status === "error") {
      rows.push(
        rowToCSV([
          page.url,
          "ERROR",
          page.errorMessage ?? "",
          "",
          "",
          "error",
          "",
          "",
          "",
          "",
        ])
      );
      continue;
    }
    if (page.violations.length === 0) {
      rows.push(rowToCSV([page.url, "", "", "", "", "passed", "", "", "", "", ""]));
      continue;
    }
    for (const v of page.violations) {
      rows.push(
        rowToCSV([
          v.pageUrl,
          v.ruleId,
          v.ruleTitle,
          v.wcagCriteria,
          v.wcagLevel,
          v.outcome,
          v.elementXPath,
          v.elementTag,
          v.elementHtml,
          v.diagnosticMessage,
          v.howToFixUrl,
        ])
      );
    }
  }

  await writeFile(`${outputPath}.csv`, rows.join("\n"), "utf-8");
}

async function writeXLSX(report: AuditReport, outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Siteimprove Sitemap Checker";
  workbook.created = new Date();

  // Summary sheet
  const summarySheet = workbook.addWorksheet("Summary");
  const s = report.summary;

  summarySheet.addRow(["Generated", report.generatedAt]);
  summarySheet.addRow(["Sitemap URL", report.sitemapUrl]);
  summarySheet.addRow(["WCAG Level", formatWcagLevel(report.options.wcagLevel)]);
  summarySheet.addRow([]);
  summarySheet.addRow([
    "About",
    "This report was generated using Siteimprove Alfa, an open-source accessibility code checker. " +
    "Each page is evaluated in a fully-rendered headless browser so client-side JavaScript executes " +
    "before analysis, producing results that reflect the actual DOM seen by assistive technologies.",
  ]);
  summarySheet.getColumn(2).width = 90;
  summarySheet.getRow(5).alignment = { wrapText: true };
  summarySheet.getRow(5).height = 48;
  summarySheet.addRow([]);
  summarySheet.addRow(["Total Pages", s.totalPages]);
  summarySheet.addRow(["Pages With Errors", s.pagesWithErrors]);
  summarySheet.addRow(["Total Violations (failed)", s.totalViolations]);
  summarySheet.addRow(["Total CantTell", s.totalCantTell]);
  summarySheet.addRow([]);
  summarySheet.addRow(["Most Common Violations"]);

  const headerRow = summarySheet.addRow(["Rule ID", "Rule Title", "Count"]);
  headerRow.font = { bold: true };
  for (const v of s.violationsByRule.slice(0, 20)) {
    summarySheet.addRow([v.ruleId, v.ruleTitle, v.count]);
  }
  summarySheet.getColumn(1).width = 15;
  summarySheet.getColumn(2).width = 50;
  summarySheet.getColumn(3).width = 10;

  // Results sheet
  const sheet = workbook.addWorksheet("Results");
  sheet.columns = [
    { header: "URL", key: "pageUrl", width: 55 },
    { header: "Rule ID", key: "ruleId", width: 12 },
    { header: "Rule Title", key: "ruleTitle", width: 45 },
    { header: "WCAG Criteria", key: "wcagCriteria", width: 16 },
    { header: "WCAG Level", key: "wcagLevel", width: 11 },
    { header: "Outcome", key: "outcome", width: 10 },
    { header: "Element XPath", key: "elementXPath", width: 65 },
    { header: "Element Tag", key: "elementTag", width: 12 },
    { header: "Element HTML", key: "elementHtml", width: 80 },
    { header: "Diagnostic Message", key: "diagnosticMessage", width: 75 },
    { header: "How To Fix", key: "howToFixUrl", width: 55 },
  ];

  const xlsxHeader = sheet.getRow(1);
  xlsxHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  xlsxHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003057" } };

  for (const page of report.pages) {
    if (page.status === "error") continue; // covered by Errors sheet
    if (page.violations.length === 0) {
      const row = sheet.addRow({ pageUrl: page.url, outcome: "passed" });
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6F5D6" } };
    } else {
      for (const v of page.violations) {
        const row = sheet.addRow(v);
        if (v.outcome === "failed") {
          row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFDCDC" } };
        } else {
          row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8CC" } };
        }
      }
    }
  }

  // Error pages sheet
  const errorPages = report.pages.filter((p) => p.status === "error");
  if (errorPages.length > 0) {
    const errSheet = workbook.addWorksheet("Errors");
    errSheet.columns = [
      { header: "URL", key: "url", width: 70 },
      { header: "Error", key: "errorMessage", width: 80 },
    ];
    const errHeader = errSheet.getRow(1);
    errHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
    errHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003057" } };
    for (const p of errorPages) {
      errSheet.addRow({ url: p.url, errorMessage: p.errorMessage ?? "" });
    }
  }

  await workbook.xlsx.writeFile(`${outputPath}.xlsx`);
}

async function writeJSON(report: AuditReport, outputPath: string): Promise<void> {
  await writeFile(`${outputPath}.json`, JSON.stringify(report, null, 2), "utf-8");
}

async function writeHTML(report: AuditReport, outputPath: string): Promise<void> {
  const logoPath = join(dirname(fileURLToPath(import.meta.url)), "../images/2wav-logo-dark.svg");
  const logoBase64 = await readFile(logoPath, "base64").catch(() => "");
  const logoDataUri = logoBase64 ? `data:image/svg+xml;base64,${logoBase64}` : "";

  const s = report.summary;

  const summaryCards = `
    <div class="summary-grid">
      <div class="card">
        <div class="card-value">${s.totalPages}</div>
        <div class="card-label">Pages Scanned</div>
      </div>
      <div class="card ${s.pagesWithErrors > 0 ? "card--error" : ""}">
        <div class="card-value">${s.pagesWithErrors}</div>
        <div class="card-label">Pages With Errors</div>
      </div>
      <div class="card ${s.totalViolations > 0 ? "card--error" : "card--good"}">
        <div class="card-value">${s.totalViolations}</div>
        <div class="card-label">Total Violations (failed)</div>
      </div>
      ${report.options.showWarnings ? `<div class="card ${s.totalCantTell > 0 ? "card--warn" : ""}">
        <div class="card-value">${s.totalCantTell}</div>
        <div class="card-label">Needs Review (cantTell)</div>
      </div>` : ""}
    </div>`;

  const topViolationsRows = s.violationsByRule
    .slice(0, 20)
    .map(
      (v) =>
        `<tr><td><a href="https://alfa.siteimprove.com/rules/${escapeHtml(v.ruleId)}" target="_blank">${escapeHtml(v.ruleId)}</a></td><td>${escapeHtml(v.ruleTitle)}</td><td>${v.count}</td></tr>`
    )
    .join("\n");

  const pageDetails = report.pages
    .map((page) => {
      const failCount = page.violations.filter((v) => v.outcome === "failed").length;
      const cantTellCount = page.violations.filter((v) => v.outcome === "cantTell").length;

      if (page.status === "error") {
        return `<details>
          <summary class="summary--error"><a href="${escapeHtml(page.url)}" target="_blank" onclick="event.stopPropagation()">${escapeHtml(page.url)}</a> <span class="tag tag--error">ERROR</span></summary>
          <div class="details-content"><p class="error-msg">${escapeHtml(page.errorMessage ?? "Unknown error")}</p></div>
        </details>`;
      }

      if (page.violations.length === 0) {
        return `<details>
          <summary class="summary--pass"><a href="${escapeHtml(page.url)}" target="_blank" onclick="event.stopPropagation()">${escapeHtml(page.url)}</a> <span class="tag tag--pass">0 issues</span></summary>
          <div class="details-content"><p class="no-issues">No violations found.</p></div>
        </details>`;
      }

      const violationRows = page.violations
        .map(
          (v) => `<tr class="${v.outcome === "failed" ? "failed" : "cant-tell"}">
            <td><a href="${escapeHtml(v.howToFixUrl)}" target="_blank">${escapeHtml(v.ruleId)}</a></td>
            <td>${escapeHtml(v.wcagCriteria)}</td>
            <td><span class="tag tag--${v.outcome === "failed" ? "failed" : "cant-tell"}">${v.outcome}</span></td>
            <td class="xpath">${escapeHtml(v.elementXPath)}</td>
            <td><code>${escapeHtml(v.elementTag)}</code></td>
            <td><pre class="html-snippet">${escapeHtml(v.elementHtml)}</pre></td>
            <td>${escapeHtml(v.diagnosticMessage)}</td>
          </tr>`
        )
        .join("\n");

      const label =
        failCount > 0
          ? `<span class="tag tag--failed">${failCount} failed</span>`
          : `<span class="tag tag--cant-tell">${cantTellCount} cantTell</span>`;

      return `<details>
        <summary><a href="${escapeHtml(page.url)}" target="_blank" onclick="event.stopPropagation()">${escapeHtml(page.url)}</a> ${label}${cantTellCount > 0 && failCount > 0 ? ` <span class="tag tag--cant-tell">${cantTellCount} cantTell</span>` : ""}</summary>
        <div class="details-content">
          <table>
            <thead><tr><th>Rule</th><th>WCAG</th><th>Outcome</th><th>XPath</th><th>Tag</th><th>Element HTML</th><th>Message</th></tr></thead>
            <tbody>${violationRows}</tbody>
          </table>
        </div>
      </details>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Accessibility Audit Report — ${escapeHtml(report.sitemapUrl)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; background: #f5f5f5; padding: 24px; }
    h1 { color: #003057; margin-bottom: 8px; font-size: 1.6em; }
    h2 { color: #003057; margin: 28px 0 12px; font-size: 1.2em; }
    .meta { color: #666; font-size: 0.85em; margin-bottom: 12px; }
    .about { color: #555; font-size: 0.85em; line-height: 1.6; margin-bottom: 24px; max-width: 800px; }
    .about a { color: #0066cc; }
    footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #ddd; color: #999; font-size: 0.8em; }
    .footer-logo { height: 36px; width: auto; display: block; margin-bottom: 8px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin-bottom: 32px; }
    .card { background: #fff; border-radius: 8px; padding: 18px; box-shadow: 0 2px 4px rgba(0,0,0,.08); }
    .card-value { font-size: 2em; font-weight: 700; color: #003057; }
    .card-label { color: #666; font-size: 0.85em; margin-top: 4px; }
    .card--error .card-value { color: #c0392b; }
    .card--warn .card-value { color: #d68910; }
    .card--good .card-value { color: #1e8449; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,.08); margin-bottom: 20px; font-size: 0.83em; }
    th { background: #003057; color: #fff; padding: 10px 12px; text-align: left; white-space: nowrap; }
    td { padding: 7px 12px; border-bottom: 1px solid #eee; vertical-align: top; }
    td:last-child, tr:last-child td { border-bottom: none; }
    .failed td { background: #fff0f0; }
    .cant-tell td { background: #fffbea; }
    .tag { display: inline-block; padding: 2px 7px; border-radius: 3px; font-size: 0.75em; font-weight: 700; white-space: nowrap; }
    .tag--failed { background: #c0392b; color: #fff; }
    .tag--cant-tell { background: #d68910; color: #fff; }
    .tag--error { background: #7f8c8d; color: #fff; }
    .tag--pass { background: #1e8449; color: #fff; }
    details { margin-bottom: 8px; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,.08); overflow: hidden; }
    details summary { padding: 13px 18px; cursor: pointer; font-size: 0.9em; color: #003057; background: #f8f9fa; list-style: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    details summary::before { content: "▶"; font-size: 0.7em; color: #999; flex-shrink: 0; }
    details[open] summary::before { content: "▼"; }
    details[open] summary { border-bottom: 1px solid #e5e5e5; }
    .details-content { overflow-x: auto; }
    .xpath { font-family: monospace; font-size: 0.78em; color: #555; word-break: break-all; max-width: 280px; }
    .html-snippet { font-family: monospace; font-size: 0.75em; background: #f4f4f4; border: 1px solid #ddd; border-radius: 4px; padding: 6px 8px; margin: 0; white-space: pre-wrap; word-break: break-all; max-width: 360px; max-height: 120px; overflow: auto; }
    code { background: #eee; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .error-msg { padding: 14px 18px; color: #c0392b; font-size: 0.9em; }
    .no-issues { padding: 14px 18px; color: #1e8449; font-size: 0.9em; }
    .summary--error { color: #c0392b !important; }
  </style>
</head>
<body>
  <h1>Accessibility Audit Report</h1>
  <p class="meta">
    Generated: ${escapeHtml(report.generatedAt)} &nbsp;|&nbsp;
    Sitemap: <a href="${escapeHtml(report.sitemapUrl)}" target="_blank">${escapeHtml(report.sitemapUrl)}</a> &nbsp;|&nbsp;
    WCAG Level: ${escapeHtml(formatWcagLevel(report.options.wcagLevel))}
  </p>
  <p class="about">
    This report was generated using the <a href="https://github.com/Siteimprove/alfa" target="_blank">Siteimprove Alfa</a>
    accessibility code checker. Each page is evaluated in a fully-rendered headless browser so that
    client-side JavaScript is executed before analysis — producing results that reflect the actual DOM
    seen by assistive technologies, rather than the raw HTML source. Rules are evaluated against
    WCAG ${escapeHtml(formatWcagLevel(report.options.wcagLevel))} success criteria.
  </p>

  ${summaryCards}

  <h2>Most Common Violations</h2>
  ${
    s.violationsByRule.length > 0
      ? `<table>
    <thead><tr><th>Rule ID</th><th>Rule Title</th><th>Count</th></tr></thead>
    <tbody>${topViolationsRows}</tbody>
  </table>`
      : "<p>No violations found.</p>"
  }

  <h2>Results by Page</h2>
  ${pageDetails}

  <footer>
    ${logoDataUri ? `<a href="https://2wav.com" target="_blank" aria-label="2wav inc."><img src="${logoDataUri}" alt="2wav inc." class="footer-logo"></a>` : ""}
    <p>&copy; 2026, 2wav inc. All Rights Reserved.</p>
  </footer>
</body>
</html>`;

  await writeFile(`${outputPath}.html`, html, "utf-8");
}

function formatWcagLevel(level: string): string {
  switch (level) {
    case "a":   return "2.0 A";
    case "aa":  return "2.1 AA";
    case "aaa": return "2.1 AAA";
    default:    return level.toUpperCase();
  }
}

function escapeHtml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
