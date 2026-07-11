import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";

const vendorPath = fileURLToPath(
  new URL("../../vendor/opena11y-evaluation-library.cjs", import.meta.url),
);

let cachedScript: string | undefined;

/**
 * The vendored bundle is CJS (`module.exports = EvaluationLibrary`) with no
 * UMD wrapper, so a plain script tag would expose nothing. Wrap it so the
 * class lands on `window.EvaluationLibrary`. Read and wrapped once per
 * process; ~1.7MB.
 */
export async function loadOpenA11yScript(): Promise<string> {
  if (cachedScript === undefined) {
    const source = await readFile(vendorPath, "utf8");
    cachedScript =
      "var module = { exports: {} };\n" +
      source +
      "\nwindow.EvaluationLibrary = module.exports;";
  }
  return cachedScript;
}

export async function injectOpenA11y(page: Page): Promise<void> {
  await page.addScriptTag({ content: await loadOpenA11yScript() });
}
