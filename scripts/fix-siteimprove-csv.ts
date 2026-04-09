#!/usr/bin/env node
/**
 * Converts badly-encoded Siteimprove CSV exports to clean CSV.
 *
 * Siteimprove exports UTF-16 LE files with tab-separated quoted values.
 * The first 8 lines are metadata. After that:
 *   - Issue rows have 11 columns (issue-level data)
 *   - Immediately following each issue row is an optional sub-header + page rows,
 *     each prefixed by 11 empty tab columns, then: Title, URL, Page Report, Occurrences, Page views
 *
 * Output: flattened CSV — one row per page occurrence, with issue info repeated.
 *
 * Usage:
 *   node --import tsx scripts/fix-siteimprove-csv.ts <input.csv> [output.csv]
 */

import fs from "fs";
import path from "path";

const METADATA_LINES = 8;

const ISSUE_HEADERS = [
  "Issue",
  "Conformance",
  "Success criteria",
  "Difficulty",
  "Responsibility",
  "Element type",
  "Abilities affected",
  "Total occurrences",
  "Total pages",
  "AI remediate",
  "Points you can gain",
];

const PAGE_HEADERS = ["Page title", "Page URL", "Page report URL", "Page occurrences", "Page views"];

function parseRow(line: string): string[] {
  // Values are tab-separated, each wrapped in quotes
  return line.split("\t").map((cell) => cell.trim().replace(/^"|"$/g, "").trim());
}

function toCsvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvRow(values: string[]): string {
  return values.map(toCsvCell).join(",");
}

function convert(inputPath: string, outputPath: string): void {
  const raw = fs.readFileSync(inputPath);

  // Detect UTF-16 LE BOM (FF FE)
  const isUtf16Le = raw[0] === 0xff && raw[1] === 0xfe;
  const text = isUtf16Le
    ? raw.toString("utf16le")
    : raw.toString("utf8");

  const lines = text.split(/\r?\n/);

  // Skip metadata lines (first METADATA_LINES non-empty structural lines)
  const dataLines = lines.slice(METADATA_LINES).filter((l) => l.trim() !== "");

  if (dataLines.length === 0) {
    console.error("No data found after metadata lines.");
    process.exit(1);
  }

  // First data line is the issue-level header — use it to detect column count.
  const headerCells = parseRow(dataLines[0]);
  // The issue columns are everything up to (but not including) the first empty cell group.
  // More reliably: count contiguous non-empty cells from the start.
  let issueColCount = headerCells.findIndex((c) => c === "");
  if (issueColCount === -1) issueColCount = headerCells.length;

  const outputRows: string[][] = [];
  outputRows.push([...ISSUE_HEADERS, ...PAGE_HEADERS]);

  let currentIssue: string[] | null = null;

  for (const line of dataLines) {
    const cells = parseRow(line);

    // Determine if this is an issue row or a page expansion row.
    // Issue rows: first cell is non-empty (the issue name), OR it's the header row.
    // Page expansion rows: first issueColCount cells are empty, then page data follows.
    // Sub-header rows within expansion: first issueColCount empty, then "Title", "URL", etc. — skip.

    const firstNonEmpty = cells.findIndex((c) => c !== "");

    if (firstNonEmpty === -1) continue; // blank row

    if (firstNonEmpty < issueColCount) {
      // This is an issue row (or the column header row — skip header)
      if (cells[0] === "Issues" || cells[0] === '"Issues"') continue;
      if (cells[0] === "Potential issues") continue;
      currentIssue = cells.slice(0, issueColCount);
    } else {
      // Page expansion row — starts after issueColCount empty columns
      const pageCells = cells.slice(issueColCount);

      // Skip sub-header rows (Title / URL / Page Report / Occurrences / Page views)
      if (pageCells[0] === "Title" || pageCells[0] === "URL") continue;

      if (currentIssue) {
        // Pad issue cells to match ISSUE_HEADERS length, then append page cells
        const paddedIssue = [...currentIssue];
        while (paddedIssue.length < ISSUE_HEADERS.length) paddedIssue.push("");
        // Pad page cells to 5 columns
        while (pageCells.length < 5) pageCells.push("");
        outputRows.push([...paddedIssue, ...pageCells.slice(0, 5)]);
      }
    }
  }

  const csv = outputRows.map(toCsvRow).join("\n");
  fs.writeFileSync(outputPath, csv, "utf8");
  console.log(`Wrote ${outputRows.length - 1} data rows to ${outputPath}`);
}

// --- CLI ---
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Usage: fix-siteimprove-csv.ts <input.csv> [output.csv]");
  process.exit(1);
}

const inputPath = path.resolve(args[0]);
const outputPath = args[1]
  ? path.resolve(args[1])
  : inputPath.replace(/(\.[^.]+)?$/, "-reformatted.csv");

if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

convert(inputPath, outputPath);
