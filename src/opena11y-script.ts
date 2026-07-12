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

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";

const vendorPath = fileURLToPath(
  new URL("../vendor/opena11y-evaluation-library.cjs", import.meta.url),
);

let cachedScript: string | undefined;

// The vendored bundle is CJS (`module.exports = EvaluationLibrary`) with no
// UMD wrapper, so a plain script tag would expose nothing. Wrap it so the
// class lands on `window.EvaluationLibrary`. Read and wrapped once per
// process; ~1.7MB.
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
