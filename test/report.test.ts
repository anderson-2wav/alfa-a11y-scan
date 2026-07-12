import { expect } from "chai";
import { buildReport, writeReport } from "../src/report.js";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("writeHTML both-engine structure", () => {
  async function renderHtml(pages: PageResult[], options: CliOptions): Promise<string> {
    const out = join(tmpdir(), `stage6-html-${Math.abs(hashStr(JSON.stringify(pages)))}`);
    const report = buildReport(pages, { ...options, output: out, format: "html" }, "https://x.test/sitemap.xml", 3);
    await writeReport(report, report.options);
    const html = await readFile(`${out}.html`, "utf-8");
    await rm(`${out}.html`, { force: true });
    return html;
  }
  // deterministic filename without Date.now/Math.random
  function hashStr(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  const bothPages: PageResult[] = [
    page({ url: "https://x.test/a", engine: "alfa", violations: [viol({ ruleId: "sia-r69", diagnosticMessage: "contrast" })] }),
    page({ url: "https://x.test/a", engine: "opena11y", violations: [viol({ ruleId: "COLOR_1", diagnosticMessage: "the @navigation@ landmark" })] }),
  ];

  it("shows dual attribution and two top-violations tables in both mode", async () => {
    const html = await renderHtml(bothPages, makeOptions());
    expect(html).to.contain("Siteimprove Alfa + OpenA11y Evaluation Library");
    expect(html).to.contain("Top Alfa Violations");
    expect(html).to.contain("Top OpenA11y Violations");
    // per-engine violation cards
    expect(html).to.contain("Alfa Violations");
    expect(html).to.contain("OpenA11y Violations");
  });

  it("keeps single-engine HTML to one top table and no dual attribution", async () => {
    const html = await renderHtml(
      [page({ engine: "opena11y", violations: [viol()] })],
      makeOptions({ engine: "opena11y" }),
    );
    expect(html).to.not.contain("Top Alfa Violations");
    expect(html).to.not.contain(" + OpenA11y Evaluation Library");
    expect(html).to.contain("Most Common Violations");
  });

  it("gates per-engine cantTell cards on warnings flags", async () => {
    // Fixtures with cantTell violations for both engines on the same URL
    const pagesWithCantTell: PageResult[] = [
      page({ url: "https://x.test/a", engine: "alfa", violations: [viol({ outcome: "cantTell" })] }),
      page({ url: "https://x.test/a", engine: "opena11y", violations: [viol({ outcome: "cantTell" })] }),
    ];

    // Test 1: With defaults (showWarningsAlfa: true, showWarningsOpena11y: false)
    const htmlDefault = await renderHtml(pagesWithCantTell, makeOptions());
    expect(htmlDefault).to.contain("Alfa Needs Review");
    expect(htmlDefault).to.not.contain("OpenA11y Needs Review");

    // Test 2: With showWarningsOpena11y enabled
    const htmlOpena11yOn = await renderHtml(pagesWithCantTell, makeOptions({ showWarningsOpena11y: true }));
    expect(htmlOpena11yOn).to.contain("OpenA11y Needs Review");
  });

  it("groups by URL with one details per URL and per-engine sub-blocks", async () => {
    const html = await renderHtml(bothPages, makeOptions());
    // exactly one details for the single URL
    const detailsCount = (html.match(/data-url="https:\/\/x\.test\/a"/g) || []).length;
    expect(detailsCount).to.equal(1);
    expect(html).to.contain('class="engine-block" data-engine="alfa"');
    expect(html).to.contain('class="engine-block" data-engine="opena11y"');
    // engine filter buttons present in both mode
    expect(html).to.contain('data-engine-filter="alfa"');
    expect(html).to.contain('data-engine-filter="opena11y"');
    // OpenA11y @term@ rendered as <code> inside its sub-table
    expect(html).to.contain("<code>navigation</code>");
  });

  it("omits the engine filter in single-engine mode", async () => {
    const html = await renderHtml(
      [page({ engine: "opena11y", violations: [viol()] })],
      makeOptions({ engine: "opena11y" }),
    );
    expect(html).to.not.contain("data-engine-filter");
  });
});
