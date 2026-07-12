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

import type { Browser } from "playwright";
import { injectOpenA11y } from "./opena11y-script.js";
import type { CliOptions, ConsoleMessage, PageResult, ViolationRecord } from "./types.js";

// Shape returned from the in-page normalization (ViolationRecord minus pageUrl).
interface RawViolation {
  ruleId: string;
  ruleTitle: string;
  wcagCriteria: string;
  wcagLevel: string;
  outcome: "failed" | "cantTell";
  elementXPath: string;
  elementTag: string;
  elementHtml: string;
  diagnosticMessage: string;
  howToFixUrl: string;
}

interface RawResult {
  violations: RawViolation[];
  passedRules: number;
  failedRules: number;
  cantTellRules: number;
}

function jwtCookiesForUrl(url: string, token: string, cookieName: string) {
  const { hostname } = new URL(url);
  return [{
    name: cookieName,
    value: token,
    domain: hostname,
    path: "/",
    httpOnly: false,
    secure: url.startsWith("https://"),
    sameSite: "Lax" as const,
  }];
}

export async function auditPageOpenA11y(
  browser: Browser,
  url: string,
  options: CliOptions,
  attempt = 1
): Promise<PageResult> {
  const start = Date.now();
  // bypassCSP so addScriptTag works on pages with a strict Content-Security-Policy
  const context = await browser.newContext({ bypassCSP: true });
  await context.route("**youtube.com/**", route => route.abort());
  await context.route("**ytimg.com/**", route => route.abort());
  if (options.jwtToken) {
    await context.addCookies(jwtCookiesForUrl(url, options.jwtToken, options.jwtCookieName));
  }
  const page = await context.newPage();
  const consoleMessages: ConsoleMessage[] = [];
  if (options.captureConsole) {
    page.on("console", (msg) => {
      const type = msg.type();
      if (type === "log" || type === "warning" || type === "error") {
        const normalizedType = type === "warning" ? "warn" : type as "log" | "error";
        if (options.verbose) {
          process.stdout.write(`  [console.${normalizedType}] ${msg.text()}\n`);
        }
        consoleMessages.push({ type: normalizedType, text: msg.text() });
      }
    });
  }

  try {
    await page.goto(url, {
      timeout: options.timeout,
      waitUntil: "domcontentloaded",
    });

    if (options.wait > 0) {
      await page.waitForTimeout(options.wait);
    }

    await injectOpenA11y(page);

    // OpenA11Y's level parameter genuinely filters rules (see spec Step 2).
    // "a" approximates to level A; ruleset is the project-standard WCAG 2.1.
    const level = options.wcagLevel === "a" ? "A" : options.wcagLevel === "aaa" ? "AAA" : "AA";

    const raw = await page.evaluate((wcagLevel): RawResult => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      // tsx (esbuild keepNames) wraps inner function definitions in __name()
      // helper calls; the helper doesn't exist in the serialized page context,
      // so provide it before any decorated definition runs.
      (globalThis as any).__name ??= (f: unknown) => f;
      const RULE_PASS = 2, RULE_MC = 3, RULE_WARN = 4, RULE_VIOLATION = 5;
      const EL_MC = 3, EL_WARN = 4, EL_VIOLATION = 5;

      // Alfa-style XPath: /html[1]/body[1]/main[1]/p[1]
      const xPathFor = (node: Element): string => {
        const parts: string[] = [];
        let el: Element | null = node;
        while (el && el.nodeType === 1) {
          const tag = el.tagName.toLowerCase();
          let idx = 1;
          let sib = el.previousElementSibling;
          while (sib) {
            if (sib.tagName === el.tagName) idx++;
            sib = sib.previousElementSibling;
          }
          parts.unshift(`${tag}[${idx}]`);
          el = el.parentElement;
        }
        return "/" + parts.join("/");
      };

      const truncate = (html: string): string =>
        html.length > 2000 ? html.slice(0, 2000) + "…" : html;

      const lib = new (window as any).EvaluationLibrary();
      const evalResult = lib.evaluateWCAG(
        document, document.title, location.href,
        "WCAG21", wcagLevel, "ALL", "ARIA12", false,
      );

      const violations: RawViolation[] = [];
      let passedRules = 0, failedRules = 0, cantTellRules = 0;

      for (const rr of evalResult.allRuleResults) {
        const ruleValue = rr.getResultValue();
        if (ruleValue === RULE_PASS) passedRules++;
        else if (ruleValue === RULE_VIOLATION) failedRules++;
        else if (ruleValue === RULE_WARN || ruleValue === RULE_MC) cantTellRules++;
        // NOT_APPLICABLE ignored

        if (ruleValue !== RULE_VIOLATION && ruleValue !== RULE_WARN && ruleValue !== RULE_MC) {
          continue;
        }

        const info = lib.getRuleInfo(rr.getRule());
        const ruleId: string = rr.getRule().rule_id;
        // getRuleInfo() returns HTML-formatted summaries (@term@ → <code>);
        // strip the tags so titles are plain text everywhere
        const ruleTitle: string = String(info.summary ?? ruleId).replace(/<[^>]+>/g, "");
        const wcagCriteria: string = info.wcag_primary?.title ?? "";
        const ruleWcagLevel: string = info.wcag_level ?? "";
        const howToFixUrl = `https://opena11y.github.io/evaluation-library/${info.filename}`;

        for (const er of rr.getAllResultsArray()) {
          const value = er.getResultValue();
          const outcome =
            value === EL_VIOLATION ? "failed" :
            value === EL_WARN || value === EL_MC ? "cantTell" :
            null;
          if (!outcome) continue; // PASS / HIDDEN

          const message: string =
            typeof er.getResultMessage === "function"
              ? er.getResultMessage()
              : (er.getDataForJSON?.()?.message ?? "");

          let elementXPath: string;
          let elementTag: string;
          let elementHtml = "";
          if (er.isElementResult) {
            const node = er.getNode();
            elementXPath = node ? xPathFor(node) : "";
            elementTag = er.getTagName();
            elementHtml = node?.outerHTML ? truncate(node.outerHTML) : "";
          } else {
            // page- or website-level result: no DOM node
            const identifier = er.getResultIdentifier();
            elementXPath = identifier;
            elementTag = identifier;
          }

          violations.push({
            ruleId,
            ruleTitle,
            wcagCriteria,
            wcagLevel: ruleWcagLevel,
            outcome,
            elementXPath,
            elementTag,
            elementHtml,
            diagnosticMessage: message,
            howToFixUrl,
          });
        }
      }

      return { violations, passedRules, failedRules, cantTellRules };
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }, level);

    // Same post-audit filtering semantics as the Alfa auditor. OpenA11Y has an
    // evaluateRuleList API for true cherry-picking; post-hoc ruleId filtering
    // is the deliberate interim (spec Step 5, deferred item).
    const violations: ViolationRecord[] = raw.violations
      .filter(
        (v) =>
          !options.ignoreRules.includes(v.ruleId) &&
          (options.onlyRules.length === 0 || options.onlyRules.includes(v.ruleId)) &&
          (options.showWarningsOpena11y || v.outcome === "failed")
      )
      .map((v) => ({ ...v, pageUrl: url }));

    // If violations found and retries remain, give the page another chance
    if (violations.length > 0 && attempt <= options.retry) {
      await context.close();
      console.log(`RETRY: ${url} becase of ${violations.length} violations`, consoleMessages);
      return auditPageOpenA11y(browser, url, options, attempt + 1);
    }

    return {
      url,
      status: "ok",
      violations,
      consoleMessages,
      passedRules: raw.passedRules,
      failedRules: raw.failedRules,
      cantTellRules: raw.cantTellRules,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    await context.close();
    const errMsg = err instanceof Error ? err.message : String(err);
    if (attempt <= options.retry) {
      console.log(`RETRY: ${url} because of page error:`, errMsg);
      return auditPageOpenA11y(browser, url, options, attempt + 1);
    }
    return {
      url,
      status: "error",
      errorMessage: errMsg,
      violations: [],
      consoleMessages: [],
      passedRules: 0,
      failedRules: 0,
      cantTellRules: 0,
      durationMs: Date.now() - start,
    };
  } finally {
    await context.close().catch(() => {});
  }
}
