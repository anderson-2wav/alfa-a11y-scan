import { expect } from "chai";
import { chromium, type Browser, type Page } from "playwright";
import { injectOpenA11y } from "./helpers/opena11y.js";

/**
 * Exploration tests for the vendored OpenA11Y evaluation library (v2.2.2).
 *
 * The library is browser-only (unguarded getComputedStyle etc.), so every
 * call runs inside page.evaluate against a small fixture. The fixture is
 * served at a real URL via page.route because the library crashes on
 * about:blank pages (ImageElement calls `new URL(img.src)`).
 *
 * These tests pin down the input/output contract the production integration
 * will rely on. Findings documented in .private/specs/opena11y-spec.md Step 2.
 */

const FIXTURE = `<!DOCTYPE html>
<html lang="en">
<head><title>Fixture</title></head>
<body>
  <main>
    <h1>Test page</h1>
    <img src="x.png">
    <a href="#"></a>
    <p style="color:#999;background:#fff;">Low contrast text</p>
  </main>
</body>
</html>`;

type RuleResultJson = {
  rule_id: string;
  rule_summary: string;
  success_criteria_code: string;
  success_criteria_nls: string;
  result_value: number;
  result_value_nls: string;
  results_violation: number;
  results_warning: number;
  results_manual_check: number;
  results_passed: number;
  results: Array<{
    result_type: number;
    result_value: number;
    result_identifier: string;
    message: string;
  }>;
};

