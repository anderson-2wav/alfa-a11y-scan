# Alfa Sitemap Accessibility Checker

A command-line tool that crawls every page in an XML sitemap, audits each for accessibility violations using [Siteimprove Alfa](https://github.com/Siteimprove/alfa), and produces a structured report. Pages are rendered in a headless Chromium browser so client-side JavaScript executes before analysis — meaning results reflect the actual DOM seen by assistive technologies, not just the raw HTML source.

## Caveats
This is very new software. 

We developed it to solve an urgent need for an institutional client concerned about the ADA Title II Web Accessibility Rule deadline April 26, 2026. We release it after relatively little testing so that other organizations with a similar need may benefit from this tool immediately, even with a few rough edges.

Please use with care and a little patience. Read all the disclaimers and limitations of liability in the [AGPL-3.0 LICENSE](./LICENSE).

## Requirements

- Tested with Node.js 22. 

## Installation

```bash
git clone https://github.com/anderson-2wav/alfa-a11y-scan.git
cd alfa-a11y-scan
npm install
npx playwright install chromium
```

## Configuration

See examples in `.env` and edit as needed.

| Variable | Description |
|---|---|
| `SITEMAP` | Default sitemap URL (used by `npm start`) |
| `OUTPUT` | Default output filename without extension (used by `npm start`) |
| `FILTER` | Regex to restrict which sitemap URLs are scanned (overridden by `--filter` flag) |
| `CONCURRENCY` | Number of pages to audit in parallel, default `3` (overridden by `--concurrency` flag) |
| `IGNORE_RULES` | Comma-separated Alfa rule IDs to suppress (e.g. `sia-r65,sia-r87`) |
| `WARNINGS` | Set to `true` to include "cantTell" outcomes in reports (omit or set `false` to show confirmed violations only) |
| `URLS` | Path to a JSON file containing an array of URLs to audit directly — use instead of `SITEMAP` for sites without a sitemap |
| `BASE_URL` | Base URL (including scheme) prepended to relative paths in the URL file, e.g. `https://example.com` or `http://localhost:3000` |
| `JWT_TOKEN` | JWT token value to inject as a cookie on every page request (for authenticated sites) |
| `JWT_COOKIE_NAME` | Name of the cookie to set the JWT token in, default `token` |
| `CAPTURE_CONSOLE` | Set to `true` to capture browser `console.log/warn/error` output per page |
| `RETRY` | Number of times to retry a page if it errors or has violations, default `1` |

## Usage

```bash
node --env-file=.env --import tsx src/cli.ts <sitemap-url> [options]
```

A sitemap URL is the most common way to provide pages to scan. For sites without a sitemap, use `--urls` instead (see below). Exactly one of the two must be provided.

Or use the `npm start` shortcut, which reads `SITEMAP` and `OUTPUT` from `.env`:

```bash
npm start
```

### Options

| Flag | Alias | Default | Description |
|---|---|---|---|
| `<sitemap-url>` | | | URL of the XML sitemap to scan |
| `--urls` | | `$URLS` | Path to a JSON file containing an array of URLs to audit directly (bypasses sitemap) |
| `--base-url` | | `$BASE_URL` | Base URL prepended to relative paths in the URL file, e.g. `https://example.com` |
| `--jwt-token` | | `$JWT_TOKEN` | JWT token to inject as a cookie on every page request |
| `--jwt-cookie-name` | | `$JWT_COOKIE_NAME` | Cookie name for the JWT token, default `token` |
| `--output` | `-o` | `./report` | Output file path (without extension) |
| `--format` | `-f` | `csv` | Output format: `csv`, `xlsx`, `json`, `html` |
| `--concurrency` | `-c` | `3` | Pages to audit in parallel |
| `--filter` | | | Regex to restrict which sitemap URLs are scanned |
| `--timeout` | | `30000` | Page load timeout in ms |
| `--wait` | | `2000` | Extra wait after page load in ms (allows JS to settle) |
| `--wcag-level` | | `aa` | WCAG conformance level: `a`, `aa`, `aaa` (default is WCAG 2.1 AA) |
| `--verbose` | `-v` | `false` | Print per-page progress to the console |
| `--capture-console` | | `$CAPTURE_CONSOLE` | Capture browser `console.log/warn/error` output per page; included in HTML, XLSX, and JSON reports |
| `--retry` | | `1` | Times to retry a page if it errors or has violations (set to `0` to disable) |

### Examples

```bash
# Audit an entire sitemap, output an HTML report
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml -o report -f html -v

# Audit only pages matching a URL pattern
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml --filter "blog" -o blog-report -f xlsx

# Higher concurrency on a fast server
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml -c 6 -f html -o full-report

# Audit a fixed list of URLs from a JSON file (no sitemap needed)
node --env-file=.env --import tsx src/cli.ts --urls ./urls.json -f html -o report

# Audit relative paths with a base URL (useful for local/staging environments)
node --env-file=.env --import tsx src/cli.ts --urls ./urls.json --base-url http://localhost:3000 -f html -o report

# Audit an authenticated site using a JWT cookie
node --env-file=.env --import tsx src/cli.ts https://app.example.com/sitemap.xml \
  --jwt-token eyJhbGci... --jwt-cookie-name session -f html -o report
```

### URL file format

When using `--urls`, provide a JSON file containing an array of URL strings. Lines beginning with `//` or `#` are treated as comments and skipped:

```json
[
  "# Main pages",
  "/",
  "/about",
  "/contact",
  "// skip this one for now",
  "# /work-in-progress"
]
```

Absolute URLs (`https://...`) are used as-is. Relative paths require `--base-url` to be set.

## Output Formats

| Format | Description |
|---|---|
| `html` | Self-contained single-file report with a summary dashboard, collapsible per-page results, and the HTML snippet of each failing element |
| `csv` | One row per violation; suitable for import into Excel or Google Sheets |
| `xlsx` | Excel workbook with a Summary sheet, color-coded Violations sheet, and optional Console sheet (when `--capture-console` is on) |
| `json` | Full structured data including all metadata; useful for downstream processing |

## Ignored Rules

Add rule IDs to `IGNORE_RULES` in `.env` to suppress known false positives or accepted exceptions:

```
IGNORE_RULES=sia-r69,sia-r87
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

**Commercial licensing:** If you want to incorporate this tool into a proprietary or closed-source product, contact [2wav](https://2wav.com) to obtain a commercial license.
