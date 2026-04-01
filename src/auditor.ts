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

import { chromium, type Browser } from "playwright";
import { Playwright } from "@siteimprove/alfa-playwright";
import { Audit, Rules } from "@siteimprove/alfa-test-utils";
import type { CliOptions, PageResult, ViolationRecord } from "./types.js";

export { chromium };

export async function auditPage(
  browser: Browser,
  url: string,
  options: CliOptions,
  attempt = 1
): Promise<PageResult> {
  const start = Date.now();
  const context = await browser.newContext();
  await context.route("**youtube.com/**", route => route.abort());
  await context.route("**ytimg.com/**", route => route.abort());
  const page = await context.newPage();

  try {
    await page.goto(url, {
      timeout: options.timeout,
      waitUntil: "networkidle",
      // waitUntil: "load",
    });

    if (options.wait > 0) {
      await page.waitForTimeout(options.wait);
    }

    const documentHandle = await page.evaluateHandle(() => window.document);

    // alfa-playwright types are strict about the input type, but the runtime
    // accepts Playwright's JSHandle<Document> — use unknown cast as bridge.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const alfaPage = await Playwright.toPage(documentHandle as any);

    // Default is WCAG 2.1 AA (wcag21aaFilter).
    // "aaa" runs all rules by omitting the include filter.
    const ruleFilter =
      options.wcagLevel === "a"
        ? Rules.wcag20aaFilter  // closest approximation; no standalone A-only filter
        : options.wcagLevel === "aaa"
          ? undefined
          : Rules.wcag21aaFilter;  // default: WCAG 2.1 AA
    const auditOptions = ruleFilter ? { rules: { include: ruleFilter } } : {};

    const audit = await Audit.run(alfaPage, auditOptions);
    const wcagLevelDisplay =
      options.wcagLevel === "a" ? "2.0 A" :
      options.wcagLevel === "aaa" ? "2.1 AAA" : "2.1 AA";
    const violations = extractViolations(url, audit).filter(
      (v) =>
        !options.ignoreRules.includes(v.ruleId) &&
        (options.showWarnings || v.outcome === "failed")
    );
    violations.forEach((v) => { v.wcagLevel = wcagLevelDisplay; });

    // Batch-fetch outerHTML for all violation elements in a single evaluate call
    const xpaths = violations.map((v) => v.elementXPath);
    const htmlSnippets = await fetchElementHtml(page, xpaths);
    violations.forEach((v, i) => { v.elementHtml = htmlSnippets[i] ?? ""; });

    const counts = countByOutcome(audit);

    return {
      url,
      status: "ok",
      violations,
      passedRules: counts.passed,
      failedRules: counts.failed,
      cantTellRules: counts.cantTell,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    await context.close();
    if (attempt < 2) {
      return auditPage(browser, url, options, attempt + 1);
    }
    return {
      url,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      violations: [],
      passedRules: 0,
      failedRules: 0,
      cantTellRules: 0,
      durationMs: Date.now() - start,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

// audit.outcomes is Map<string (ruleUri), Sequence<Outcome>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractViolations(pageUrl: string, audit: any): ViolationRecord[] {
  const violations: ViolationRecord[] = [];

  const outcomes = audit?.outcomes;
  if (!outcomes || typeof outcomes[Symbol.iterator] !== "function") {
    return violations;
  }

  for (const [ruleUri, seq] of outcomes) {
    const ruleId: string = String(ruleUri).split("/").pop() ?? String(ruleUri);

    for (const outcome of seq) {
      if (outcome?.outcome !== "failed" && outcome?.outcome !== "cantTell") {
        continue;
      }

      try {
        const target = outcome.target;
        // path() returns the XPath like /html[1]/body[1]/...
        const xpath: string =
          typeof target?.path === "function" ? String(target.path()) : "";

        // For Text nodes target.name is undefined; use the constructor name instead
        const tagName: string =
          typeof target?.name === "string"
            ? target.name
            : (target?.constructor?.name ?? "unknown");

        let message = "";

        if (outcome.outcome === "failed") {
          // expectations is an Alfa Record — iterable as [key, Result<Diagnostic>]
          for (const [, result] of outcome.expectations ?? []) {
            if (typeof result?.isErr === "function" && result.isErr()) {
              const diagnostic = result.getErr();
              message =
                typeof diagnostic?.message === "string"
                  ? diagnostic.message
                  : String(diagnostic ?? "");
              break;
            }
          }
        } else {
          // cantTell has a single diagnostic property
          const diagnostic = outcome.diagnostic;
          message =
            typeof diagnostic?.message === "string"
              ? diagnostic.message
              : String(diagnostic ?? "");
        }

        violations.push({
          pageUrl,
          ruleId,
          ruleTitle: ruleId,
          wcagCriteria: extractCriteria(outcome),
          wcagLevel: "AA",
          outcome: outcome.outcome as "failed" | "cantTell",
          elementXPath: xpath,
          elementTag: tagName,
          elementHtml: "",
          diagnosticMessage: message,
          howToFixUrl: `https://alfa.siteimprove.com/rules/${ruleId}`,
        });
      } catch {
        // skip malformed outcome
      }
    }
  }

  return violations;
}

// Try to extract WCAG success criteria from the rule's requirements.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCriteria(outcome: any): string {
  try {
    const requirements = outcome?.rule?.requirements;
    if (!requirements || typeof requirements[Symbol.iterator] !== "function") {
      return "";
    }
    const chapters: string[] = [];
    for (const req of requirements) {
      const chapter = req?.chapter;
      if (typeof chapter === "string" && /^\d+\.\d+\.\d+$/.test(chapter)) {
        chapters.push(chapter);
      }
    }
    return chapters.join(", ");
  } catch {
    return "";
  }
}

// resultAggregates is Map<string (ruleUri), {failed, passed, cantTell}>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countByOutcome(audit: any): {
  passed: number;
  failed: number;
  cantTell: number;
} {
  let passed = 0,
    failed = 0,
    cantTell = 0;

  try {
    for (const [, agg] of audit?.resultAggregates ?? []) {
      passed += Number(agg?.passed) || 0;
      failed += Number(agg?.failed) || 0;
      cantTell += Number(agg?.cantTell) || 0;
    }
  } catch {
    // ignore
  }

  return { passed, failed, cantTell };
}

// Resolve all xpaths against the live DOM in one round-trip and return
// the outerHTML of each matched element (truncated to 2000 chars).
// For text nodes the parent element's outerHTML is used instead.
async function fetchElementHtml(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  xpaths: string[]
): Promise<string[]> {
  if (xpaths.length === 0) return [];
  try {
    return await page.evaluate((xpaths: string[]) => {
      const MAX = 2000;
      return xpaths.map((xpath) => {
        try {
          const result = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          const node = result.singleNodeValue;
          if (!node) return "";
          const target =
            node.nodeType === Node.TEXT_NODE
              ? node.parentElement
              : (node as Element);
          if (!target) return node.textContent?.trim() ?? "";
          const html = target.outerHTML;
          return html.length > MAX ? html.slice(0, MAX) + "…" : html;
        } catch {
          return "";
        }
      });
    }, xpaths);
  } catch {
    return xpaths.map(() => "");
  }
}
