import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect } from "chai";
import { chromium, type Browser } from "playwright";
import { auditPageOpenA11y } from "../src/opena11y-auditor.js";
import type { CliOptions } from "../src/types.js";

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

function makeOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    output: "./report",
    format: "html",
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
    engine: "opena11y",
    ...overrides,
  };
}

describe("opena11y auditor", function () {
  this.timeout(30000);

  let browser: Browser;
  let server: Server;
  let baseUrl: string;

  before(async () => {
    browser = await chromium.launch({ headless: true });
    server = createServer((req, res) => {
      if (req.url?.endsWith(".png")) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end(FIXTURE);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  it("returns a PageResult with the planted violations", async () => {
    const result = await auditPageOpenA11y(browser, `${baseUrl}/`, makeOptions());

    expect(result.status).to.equal("ok");
    expect(result.url).to.equal(`${baseUrl}/`);
    expect(result.durationMs).to.be.greaterThan(0);
    expect(result.failedRules).to.be.greaterThan(0);
    expect(result.passedRules).to.be.greaterThan(0);
    expect(result.cantTellRules).to.be.greaterThan(0);

    const ruleIds = result.violations.map((v) => v.ruleId);
    expect(ruleIds).to.include("IMAGE_1");
    expect(ruleIds).to.include("LINK_1");
    expect(ruleIds).to.include("COLOR_1");
    // showWarningsOpena11y=false → only failed outcomes
    for (const v of result.violations) {
      expect(v.outcome).to.equal("failed");
    }
  });

  it("populates element fields from the live DOM (xpath, tag, html)", async () => {
    const result = await auditPageOpenA11y(browser, `${baseUrl}/`, makeOptions());

    const img = result.violations.find((v) => v.ruleId === "IMAGE_1")!;
    expect(img.elementXPath).to.equal("/html[1]/body[1]/main[1]/img[1]");
    expect(img.elementTag).to.equal("img");
    expect(img.elementHtml).to.contain("<img");
    expect(img.pageUrl).to.equal(`${baseUrl}/`);

    const color = result.violations.find((v) => v.ruleId === "COLOR_1")!;
    expect(color.elementXPath).to.equal("/html[1]/body[1]/main[1]/p[1]");
    expect(color.diagnosticMessage).to.contain("CCR");
  });

  it("maps rule metadata (title, criteria, level, docs url)", async () => {
    const result = await auditPageOpenA11y(browser, `${baseUrl}/`, makeOptions());

    const color = result.violations.find((v) => v.ruleId === "COLOR_1")!;
    expect(color.ruleTitle).to.equal("Color contrast of text: Minimum");
    expect(color.wcagCriteria).to.contain("1.4.3");
    expect(color.wcagLevel).to.equal("AA");
    expect(color.howToFixUrl).to.equal(
      "https://opena11y.github.io/evaluation-library/rule-color-1.html",
    );

    const img = result.violations.find((v) => v.ruleId === "IMAGE_1")!;
    expect(img.wcagLevel).to.equal("A");
  });

  it("includes cantTell (warnings + manual checks) only when showWarningsOpena11y is set", async () => {
    const result = await auditPageOpenA11y(
      browser, `${baseUrl}/`, makeOptions({ showWarningsOpena11y: true }),
    );
    const cantTell = result.violations.filter((v) => v.outcome === "cantTell");
    expect(cantTell.length).to.be.greaterThan(0);
    // page-level results carry "page" as their locator
    const pageLevel = cantTell.find((v) => v.elementXPath === "page");
    expect(pageLevel, "expected at least one page-level cantTell result").to.exist;
  });

  it("applies ignoreRules and onlyRules filters", async () => {
    const ignored = await auditPageOpenA11y(
      browser, `${baseUrl}/`, makeOptions({ ignoreRules: ["COLOR_1"] }),
    );
    expect(ignored.violations.map((v) => v.ruleId)).to.not.include("COLOR_1");

    const only = await auditPageOpenA11y(
      browser, `${baseUrl}/`, makeOptions({ onlyRules: ["IMAGE_1"] }),
    );
    expect(only.violations.length).to.be.greaterThan(0);
    for (const v of only.violations) {
      expect(v.ruleId).to.equal("IMAGE_1");
    }
  });

  it("returns an error PageResult for an unreachable URL", async () => {
    const result = await auditPageOpenA11y(
      browser, "http://127.0.0.1:1/", makeOptions({ timeout: 3000 }),
    );
    expect(result.status).to.equal("error");
    expect(result.errorMessage).to.be.a("string").and.not.empty;
    expect(result.violations).to.deep.equal([]);
  });
});