describe("opena11y exploration", function () {
  this.timeout(30000);

  let browser: Browser;
  let page: Page;

  /** Run evaluateWCAG in-page and return the parsed toJSON(true) output. */
  async function evaluate(level: "A" | "AA" | "AAA" = "AA"): Promise<any> {
    return page.evaluate((lvl) => {
      const lib = new (window as any).EvaluationLibrary();
      const r = lib.evaluateWCAG(
        document, document.title, location.href,
        "WCAG21", lvl, "ALL", "ARIA12", false,
      );
      // toJSON returns a JSON *string*
      return JSON.parse(r.toJSON(true));
    }, level);
  }

  before(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.route("http://fixture.test/**", (route) =>
      route.fulfill({ contentType: "text/html", body: FIXTURE }),
    );
    await page.goto("http://fixture.test/");
    await injectOpenA11y(page);
  });

  after(async () => {
    await browser?.close();
  });

  it("exposes EvaluationLibrary on window after injection", async () => {
    const type = await page.evaluate(() => typeof (window as any).EvaluationLibrary);
    expect(type).to.equal("function");
  });

  it("CONSTANTS enums match the values the integration will hardcode", async () => {
    const constants = await page.evaluate(() => {
      const lib = new (window as any).EvaluationLibrary();
      const c = lib.CONSTANTS;
      return {
        VERSION: c.VERSION,
        RESULT_VALUE: c.RESULT_VALUE,
        RULE_RESULT_VALUE: c.RULE_RESULT_VALUE,
        RULESET: c.RULESET,
      };
    });
    expect(constants.VERSION).to.equal("2.2.2");
    expect(constants.RESULT_VALUE).to.deep.equal({
      UNDEFINED: 0, PASS: 1, HIDDEN: 2, MANUAL_CHECK: 3, WARNING: 4, VIOLATION: 5,
    });
    expect(constants.RULE_RESULT_VALUE).to.deep.equal({
      UNDEFINED: 0, NOT_APPLICABLE: 1, PASS: 2, MANUAL_CHECK: 3, WARNING: 4, VIOLATION: 5,
    });
    expect(constants.RULESET).to.deep.equal({
      WCAG20: "WCAG20", WCAG21: "WCAG21", WCAG22: "WCAG22",
    });
  });

  it("toJSON(true) returns a JSON string with the expected top-level shape", async () => {
    const parsed = await evaluate();
    expect(Object.keys(parsed)).to.have.members([
      "eval_url", "eval_url_encoded", "eval_title", "ruleset",
      "scope_filter", "version", "date", "rule_results",
    ]);
    expect(parsed.eval_url).to.equal("http://fixture.test/");
    expect(parsed.eval_title).to.equal("Fixture");
    expect(parsed.ruleset).to.equal("WCAG21");
    expect(parsed.version).to.equal("2.2.2");
    expect(parsed.rule_results).to.be.an("array").with.length.greaterThan(100);
    // NOTE: no wcag_level key at the top level — the requested level is not
    // echoed back in the JSON.
  });

  it("detects the planted violations (missing alt, empty link, low contrast)", async () => {
    const parsed = await evaluate();
    const violating = (parsed.rule_results as RuleResultJson[])
      .filter((rr) => rr.results_violation > 0)
      .map((rr) => rr.rule_id);
    expect(violating).to.include("IMAGE_1");  // img must have alt
    expect(violating).to.include("LINK_1");   // link must have accessible name
    expect(violating).to.include("COLOR_1");  // text contrast minimum
  });

  it("rule results carry the fields the ViolationRecord mapping needs", async () => {
    const parsed = await evaluate();
    const color1 = (parsed.rule_results as RuleResultJson[])
      .find((rr) => rr.rule_id === "COLOR_1")!;
    expect(color1.rule_summary).to.equal("Color contrast of text: Minimum");
    expect(color1.success_criteria_code).to.equal("1.4.3");
    expect(color1.success_criteria_nls).to.contain("Contrast (Minimum)");
    expect(color1.result_value).to.equal(5); // RULE_RESULT_VALUE.VIOLATION
    expect(color1.result_value_nls).to.equal("V");

    // element results include *passed* elements too — extraction must filter
    // on element result_value, not just take results[] wholesale
    const values = color1.results.map((er) => er.result_value);
    expect(values).to.include(5); // the violating <p>
    expect(values).to.include(1); // the passing <h1>
    for (const er of color1.results) {
      expect(Object.keys(er)).to.have.members([
        "result_type", "result_value", "result_identifier", "message",
      ]);
    }
    // element JSON has no XPath and no outerHTML — identifier is tag-name-ish
    const violation = color1.results.find((er) => er.result_value === 5)!;
    expect(violation.result_identifier).to.equal("p");
    expect(violation.message).to.contain("CCR of 2.8");
  });

  it("live ElementResult API exposes the DOM node (basis for XPath + outerHTML)", async () => {
    const sample = await page.evaluate(() => {
      const lib = new (window as any).EvaluationLibrary();
      const r = lib.evaluateWCAG(
        document, document.title, location.href,
        "WCAG21", "AA", "ALL", "ARIA12", false,
      );
      const rr = r.getRuleResult("COLOR_1");
      const er = rr.getAllResultsArray()
        .find((e: any) => e.getResultValue() === 5); // RESULT_VALUE.VIOLATION
      const node = er.getNode();
      return {
        tagName: er.getTagName(),
        ordinalPosition: er.getOrdinalPosition(),
        identifier: er.getResultIdentifier(),
        nodeIsElement: node instanceof Element,
        outerHtml: node.outerHTML,
      };
    });
    expect(sample.tagName).to.equal("p");
    expect(sample.identifier).to.equal("p");
    expect(sample.ordinalPosition).to.be.a("number");
    expect(sample.nodeIsElement).to.equal(true);
    expect(sample.outerHtml).to.contain("Low contrast text");
  });

  it("getRuleInfo provides wcag_level and information_links (howToFixUrl source)", async () => {
    const info = await page.evaluate(() => {
      const lib = new (window as any).EvaluationLibrary();
      const r = lib.evaluateWCAG(
        document, document.title, location.href,
        "WCAG21", "AA", "ALL", "ARIA12", false,
      );
      const i = lib.getRuleInfo(r.getRuleResult("COLOR_1").getRule());
      return {
        id: i.id,
        wcag_level: i.wcag_level,
        primaryUrl: i.wcag_primary?.url,
        firstLink: i.information_links?.[0]?.url,
      };
    });
    expect(info.id).to.equal("Color 1"); // human-readable, differs from rule_id
    expect(info.wcag_level).to.equal("AA");
    expect(info.primaryUrl).to.contain("w3.org/TR/WCAG");
    console.log("      wcag_primary.url:", info.primaryUrl);
    expect(info.firstLink).to.be.a("string").and.contain("http");
  });

  it("level parameter filters which rules are evaluated", async () => {
    const [a, aa, aaa] = await Promise.all([
      evaluate("A"), evaluate("AA"), evaluate("AAA"),
    ]);
    const counts = {
      A: a.rule_results.length,
      AA: aa.rule_results.length,
      AAA: aaa.rule_results.length,
    };
    // Documented in the spec's as-built notes; pin the relationship
    expect(counts.A).to.be.lessThanOrEqual(counts.AA);
    expect(counts.AA).to.be.lessThanOrEqual(counts.AAA);
    // AA must include the AA-level COLOR_1 rule; A must not
    const aIds = a.rule_results.map((rr: RuleResultJson) => rr.rule_id);
    const aaIds = aa.rule_results.map((rr: RuleResultJson) => rr.rule_id);
    expect(aaIds).to.include("COLOR_1");
    console.log("      rule counts by level:", JSON.stringify(counts),
      "| COLOR_1 in A:", aIds.includes("COLOR_1"));
  });
});
