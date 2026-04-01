# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CLI tool that crawls an XML sitemap, audits each page for accessibility violations using Siteimprove Alfa (running in headless Chromium via Playwright), and outputs structured reports. Solves the problem that Siteimprove's online scanner doesn't render JavaScript — this tool audits the actual rendered DOM.

The full spec is in `siteimprove-sitemap-checker-spec.md`.

## Commands

```bash
# Install dependencies (first time)
npm install
npx playwright install chromium

# Run the CLI (loads .env automatically)
node --env-file=.env --import tsx src/cli.ts <sitemap-url> [options]

# Examples
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml -o report -f csv -v
node --env-file=.env --import tsx src/cli.ts https://example.com/sitemap.xml --filter "identify-wildlife" -f xlsx

# Type check only
npm run typecheck
```

## Architecture

Four modules in `src/`:

- **`cli.ts`** — entry point; parses args (`--output`, `--format`, `--concurrency`, `--filter`, `--timeout`, `--wait`, `--wcag-level`, `--verbose`, `--sip-user`, `--sip-api-key`); orchestrates the run
- **`sitemap.ts`** — fetches and parses sitemap XML; handles both `<urlset>` (flat) and `<sitemapindex>` (nested) formats; supports regex filtering
- **`auditor.ts`** — opens each URL in Playwright, waits for load, converts the document to Alfa's format via `Playwright.toPage()`, runs `Audit.run()` with WCAG 2.2 AA filter, returns structured violations
- **`report.ts`** — aggregates results across all pages; writes CSV, XLSX, JSON, or HTML output; includes a summary (total pages, violations by severity, most common violations)
- **`types.ts`** — shared TypeScript interfaces for violation records, audit results, and CLI options

## Key Patterns

**Concurrency**: use `p-limit` to run N pages in parallel (default 3). Reuse one browser instance; create a new page/context per URL.

**Core audit pattern** (per page):
```typescript
import { Audit } from "@siteimprove/alfa-test-utils";
import { Playwright } from "@siteimprove/alfa-playwright";

const document = await page.evaluateHandle(() => window.document);
const alfaPage = await Playwright.toPage(document);
const result = await Audit.run(alfaPage);
```

**Error handling**: log and skip pages that fail (404, timeout, SSL); include them in the report with their error status; never abort the full run on a single failure.

**Progress output**: `[42/187] Checking: https://example.com/page...`

**Optional Siteimprove platform upload**: if `--sip-user` and `--sip-api-key` are provided, upload results using `SIP.upload()` from `@siteimprove/alfa-test-utils`.

## References

- Alfa Playwright integration: https://alfa.siteimprove.com/code-checker/getting-started/usage/playwright
- Alfa audit configuration: https://alfa.siteimprove.com/code-checker/configuration/auditing
- Alfa report configuration: https://alfa.siteimprove.com/code-checker/configuration/reporting

## Publishing
This open source project is published to github using a strategy described in `github-publish.md`.
