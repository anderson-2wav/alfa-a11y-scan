# Siteimprove Sitemap Accessibility Checker — Project Spec

## Goal

Build a reusable CLI tool that takes an XML sitemap URL, visits every page in a headless browser (so client-side JS executes), runs the Siteimprove Accessibility Code Checker (Alfa) against each page, and produces a structured report of all accessibility violations.

This solves a specific problem: the customer's Siteimprove online scanner doesn't render JavaScript, so any a11y fixes applied client-side don't appear in their reports. By running Alfa in a real browser, we get results that reflect the actual rendered DOM.

## Tech Stack

- **Node.js** (TypeScript)
- **Playwright** — headless Chromium for full JS rendering
- **@siteimprove/alfa-playwright** — converts Playwright pages to Alfa's internal format
- **@siteimprove/alfa-test-utils** — provides `Audit.run()` and result logging/filtering
- **xml2js** or **fast-xml-parser** — to parse the sitemap XML

## Installation

```bash
npm init -y
npm install --save-dev typescript @types/node ts-node
npm install --save-dev @playwright/test
npm install --save-dev @siteimprove/alfa-playwright @siteimprove/alfa-test-utils
npm install fast-xml-parser
npx playwright install chromium
```

## Core Architecture

### 1. Sitemap Parser (`src/sitemap.ts`)

- Accept a sitemap URL as input
- Fetch and parse the XML
- Handle both `<urlset>` (page list) and `<sitemapindex>` (nested sitemaps) formats
- Return an array of page URLs
- Support filtering by URL pattern (regex) for partial runs

### 2. Page Auditor (`src/auditor.ts`)

- Accept a URL, open it in Playwright (headless Chromium)
- Wait for the page to fully load (networkidle or a configurable wait strategy)
- Extract the document handle: `await page.evaluateHandle(() => window.document)`
- Convert to Alfa page: `await Playwright.toPage(document)`
- Run the audit: `await Audit.run(alfaPage)` with WCAG 2.2 AA filter
- Return structured results (violations, their severity, affected elements, rule IDs)
- Handle errors gracefully (timeouts, 404s, etc.)

### 3. Report Generator (`src/report.ts`)

- Collect results from all pages
- Output formats (at least one, ideally all):
  - **CSV/XLSX** — one row per violation, columns: URL, Rule ID, Rule Description, WCAG Criterion, Severity, Element Selector, How to Fix
  - **HTML** — a summary dashboard with per-page drill-down
  - **JSON** — raw structured data for further processing
- Include a summary section: total pages scanned, total violations by severity, most common violations across the site

### 4. CLI Entry Point (`src/cli.ts`)

```
Usage: npx ts-node src/cli.ts <sitemap-url> [options]

Options:
  --output, -o       Output file path (default: ./report)
  --format, -f       Output format: csv, xlsx, json, html (default: csv)
  --concurrency, -c  Number of pages to check in parallel (default: 3)
  --filter           Regex to filter URLs from sitemap (e.g., "identify-wildlife")
  --timeout          Page load timeout in ms (default: 30000)
  --wait             Additional wait after load in ms (default: 2000)
  --wcag-level       WCAG conformance level: a, aa, aaa (default: aa)
  --verbose, -v      Print progress to console
```

## Key Implementation Details

### Concurrency Control

- Use a concurrency pool (e.g., p-limit or a simple semaphore) to run N pages in parallel
- Default to 3 concurrent pages to avoid overwhelming the target server
- Reuse a single browser instance, but create a new page/context for each URL

### Error Handling

- Log and skip pages that fail to load (404, timeout, SSL errors)
- Include failed pages in the report with their error status
- Don't let one failure stop the entire run

### Progress Reporting

- Print progress to console: `[42/187] Checking: https://example.com/page...`
- Show a summary when complete: pages checked, passed, failed, total violations

### Alfa Audit Configuration

```typescript
import { Audit } from "@siteimprove/alfa-test-utils";
import { Playwright } from "@siteimprove/alfa-playwright";

// Core audit pattern for each page:
const document = await page.evaluateHandle(() => window.document);
const alfaPage = await Playwright.toPage(document);
const result = await Audit.run(alfaPage);
// Extract violations from result
```

### Optional: Upload to Siteimprove Platform

If the customer has Siteimprove API credentials, results can be uploaded to their dashboard using `SIP.upload()` from `@siteimprove/alfa-test-utils`. This is optional but worth supporting as a flag:

```
--sip-user       Siteimprove Intelligence Platform username
--sip-api-key    Siteimprove Intelligence Platform API key
```

## Example Usage

```bash
# Check all pages in a sitemap, output as CSV
npx ts-node src/cli.ts https://wildlifeillinois.org/page-sitemap.xml -o wildlife-report -f csv -v

# Check only "identify-wildlife" pages
npx ts-node src/cli.ts https://wildlifeillinois.org/page-sitemap.xml --filter "identify-wildlife" -o wildlife-id-report -f xlsx

# Run with higher concurrency on a fast server
npx ts-node src/cli.ts https://example.com/sitemap.xml -c 5 -f html -o full-report
```

## Project Structure

```
siteimprove-sitemap-checker/
  src/
    cli.ts          # CLI entry point, argument parsing
    sitemap.ts      # Sitemap fetching and parsing
    auditor.ts      # Playwright + Alfa page auditing
    report.ts       # Report generation (CSV, XLSX, JSON, HTML)
    types.ts        # Shared TypeScript interfaces
  package.json
  tsconfig.json
  README.md
```

## References

- Siteimprove Alfa GitHub: https://github.com/Siteimprove/alfa
- Alfa Playwright integration: https://alfa.siteimprove.com/code-checker/getting-started/usage/playwright
- Alfa installation: https://alfa.siteimprove.com/code-checker/getting-started/installation
- Alfa audit configuration: https://alfa.siteimprove.com/code-checker/configuration/auditing
- Alfa report configuration: https://alfa.siteimprove.com/code-checker/configuration/reporting
- npm: @siteimprove/alfa-playwright: https://www.npmjs.com/package/@siteimprove/alfa-playwright
- npm: @siteimprove/alfa-test-utils: https://www.npmjs.com/package/@siteimprove/alfa-test-utils
