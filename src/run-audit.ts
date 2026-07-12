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
import { auditPage } from "./auditor.js";
import { auditPageOpenA11y } from "./opena11y-auditor.js";
import type { CliOptions, EngineName, PageResult } from "./types.js";

/**
 * Audit one URL with the engine(s) selected by `options.engine`.
 * Single-engine modes return one PageResult; "both" returns two,
 * Alfa first then OpenA11y (two page loads, isolated failure/retry).
 */
export async function auditUrl(
  browser: Browser,
  url: string,
  options: CliOptions,
): Promise<PageResult[]> {
  const engines: EngineName[] =
    options.engine === "both" ? ["alfa", "opena11y"] : [options.engine];

  const results: PageResult[] = [];
  for (const engine of engines) {
    results.push(
      engine === "opena11y"
        ? await auditPageOpenA11y(browser, url, options)
        : await auditPage(browser, url, options),
    );
  }
  return results;
}
