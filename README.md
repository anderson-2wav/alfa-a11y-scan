# Sitemap Accessibility Checker

A command-line tool that audits web accessibility (A11Y) across an entire site by loading each page in a headless browser and evaluating the rendered DOM. It can run either or both of two open-source engines: [Siteimprove Alfa](https://github.com/Siteimprove/alfa) and the [OpenA11y Evaluation Library](https://opena11y.github.io/evaluation-library/).

Key design features:

- **Full-page rendering.** Pages are loaded in a real browser engine with JavaScript enabled. The engine evaluates the same Document Object Model (DOM) that a user with assistive technology would encounter — not the raw HTML from the server.
- **Two evaluation engines.** Choose Siteimprove Alfa (the library underlying Siteimprove's browser extension), the OpenA11y Evaluation Library, or **both at once** in a single combined report. See [Accessibility engines](#accessibility-engines).
- **Whole-site coverage.** The tool crawls every URL in a sitemap or a provided list in a single run, producing a complete inventory of violations across the entire site.
- **Configurable.** Engine selection, concurrency, WCAG level, per-page retries, URL filtering, and authenticated access via JWT cookies are all supported. Results can be filtered to suppress accepted exceptions, and "needs review" warnings can be toggled per engine.

## Caveats

This is very new software.

We developed it to solve a specific need for an institutional client concerned about the ADA Title II Web Accessibility Rule deadline of April 26, 2026. We release it after relatively little testing so that other organizations with a similar need may benefit from this tool immediately, even with a few rough edges.

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

## Accessibility engines

Select the engine with `--engine` (or the `ENGINE` env var). Default is `alfa`.

| Engine | Rule IDs | Rule docs | Notes |
|---|---|---|---|
| `alfa` | `sia-r69`, `sia-r87`, … | `alfa.siteimprove.com/rules/<id>` | Default. Directly comparable to Siteimprove's own tooling. |
| `opena11y` | `COLOR_1`, `IMAGE_1`, … | `opena11y.github.io/evaluation-library/rule-<id>.html` | Runs the library inside the page. Emits many "manual check" results, hidden by default (see `WARNINGS_OPENA11Y`). |
| `both` | (both formats) | (per engine) | Runs **both** engines against every page and produces a single combined report. |

In `both` mode the report distinguishes the two engines throughout: engine-split summary cards, a separate "Most Common Violations" table per engine, per-page results grouped by URL with each engine's findings stacked under a labeled sub-table, an engine filter in the HTML report, and an `Engine` column in the CSV/XLSX output. Note that `both` loads each page twice (once per engine).

## Configuration

Copy the example file and edit it for your site:

```bash
cp .env.example .env
```

Then load it when you run the CLI (`--env-file=.env`, shown below). Every variable also has a command-line flag equivalent; **a flag always overrides the matching env var.**

| Variable | Description |
|---|---|
| `ENGINE` | Engine to run: `alfa` (default), `opena11y`, or `both` (overridden by `--engine`) |
| `SITEMAP` | Sitemap URL to crawl; used when no positional sitemap argument is given (overridden by the positional arg) |
| `URLS` | Path to a JSON file containing an array of URLs to audit directly — use instead of `SITEMAP` for sites without a sitemap (overridden by `--urls`) |
| `BASE_URL` | Base URL (including scheme) prepended to relative paths in the URL file, e.g. `https://example.com` (overridden by `--base-url`) |
| `FILTER` | Regex to restrict which sitemap URLs are scanned (overridden by `--filter`) |
| `OUTPUT` | Output file base name, without extension (overridden by `--output`) |
| `NAME` | Site name; prefixes the report title as `<NAME> Accessibility Scan Report` in the HTML report and the XLSX Summary sheet (overridden by `--name`) |
| `IGNORE_RULES` | Comma-separated rule IDs to suppress. Alfa uses `sia-rN`; OpenA11y uses `UPPER_SNAKE` (e.g. `COLOR_1`) |
| `ONLY_RULES` | Comma-separated rule IDs to run exclusively (all others skipped) (overridden by `--only-rules`) |
| `WARNINGS_ALFA` | Include Alfa "cantTell" (needs-review) results. Default `true` (overridden by `--warnings-alfa`) |
| `WARNINGS_OPENA11Y` | Include OpenA11y manual-check / warning results. Default `false` — these are voluminous (overridden by `--warnings-opena11y`) |
| `CONCURRENCY` | Number of pages to audit in parallel, default `3` (overridden by `--concurrency`) |
| `INCLUDE_ARIA` | Include WAI-ARIA authoring-practice rules (Alfa). Set to `false` to exclude; default `true` (overridden by `--aria`) |
| `JWT_TOKEN` | JWT token value to inject as a cookie on every page request, for authenticated sites (overridden by `--jwt-token`) |
| `JWT_COOKIE_NAME` | Name of the cookie to set the JWT token in, default `token` (overridden by `--jwt-cookie-name`) |
| `CAPTURE_CONSOLE` | Set to `true` to capture browser `console.log/warn/error` output per page (overridden by `--capture-console`) |
| `CONSOLE_LOG_FILE` | File path to write browser console output; relative paths resolve to cwd. Also enables `CAPTURE_CONSOLE` (overridden by `--console-log-file`) |
| `RETRY` | Number of times to retry a page if it errors or has violations, default `0` (overridden by `--retry`) |
| `STOP_ON_FAIL` | Set to `true` to stop scanning after the first page error or violation and write a partial report (overridden by `--stop-on-fail`) |

> **Note on `npm start`:** the `start` script in `package.json` is wired to the maintainer's private env file. For your own runs, use the `node --env-file=.env …` command shown below (or repoint the `start` script at your `.env`).

## Usage

```bash
node --env-file=.env --import tsx src/cli.ts [sitemap-url] [options]
```

A sitemap URL is the most common way to provide pages to scan (as the positional argument or via `SITEMAP`). For sites without a sitemap, use `--urls` / `URLS` instead. Exactly one source (sitemap or URL list) must be provided.

### Options

| Flag | Alias | Default | Description |
|---|---|---|---|
| `<sitemap-url>` | | `$SITEMAP` | URL of the XML sitemap to scan (positional) |
| `--engine` | | `alfa` | Engine to run: `alfa`, `opena11y`, or `both` (`$ENGINE`) |
| `--urls` | | `$URLS` | Path to a JSON file containing an array of URLs to audit directly (bypasses sitemap) |
| `--base-url` | | `$BASE_URL` | Base URL prepended to relative paths in the URL file, e.g. `https://example.com` |
| `--output` | `-o` | `./report` | Output file path without extension (`$OUTPUT`) |
| `--name` | | `$NAME` | Site name; prefixes the report title as `<name> Accessibility Scan Report` |
| `--format` | `-f` | `csv` | Output format: `csv`, `xlsx`, `json`, `html` |
| `--concurrency` | `-c` | `3` | Pages to audit in parallel (`$CONCURRENCY`) |
| `--filter` | | | Regex to restrict which sitemap URLs are scanned (`$FILTER`) |
| `--only-rules` | | | Comma-separated rule IDs to include exclusively (`$ONLY_RULES`) |
| `--warnings-alfa` | | `true` | Include Alfa "cantTell" (needs-review) results (`$WARNINGS_ALFA`) |
| `--warnings-opena11y` | | `false` | Include OpenA11y manual-check / warning results (`$WARNINGS_OPENA11Y`) |
| `--wcag-level` | | `aa` | WCAG conformance level: `a`, `aa`, `aaa` |
| `--aria` | | `true` | Include WAI-ARIA authoring-practice rules (Alfa); `--no-aria` to disable (`$INCLUDE_ARIA`) |
| `--timeout` | | `30000` | Page load timeout in ms |
| `--wait` | | `2000` | Extra wait after page load in ms (allows JS to settle) |
| `--pause` | | `0` | Delay between page loads in ms (rate limiting) |
| `--retry` | | `0` | Times to retry a page if it errors or has violations (`$RETRY`) |
| `--stop-on-fail` | | `false` | Stop after the first page error or violation and write a partial report (`$STOP_ON_FAIL`) |
| `--jwt-token` | | `$JWT_TOKEN` | JWT token to inject as a cookie on every page request |
| `--jwt-cookie-name` | | `token` | Cookie name for the JWT token (`$JWT_COOKIE_NAME`) |
| `--capture-console` | | `false` | Capture browser `console.log/warn/error` output per page (`$CAPTURE_CONSOLE`) |
| `--console-log-file` | | `$CONSOLE_LOG_FILE` | File path to write browser console output; also enables `--capture-console` |
| `--verbose` | `-v` | `false` | Print per-page progress to the console |

### Examples

```bash
# Audit an entire sitemap with the default engine (Alfa), output an HTML report
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml -o report -f html -v

# Audit with the OpenA11y engine
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml --engine opena11y -f html -o report

# Run BOTH engines and produce one combined report
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml --engine both -f html -o report

# Title the report after your site
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml --name "Example.com" -f html -o report

# Audit only pages matching a URL pattern
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml --filter "blog" -o blog-report -f xlsx

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

Absolute URLs (`https://...`) are used as-is. Relative paths require `--base-url` (or `BASE_URL`) to be set.

## Output Formats

| Format | Description |
|---|---|
| `html` | Self-contained single-file report with a summary dashboard, collapsible per-page results, and the HTML snippet of each failing element. In `both` mode it adds engine-split cards, per-engine top-violation tables, stacked per-engine results, and an engine filter. |
| `csv` | One row per violation, with an `Engine` column; suitable for import into Excel or Google Sheets |
| `xlsx` | Excel workbook with a Summary sheet, color-coded Results sheet (with an `Engine` column), and an optional Console sheet (when console capture is on) |
| `json` | Full structured data including all metadata and per-engine summaries; useful for downstream processing |

## Ignored / selected rules

Add rule IDs to `IGNORE_RULES` to suppress known false positives or accepted exceptions, or to `ONLY_RULES` to run just a subset:

```
IGNORE_RULES=sia-r69,COLOR_1
ONLY_RULES=sia-r69
```

Rule ID formats differ per engine:

- **Alfa:** `sia-rN` — docs at `https://alfa.siteimprove.com/rules/sia-rN`
- **OpenA11y:** `UPPER_SNAKE_CASE` (e.g. `COLOR_1`) — docs at `https://opena11y.github.io/evaluation-library/rule-color-1.html`

## "Needs review" warnings

Both engines produce results that require human judgment rather than a definite pass/fail — Alfa calls these "cantTell"; OpenA11y calls them manual checks. They are toggled independently per engine:

- `WARNINGS_ALFA` / `--warnings-alfa` — **default `true`** (Alfa's are manageable in volume).
- `WARNINGS_OPENA11Y` / `--warnings-opena11y` — **default `false`** (OpenA11y emits a large number of manual checks that would otherwise drown out confirmed violations).

## Sitemap Format Support

Both sitemap formats are supported:

- **`<urlset>`** — standard page list
- **`<sitemapindex>`** — index of nested sitemaps (fetched and merged recursively)

## Interrupting a scan

Press **Ctrl+C** during a scan to stop it gracefully. In-flight pages (up to the concurrency limit) will finish, then the tool will prompt:

```
^C received — finishing in-flight pages (^C again to force exit)...

Scan interrupted. 42 of 187 pages completed.
Write partial report? [y/N]
```

Enter `y` to write a partial report from pages completed so far, or `n` (or press Ctrl+C again) to exit immediately without writing anything.

## How It Works

1. The sitemap is fetched and parsed to extract all page URLs (optionally filtered by regex), or the URL list file is read.
2. A single headless Chromium browser is launched and pages are audited in a concurrency-limited pool (default 3 at a time).
3. Each page is loaded with `domcontentloaded`, then waits for the configured `--wait` period to allow JS to settle. The selected engine(s) then evaluate the rendered DOM against WCAG success criteria. In `both` mode, Alfa and OpenA11y each evaluate the page.
4. Pages that error (or have violations) are retried up to `--retry` times (default `0`, i.e. no retry) before being recorded.
5. Results are aggregated — combined and per-engine — and written to the chosen output format.

## License

Copyright (C) 2026 2wav inc.

This project is licensed under the [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html) (AGPL-3.0). You may use, modify, and distribute it freely under those terms — including requiring that any modifications remain open source, and that use as a network service also triggers source disclosure.

**Commercial licensing:** If you want to incorporate this tool into a proprietary or closed-source product, contact [2wav](https://2wav.com) to obtain a commercial license.
