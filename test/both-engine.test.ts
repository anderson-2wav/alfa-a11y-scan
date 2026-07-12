import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect } from "chai";
import { chromium, type Browser } from "playwright";
import { auditUrl } from "../src/run-audit.js";
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

describe("auditUrl engine dispatch", function () {
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
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns one result per engine for 'both', Alfa first then OpenA11y", async () => {
    const results = await auditUrl(browser, `${baseUrl}/`, makeOptions());
    expect(results.map((r) => r.engine)).to.deep.equal(["alfa", "opena11y"]);
    expect(results.every((r) => r.url === `${baseUrl}/`)).to.equal(true);
  });

  it("returns a single result for single-engine modes", async () => {
    const alfa = await auditUrl(browser, `${baseUrl}/`, makeOptions({ engine: "alfa" }));
    expect(alfa.map((r) => r.engine)).to.deep.equal(["alfa"]);
    const oa = await auditUrl(browser, `${baseUrl}/`, makeOptions({ engine: "opena11y" }));
    expect(oa.map((r) => r.engine)).to.deep.equal(["opena11y"]);
  });

  it("gates each engine's cantTell by its own warnings flag", async () => {
    const results = await auditUrl(
      browser, `${baseUrl}/`,
      makeOptions({ showWarningsAlfa: false, showWarningsOpena11y: true }),
    );
    const oa = results.find((r) => r.engine === "opena11y")!;
    expect(oa.violations.some((v) => v.outcome === "cantTell")).to.equal(true);
  });
});
