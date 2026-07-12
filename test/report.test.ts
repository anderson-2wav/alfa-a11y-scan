import { expect } from "chai";
import { buildReport } from "../src/report.js";
import type { CliOptions, PageResult, ViolationRecord } from "../src/types.js";

function makeOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    output: "./report",
    format: "html",
    engine: "both",
    concurrency: 1,
    timeout: 15000,
    wait: 0,
    pause: 0,
    wcagLevel: "aa",
    includeAria: true,
    verbose: false,
    ignoreRules: [],
    onlyRules: [],
    showWarningsAlfa: true,
    showWarningsOpena11y: false,
    jwtCookieName: "token",
    captureConsole: false,
    retry: 0,
    stopOnFail: false,
    ...overrides,
  };
}

function viol(overrides: Partial<ViolationRecord> = {}): ViolationRecord {
  return {
    pageUrl: "https://x.test/a",
    ruleId: "COLOR_1",
    ruleTitle: "Text contrast",
    wcagCriteria: "1.4.3 Contrast (Minimum)",
    wcagLevel: "AA",
    outcome: "failed",
    elementXPath: "/html/body/main/p[1]",
    elementTag: "p",
    elementHtml: "<p>hi</p>",
    diagnosticMessage: "CCR of 2.3",
    howToFixUrl: "https://opena11y.github.io/evaluation-library/rule-color-1.html",
    ...overrides,
  };
}

function page(overrides: Partial<PageResult> = {}): PageResult {
  return {
    url: "https://x.test/a",
    engine: "alfa",
    status: "ok",
    violations: [],
    consoleMessages: [],
    passedRules: 0,
    failedRules: 0,
    cantTellRules: 0,
    durationMs: 1,
    ...overrides,
  };
}

describe("buildReport per-engine aggregation", () => {
  it("splits totals by engine and counts distinct URLs", () => {
    const pages: PageResult[] = [
      page({ url: "https://x.test/a", engine: "alfa", violations: [viol({ ruleId: "sia-r69" })] }),
      page({ url: "https://x.test/a", engine: "opena11y", violations: [
        viol({ ruleId: "COLOR_1" }),
        viol({ ruleId: "COLOR_1" }),
        viol({ ruleId: "LINK_1", outcome: "cantTell" }),
      ] }),
      page({ url: "https://x.test/b", engine: "alfa", status: "error", errorMessage: "boom" }),
      page({ url: "https://x.test/b", engine: "opena11y", violations: [viol({ ruleId: "COLOR_1" })] }),
    ];
    const report = buildReport(pages, makeOptions(), "https://x.test/sitemap.xml", 5);
    const s = report.summary;

    expect(s.totalPages).to.equal(2);              // distinct URLs
    expect(s.pagesWithErrors).to.equal(1);         // /b errored (alfa)
    expect(s.totalViolations).to.equal(4);         // 1 alfa + 3 opena11y failed
    expect(s.totalCantTell).to.equal(1);           // 1 opena11y cantTell
    expect(s.engines).to.deep.equal(["alfa", "opena11y"]);

    expect(s.byEngine.alfa!.totalViolations).to.equal(1);
    expect(s.byEngine.alfa!.pagesWithErrors).to.equal(1);
    expect(s.byEngine.opena11y!.totalViolations).to.equal(3);
    expect(s.byEngine.opena11y!.totalCantTell).to.equal(1);
    // ranked, failed-only, COLOR_1 (x3 across both /a and /b) leads OpenA11y
    expect(s.byEngine.opena11y!.violationsByRule[0]).to.deep.include({ ruleId: "COLOR_1", count: 3 });
  });

  it("reports a single engine when only one ran", () => {
    const report = buildReport(
      [page({ engine: "opena11y", violations: [viol()] })],
      makeOptions({ engine: "opena11y" }),
      "src",
    );
    expect(report.summary.engines).to.deep.equal(["opena11y"]);
    expect(report.summary.byEngine.alfa).to.equal(undefined);
    expect(report.summary.totalPages).to.equal(1);
  });
});
