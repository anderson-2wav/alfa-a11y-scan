import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect } from "chai";
import { chromium, type Browser, type Page } from "playwright";
import { injectOpenA11y } from "./helpers/opena11y.js";

/**
 * Live OpenA11Y evaluation against https://ncran.org (spec Step 3).
 *
 * Skipped unless LIVE_TESTS is set, so plain `npm test` stays offline and
 * deterministic. Run with: npm run test:live
 *
 * Saves the full toJSON(true) output to
 * .private/reference/ncran-opena11y-sample.json — the input for the Step 4
 * report-format decisions.
 */

const SAMPLE_PATH = fileURLToPath(
  new URL("../.private/reference/ncran-opena11y-sample.json", import.meta.url),
);

describe("opena11y live: ncran.org", function () {
  this.timeout(60000);

  let browser: Browser;
  let page: Page;

  before(async function () {
    if (!process.env.LIVE_TESTS) this.skip();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ bypassCSP: true });
    page = await context.newPage();
  });

  after(async () => {
    await browser?.close();
  });

  it("evaluates the rendered page and captures a sample", async () => {
    const t0 = Date.now();
    await page.goto("https://ncran.org", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const tLoaded = Date.now();

    await injectOpenA11y(page);
    const tInjected = Date.now();

    const parsed = await page.evaluate(() => {
      const lib = new (window as any).EvaluationLibrary();
      const r = lib.evaluateWCAG(
        document, document.title, location.href,
        "WCAG21", "AA", "ALL", "ARIA12", false,
      );
      return JSON.parse(r.toJSON(true));
    });
    const tEvaluated = Date.now();

    // aggregate for the spec's as-built notes
    const ruleValueDist: Record<string, number> = {};
    let elemViolations = 0, elemWarnings = 0, elemManualChecks = 0, elemPassed = 0;
    for (const rr of parsed.rule_results) {
      const k = `${rr.result_value}:${rr.result_value_nls}`;
      ruleValueDist[k] = (ruleValueDist[k] ?? 0) + 1;
      elemViolations += rr.results_violation;
      elemWarnings += rr.results_warning;
      elemManualChecks += rr.results_manual_check;
      elemPassed += rr.results_passed;
    }
    const summary = {
      url: parsed.eval_url,
      title: parsed.eval_title,
      ruleset: parsed.ruleset,
      totalRules: parsed.rule_results.length,
      ruleValueDist,
      elementCounts: {
        violations: elemViolations,
        warnings: elemWarnings,
        manualChecks: elemManualChecks,
        passed: elemPassed,
      },
      timingsMs: {
        pageLoad: tLoaded - t0,
        injection: tInjected - tLoaded,
        evaluate: tEvaluated - tInjected,
      },
    };
    console.log(JSON.stringify(summary, null, 2));

    await writeFile(SAMPLE_PATH, JSON.stringify(parsed, null, 2));
    console.log("      sample saved to", SAMPLE_PATH);

    expect(parsed.ruleset).to.equal("WCAG21");
    expect(parsed.rule_results).to.be.an("array").with.length.greaterThan(50);
    // a real-world page will always have at least some element results
    expect(elemViolations + elemWarnings + elemManualChecks + elemPassed)
      .to.be.greaterThan(0);
  });
});
