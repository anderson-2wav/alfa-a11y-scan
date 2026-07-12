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

import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import ExcelJS from "exceljs";
import type { AuditReport, CliOptions, EngineName, EngineSummary, PageResult, ViolationRecord } from "./types.js";

const ENGINE_INFO = {
  alfa: {
    name: "Siteimprove Alfa",
    homepage: "https://github.com/Siteimprove/alfa",
    ruleUrl: (id: string) => `https://alfa.siteimprove.com/rules/${id}`,
  },
  opena11y: {
    name: "OpenA11y Evaluation Library",
    homepage: "https://opena11y.github.io/evaluation-library/",
    // COLOR_1 → rule-color-1.html
    ruleUrl: (id: string) =>
      `https://opena11y.github.io/evaluation-library/rule-${id.toLowerCase().replace(/_/g, "-")}.html`,
  },
} as const;

function engineInfo(engine: EngineName) {
  return ENGINE_INFO[engine] ?? ENGINE_INFO.alfa;
}

// OpenA11Y diagnostic messages mark code terms with @…@ (e.g. "the
// @navigation@ landmark"). Strip the delimiters for plain-text formats;
// formatMessageHtml renders them as <code> instead. Alfa messages are
// left untouched — the @…@ convention is engine-specific.
function formatMessagePlain(message: string, engine: EngineName): string {
  if (engine !== "opena11y") return message;
  return message.replace(/@([^@\n]+)@/g, "$1");
}

