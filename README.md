# Alfa Sitemap Accessibility Checker

A command-line tool that crawls every page in an XML sitemap, audits each for accessibility violations using [Siteimprove Alfa](https://github.com/Siteimprove/alfa), and produces a structured report. Pages are rendered in a headless Chromium browser so client-side JavaScript executes before analysis — meaning results reflect the actual DOM seen by assistive technologies, not just the raw HTML source.

## Requirements

- Node.js 22 or later
- npm

## Installation

```bash
git clone <repo-url>
cd alfa-a11y-scan
npm install
npx playwright install chromium
```

## Configuration

Copy `.env` and edit as needed:

```bash
cp .env .env.local
```

| Variable | Description |
|---|---|
| `SITEMAP` | Default sitemap URL (used by `npm start`) |
| `OUTPUT` | Default output filename without extension (used by `npm start`) |
| `FILTER` | Regex to restrict which sitemap URLs are scanned (overridden by `--filter` flag) |
| `CONCURRENCY` | Number of pages to audit in parallel, default `3` (overridden by `--concurrency` flag) |
| `IGNORE_RULES` | Comma-separated Alfa rule IDs to suppress (e.g. `sia-r65,sia-r87`) |
| `WARNINGS` | Set to `true` to include "cantTell" outcomes in reports (omit or set `false` to show confirmed violations only) |

## Usage

```bash
node --env-file=.env --import tsx src/cli.ts <sitemap-url> [options]
```

Or use the `npm start` shortcut, which reads `SITEMAP` and `OUTPUT` from `.env`:

```bash
npm start
```

### Options

| Flag | Alias | Default | Description |
|---|---|---|---|
| `<sitemap-url>` | | *(required)* | URL of the XML sitemap to scan |
| `--output` | `-o` | `./report` | Output file path (without extension) |
| `--format` | `-f` | `csv` | Output format: `csv`, `xlsx`, `json`, `html` |
| `--concurrency` | `-c` | `3` | Pages to audit in parallel |
| `--filter` | | | Regex to restrict which sitemap URLs are scanned |
| `--timeout` | | `30000` | Page load timeout in ms |
| `--wait` | | `2000` | Extra wait after page load in ms (allows JS to settle) |
| `--wcag-level` | | `aa` | WCAG conformance level: `a`, `aa`, `aaa` (default is WCAG 2.1 AA) |
| `--verbose` | `-v` | `false` | Print per-page progress to the console |

### Examples

```bash
# Audit an entire sitemap, output an HTML report
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml -o report -f html -v

# Audit only pages matching a URL pattern
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml --filter "blog" -o blog-report -f xlsx

# Higher concurrency on a fast server
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml -c 6 -f html -o full-report
```

## Output Formats

| Format | Description |
|---|---|
| `html` | Self-contained single-file report with a summary dashboard, collapsible per-page results, and the HTML snippet of each failing element |
| `csv` | One row per violation; suitable for import into Excel or Google Sheets |
| `xlsx` | Excel workbook with a Summary sheet and a color-coded Violations sheet |
| `json` | Full structured data including all metadata; useful for downstream processing |

## Ignored Rules

Add rule IDs to `IGNORE_RULES` in `.env` to suppress known false positives or accepted exceptions:

```
IGNORE_RULES=sia-r65,sia-r87
```

Rule IDs use the format `sia-rN` and link to documentation at `https://alfa.siteimprove.com/rules/sia-rN`.

## Sitemap Format Support

Both sitemap formats are supported:

- **`<urlset>`** — standard page list
- **`<sitemapindex>`** — index of nested sitemaps (fetched and merged recursively)

## How It Works

1. The sitemap is fetched and parsed to extract all page URLs (optionally filtered by regex).
2. A single headless Chromium browser is launched and pages are audited in a concurrency-limited pool (default 3 at a time).
3. Each page is loaded with `networkidle` (or falls back after timeout), then Siteimprove Alfa evaluates the rendered DOM against WCAG success criteria.
4. Failed pages are retried once automatically before being recorded as errors.
5. Results are aggregated and written to the chosen output format.

## License

Copyright (C) 2026 2wav inc.

This project is licensed under the [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html) (AGPL-3.0). You may use, modify, and distribute it freely under those terms — including requiring that any modifications remain open source, and that use as a network service also triggers source disclosure.

**Commercial licensing:** If you need to incorporate this tool into a proprietary or closed-source product, contact [2wav](https://2wav.com) to obtain a commercial license.