function formatMessageHtml(message: string, engine: EngineName): string {
  const escaped = escapeHtml(message);
  if (engine !== "opena11y") return escaped;
  return escaped.replace(/@([^@\n]+)@/g, "<code>$1</code>");
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function rankRules(
  violations: ViolationRecord[],
): Array<{ ruleId: string; ruleTitle: string; count: number }> {
  const counts = new Map<string, { ruleTitle: string; count: number }>();
  for (const v of violations) {
    if (v.outcome !== "failed") continue;
    const existing = counts.get(v.ruleId);
    if (existing) existing.count++;
    else counts.set(v.ruleId, { ruleTitle: v.ruleTitle, count: 1 });
  }
  return [...counts.entries()]
    .map(([ruleId, { ruleTitle, count }]) => ({ ruleId, ruleTitle, count }))
    .sort((a, b) => b.count - a.count);
}

export function buildReport(pages: PageResult[], options: CliOptions, sourceUrl: string, durationMs = 0): AuditReport {
  const allViolations = pages.flatMap((p) => p.violations);

  // Deterministic engine order: alfa before opena11y, only those that ran.
  const engines = (["alfa", "opena11y"] as EngineName[]).filter((e) =>
    pages.some((p) => p.engine === e),
  );

  const byEngine: Partial<Record<EngineName, EngineSummary>> = {};
  for (const engine of engines) {
    const enginePages = pages.filter((p) => p.engine === engine);
    const engineViolations = enginePages.flatMap((p) => p.violations);
    byEngine[engine] = {
      totalViolations: engineViolations.filter((v) => v.outcome === "failed").length,
      totalCantTell: engineViolations.filter((v) => v.outcome === "cantTell").length,
      pagesWithErrors: enginePages.filter((p) => p.status === "error").length,
      violationsByRule: rankRules(engineViolations),
    };
  }

  const distinctUrls = new Set(pages.map((p) => p.url));
  const urlsWithError = new Set(
    pages.filter((p) => p.status === "error").map((p) => p.url),
  );

  return {
    generatedAt: new Date().toISOString(),
    sourceUrl,
    durationMs,
    options,
    summary: {
      totalPages: distinctUrls.size,
      pagesWithErrors: urlsWithError.size,
      totalViolations: allViolations.filter((v) => v.outcome === "failed").length,
      totalCantTell: allViolations.filter((v) => v.outcome === "cantTell").length,
      violationsByRule: rankRules(allViolations),
      engines,
      byEngine,
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
          formatMessagePlain(v.diagnosticMessage, page.engine),
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
  summarySheet.addRow(["Elapsed Time", formatDuration(report.durationMs)]);
  summarySheet.addRow(["Source", report.sourceUrl]);
  summarySheet.addRow(["Engine", engineInfo(report.options.engine === "both" ? "alfa" : report.options.engine).name]);
  summarySheet.addRow(["WCAG Level", formatWcagLevel(report.options.engine, report.options.wcagLevel)]);
  if (report.options.onlyRules.length > 0)
    summarySheet.addRow(["Only Rules", report.options.onlyRules.join(", ")]);
  if (report.options.ignoreRules.length > 0)
    summarySheet.addRow(["Ignored Rules", report.options.ignoreRules.join(", ")]);
  summarySheet.addRow([]);
  summarySheet.addRow([
    "About",
    `This report was generated using ${engineInfo(report.options.engine === "both" ? "alfa" : report.options.engine).name}, an open-source accessibility code checker. ` +
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
        const row = sheet.addRow({
          ...v,
          diagnosticMessage: formatMessagePlain(v.diagnosticMessage, page.engine),
        });
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

  const consolePages = report.pages.filter((p) => p.consoleMessages.length > 0);
  if (consolePages.length > 0) {
    const consoleSheet = workbook.addWorksheet("Console");
    consoleSheet.columns = [
      { header: "URL", key: "url", width: 60 },
      { header: "Type", key: "type", width: 10 },
      { header: "Message", key: "message", width: 90 },
    ];
    for (const p of consolePages) {
      for (const msg of p.consoleMessages) {
        consoleSheet.addRow({ url: p.url, type: msg.type, message: msg.text });
      }
    }
    const consoleHeader = consoleSheet.getRow(1);
    consoleHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
    consoleHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003057" } };
  }

  await workbook.xlsx.writeFile(`${outputPath}.xlsx`);
}

async function writeJSON(report: AuditReport, outputPath: string): Promise<void> {
  await writeFile(`${outputPath}.json`, JSON.stringify(report, null, 2), "utf-8");
}

function pageLink(url: string, baseUrl?: string): string {
  const href = url.startsWith("http") ? url : `${(baseUrl ?? "").replace(/\/$/, "")}${url}`;
  return `<a href="${escapeHtml(href)}" target="_blank" onclick="event.stopPropagation()">${escapeHtml(url)}</a>`;
}

async function writeHTML(report: AuditReport, outputPath: string): Promise<void> {
  const logoPath = join(dirname(fileURLToPath(import.meta.url)), "../images/2wav-logo-dark.svg");
  const logoBase64 = await readFile(logoPath, "base64").catch(() => "");
  const logoDataUri = logoBase64 ? `data:image/svg+xml;base64,${logoBase64}` : "";

  const s = report.summary;
  const primaryEngine: EngineName = report.options.engine === "both" ? "alfa" : report.options.engine;
  const isBoth = report.options.engine === "both";

  const attribution = isBoth
    ? "Siteimprove Alfa + OpenA11y Evaluation Library"
    : engineInfo(primaryEngine).name;

  const card = (value: number | string, label: string, cls = "") =>
    `<div class="card ${cls}"><div class="card-value">${value}</div><div class="card-label">${escapeHtml(label)}</div></div>`;

  const engineWarn = (engine: EngineName) =>
    engine === "opena11y" ? report.options.showWarningsOpena11y : report.options.showWarningsAlfa;

  let cards: string[];
  if (isBoth) {
    cards = [
      card(s.totalPages, "Pages Scanned"),
      card(s.pagesWithErrors, "Pages With Errors", s.pagesWithErrors > 0 ? "card--error" : ""),
    ];
    for (const engine of s.engines) {
      const es = s.byEngine[engine]!;
      const name = engineInfo(engine).name === "Siteimprove Alfa" ? "Alfa" : "OpenA11y";
      cards.push(card(es.totalViolations, `${name} Violations`, es.totalViolations > 0 ? "card--error" : "card--good"));
      if (engineWarn(engine)) {
        cards.push(card(es.totalCantTell, `${name} Needs Review`, es.totalCantTell > 0 ? "card--warn" : ""));
      }
    }
  } else {
    const showWarnings = engineWarn(primaryEngine);
    cards = [
      card(s.totalPages, "Pages Scanned"),
      card(s.pagesWithErrors, "Pages With Errors", s.pagesWithErrors > 0 ? "card--error" : ""),
      card(s.totalViolations, "Total Violations (failed)", s.totalViolations > 0 ? "card--error" : "card--good"),
    ];
    if (showWarnings) {
      cards.push(card(s.totalCantTell, "Needs Review (cantTell)", s.totalCantTell > 0 ? "card--warn" : ""));
    }
  }
  const summaryCards = `\n    <div class="summary-grid">\n      ${cards.join("\n      ")}\n    </div>`;

  const topTable = (engine: EngineName, rules: Array<{ ruleId: string; ruleTitle: string; count: number }>) => {
    if (rules.length === 0) return "<p>No violations found.</p>";
    const rows = rules
      .slice(0, 20)
      .map(
        (v) =>
          `<tr><td><a href="${escapeHtml(engineInfo(engine).ruleUrl(v.ruleId))}" target="_blank">${escapeHtml(v.ruleId)}</a></td><td>${escapeHtml(v.ruleTitle)}</td><td>${v.count}</td></tr>`,
      )
      .join("\n");
    return `<table>\n    <thead><tr><th>Rule ID</th><th>Rule Title</th><th>Count</th></tr></thead>\n    <tbody>${rows}</tbody>\n  </table>`;
  };

  const shortName = (engine: EngineName) => (engine === "alfa" ? "Alfa" : "OpenA11y");

  const engineFilterButtons = isBoth
    ? `<div class="filter-buttons" role="group" aria-label="Filter by engine">
      <button class="filter-btn engine-btn active" data-engine-filter="all" onclick="setEngine(this)">All engines</button>
      <button class="filter-btn engine-btn" data-engine-filter="alfa" onclick="setEngine(this)">Alfa</button>
      <button class="filter-btn engine-btn" data-engine-filter="opena11y" onclick="setEngine(this)">OpenA11y</button>
    </div>`
    : "";

  const topViolationsSection = isBoth
    ? s.engines
        .map((engine) => `<h2>Top ${shortName(engine)} Violations</h2>\n  ${topTable(engine, s.byEngine[engine]!.violationsByRule)}`)
        .join("\n\n  ")
    : `<h2>Most Common Violations</h2>\n  ${topTable(primaryEngine, s.violationsByRule)}`;

  const worstStatus = (results: PageResult[]): string => {
    if (results.some((r) => r.status === "error")) return "error";
    if (results.some((r) => r.violations.some((v) => v.outcome === "failed"))) return "failed";
    if (results.some((r) => r.violations.some((v) => v.outcome === "cantTell"))) return "canttell";
    return "passed";
  };

  const violationsTable = (result: PageResult): string => {
    if (result.status === "error") {
      return `<p class="error-msg">${escapeHtml(result.errorMessage ?? "Unknown error")}</p>`;
    }
    if (result.violations.length === 0) {
      return `<p class="no-issues">No violations found.</p>`;
    }
    const rows = result.violations
      .map(
        (v) => `<tr class="${v.outcome === "failed" ? "failed" : "cant-tell"}">
            <td><a href="${escapeHtml(v.howToFixUrl)}" target="_blank">${escapeHtml(v.ruleId)}</a></td>
            <td>${escapeHtml(v.wcagCriteria)}</td>
            <td><span class="tag tag--${v.outcome === "failed" ? "failed" : "cant-tell"}">${v.outcome}</span></td>
            <td class="xpath">${escapeHtml(v.elementXPath)}</td>
            <td><code>${escapeHtml(v.elementTag)}</code></td>
            <td><pre class="html-snippet">${escapeHtml(v.elementHtml)}</pre></td>
            <td>${formatMessageHtml(v.diagnosticMessage, result.engine)}</td>
          </tr>`,
      )
      .join("\n");
    return `<table>
            <thead><tr><th>Rule</th><th>WCAG</th><th>Outcome</th><th>XPath</th><th>Tag</th><th>Element HTML</th><th>Message</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
  };

  const consoleBlock = (result: PageResult): string =>
    result.consoleMessages.length > 0
      ? `<details class="console-log">
            <summary>Console (${result.consoleMessages.length})</summary>
            <div class="details-content">
              <table>
                <thead><tr><th>Type</th><th>Message</th></tr></thead>
                <tbody>${result.consoleMessages
                  .map((m) => `<tr class="console-${m.type}"><td>${escapeHtml(m.type)}</td><td>${escapeHtml(m.text)}</td></tr>`)
                  .join("")}</tbody>
              </table>
            </div>
          </details>`
      : "";

  const engineBadge = (result: PageResult): string => {
    const name = shortName(result.engine);
    const failCount = result.violations.filter((v) => v.outcome === "failed").length;
    const cantTellCount = result.violations.filter((v) => v.outcome === "cantTell").length;
    if (result.status === "error") return `<span class="tag tag--error">${name} ERROR</span>`;
    if (failCount > 0) return `<span class="tag tag--failed">${name} ${failCount} failed</span>`;
    if (cantTellCount > 0) return `<span class="tag tag--cant-tell">${name} ${cantTellCount} cantTell</span>`;
    return `<span class="tag tag--pass">${name} 0</span>`;
  };

  let pageDetails: string;
  if (isBoth) {
    // group flat pages by URL, preserving first-seen order
    const groups = new Map<string, PageResult[]>();
    for (const p of report.pages) {
      const arr = groups.get(p.url) ?? [];
      arr.push(p);
      groups.set(p.url, arr);
    }
    pageDetails = [...groups.entries()]
      .map(([url, results]) => {
        const status = worstStatus(results);
        const engines = results.map((r) => r.engine).join(" ");
        const badges = results.map((r) => engineBadge(r)).join(" ");
        const blocks = results
          .map(
            (r) =>
              `<div class="engine-block" data-engine="${r.engine}">
              <h3 class="engine-heading">${escapeHtml(engineInfo(r.engine).name)}</h3>
              ${violationsTable(r)}
              ${consoleBlock(r)}
            </div>`,
          )
          .join("\n");
        return `<details data-url="${escapeHtml(url)}" data-status="${status}" data-engines="${escapeHtml(engines)}">
          <summary>${pageLink(url, report.options.baseUrl)} ${badges}</summary>
          <div class="details-content">${blocks}</div>
        </details>`;
      })
      .join("\n");
  } else {
    pageDetails = report.pages
      .map((page) => {
        const failCount = page.violations.filter((v) => v.outcome === "failed").length;
        const cantTellCount = page.violations.filter((v) => v.outcome === "cantTell").length;

        if (page.status === "error") {
          return `<details data-url="${escapeHtml(page.url)}" data-status="error">
          <summary class="summary--error">${pageLink(page.url, report.options.baseUrl)} <span class="tag tag--error">ERROR</span></summary>
          <div class="details-content"><p class="error-msg">${escapeHtml(page.errorMessage ?? "Unknown error")}</p></div>
        </details>`;
        }
        if (page.violations.length === 0) {
          return `<details data-url="${escapeHtml(page.url)}" data-status="passed">
          <summary class="summary--pass">${pageLink(page.url, report.options.baseUrl)} <span class="tag tag--pass">0 issues</span></summary>
          <div class="details-content"><p class="no-issues">No violations found.</p></div>
        </details>`;
        }
        const label =
          failCount > 0
            ? `<span class="tag tag--failed">${failCount} failed</span>`
            : `<span class="tag tag--cant-tell">${cantTellCount} cantTell</span>`;
        const pageStatus = failCount > 0 ? "failed" : "canttell";
        return `<details data-url="${escapeHtml(page.url)}" data-status="${pageStatus}">
        <summary>${pageLink(page.url, report.options.baseUrl)} ${label}${cantTellCount > 0 && failCount > 0 ? ` <span class="tag tag--cant-tell">${cantTellCount} cantTell</span>` : ""}</summary>
        <div class="details-content">${violationsTable(page)}${consoleBlock(page)}</div>
      </details>`;
      })
      .join("\n");
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Accessibility Scan Report — ${escapeHtml(report.sourceUrl)}</title>
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
    .console-log td { background: #f8f9fa; }
    .console-warn td { background: #fffbea; }
    .console-error td { background: #fff0f0; }
    .no-issues { padding: 14px 18px; color: #1e8449; font-size: 0.9em; }
    .summary--error { color: #c0392b !important; }
    .filter-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    #url-search { flex: 1; min-width: 200px; padding: 7px 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 0.9em; }
    .filter-buttons { display: flex; gap: 4px; flex-shrink: 0; }
    .filter-btn { padding: 6px 12px; border: 1px solid #ccc; border-radius: 5px; background: #fff; cursor: pointer; font-size: 0.82em; color: #555; }
    .filter-btn.active { background: #003057; color: #fff; border-color: #003057; }
    .filter-count { font-size: 0.82em; color: #888; white-space: nowrap; }
    .engine-block { margin-bottom: 14px; }
    .engine-block:last-child { margin-bottom: 0; }
    .engine-heading { color: #003057; font-size: 0.9em; margin: 10px 14px 6px; padding-top: 6px; border-top: 1px solid #eee; }
    .engine-block:first-child .engine-heading { border-top: none; padding-top: 0; }
  </style>
</head>
<body>
  <h1>Accessibility Scan Report</h1>
  <p class="meta">
    Generated: ${escapeHtml(report.generatedAt)} &nbsp;|&nbsp;
    Elapsed: ${escapeHtml(formatDuration(report.durationMs))} &nbsp;|&nbsp;
    Source: ${report.sourceUrl.startsWith("http") ? `<a href="${escapeHtml(report.sourceUrl)}" target="_blank">${escapeHtml(report.sourceUrl)}</a>` : escapeHtml(report.sourceUrl)} &nbsp;|&nbsp;
    Engine: ${escapeHtml(attribution)} &nbsp;|&nbsp;
    WCAG Level: ${escapeHtml(formatWcagLevel(report.options.engine, report.options.wcagLevel))}
    ${report.options.onlyRules.length > 0 ? ` &nbsp;|&nbsp; Only rules: ${escapeHtml(report.options.onlyRules.join(", "))}` : ""}
    ${report.options.ignoreRules.length > 0 ? ` &nbsp;|&nbsp; Ignored rules: ${escapeHtml(report.options.ignoreRules.join(", "))}` : ""}
  </p>
  <p class="about">
    This report was generated using ${
      isBoth
        ? `two open source accessibility code checkers, <a href="${escapeHtml(engineInfo("alfa").homepage)}" target="_blank">${escapeHtml(engineInfo("alfa").name)}</a> and <a href="${escapeHtml(engineInfo("opena11y").homepage)}" target="_blank">${escapeHtml(engineInfo("opena11y").name)}</a>`
        : `the open source <a href="${escapeHtml(engineInfo(primaryEngine).homepage)}" target="_blank">${escapeHtml(engineInfo(primaryEngine).name)}</a> accessibility code checker`
    }.
    Each page is evaluated in a fully-rendered headless browser so that
    client-side JavaScript is executed before analysis — producing results that reflect the actual DOM
    seen by assistive technologies, rather than the raw HTML source. Rules are evaluated against
    WCAG ${escapeHtml(formatWcagLevel(report.options.engine, report.options.wcagLevel))} success criteria.
  </p>

  ${summaryCards}

  ${topViolationsSection}

  <h2>Results by Page</h2>
  <div class="filter-bar">
    <input type="search" id="url-search" placeholder="Filter by URL…" oninput="applyFilters()" autocomplete="off">
    <div class="filter-buttons" role="group" aria-label="Filter by status">
      <button class="filter-btn active" data-filter="all"    onclick="setFilter(this)">All</button>
      <button class="filter-btn"        data-filter="error"  onclick="setFilter(this)">Errors</button>
      <button class="filter-btn"        data-filter="failed" onclick="setFilter(this)">Violations</button>
      <button class="filter-btn"        data-filter="canttell" onclick="setFilter(this)">cantTell</button>
      <button class="filter-btn"        data-filter="passed" onclick="setFilter(this)">Passed</button>
    </div>
    ${engineFilterButtons}
    <span id="filter-count" class="filter-count"></span>
  </div>
  <div id="page-details">${pageDetails}</div>
  <script>
    let activeFilter = 'all';
    let activeEngine = 'all';
    function applyFilters() {
      const query = document.getElementById('url-search').value.toLowerCase();
      const items = document.querySelectorAll('#page-details details');
      let visible = 0;
      items.forEach(el => {
        const url = (el.dataset.url || '').toLowerCase();
        const status = el.dataset.status || '';
        const matchUrl = !query || url.includes(query);
        const matchStatus = activeFilter === 'all' || status === activeFilter;
        let hasVisibleEngine = true;
        const blocks = el.querySelectorAll('.engine-block');
        if (blocks.length) {
          hasVisibleEngine = false;
          blocks.forEach(b => {
            const show = activeEngine === 'all' || b.dataset.engine === activeEngine;
            b.style.display = show ? '' : 'none';
            if (show) hasVisibleEngine = true;
          });
        }
        const show = matchUrl && matchStatus && hasVisibleEngine;
        el.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      document.getElementById('filter-count').textContent = visible + ' of ' + items.length + ' pages';
    }
    function setFilter(btn) {
      document.querySelectorAll('.filter-btn:not(.engine-btn)').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      applyFilters();
    }
    function setEngine(btn) {
      document.querySelectorAll('.engine-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeEngine = btn.dataset.engineFilter;
      applyFilters();
    }
    applyFilters();
  </script>

  <footer>
    ${logoDataUri ? `<a href="https://2wav.com" target="_blank" aria-label="2wav inc."><img src="${logoDataUri}" alt="2wav inc." class="footer-logo"></a>` : ""}
    <p>This A11Y scanner software &copy; 2026, 2wav inc. All Rights Reserved. Free for use under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank">GNU Affero General Public License v3.0</a></p>
  </footer>
</body>
</html>`;

  await writeFile(`${outputPath}.html`, html, "utf-8");
}

function formatWcagLevel(engine: CliOptions["engine"], wcagLevel: CliOptions["wcagLevel"]): string {
  // Only Alfa's level-"a" is the WCAG 2.0 AA approximation; OpenA11y and
  // "both" render 2.1. (In "both" mode this is a cosmetic report-wide label.)
  const version = engine === "alfa" && wcagLevel === "a" ? "2.0" : "2.1";
  return `${version} ${wcagLevel.toUpperCase()}`;
}

function escapeHtml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
