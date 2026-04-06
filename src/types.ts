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

export interface CliOptions {
  sitemapUrl?: string;
  urlsFile?: string;
  baseUrl?: string;
  output: string;
  format: "csv" | "xlsx" | "json" | "html";
  concurrency: number;
  filter?: string;
  timeout: number;
  wait: number;
  pause: number;
  wcagLevel: "a" | "aa" | "aaa";
  verbose: boolean;
  ignoreRules: string[];
  showWarnings: boolean;
  jwtToken?: string;
  jwtCookieName: string;
  captureConsole: boolean;
  consoleLogFile?: string;
  retry: number;
  stopOnFail: boolean;
}

export interface ConsoleMessage {
  type: "log" | "warn" | "error";
  text: string;
}

export interface ViolationRecord {
  pageUrl: string;
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

export interface PageResult {
  url: string;
  status: "ok" | "error";
  errorMessage?: string;
  violations: ViolationRecord[];
  consoleMessages: ConsoleMessage[];
  passedRules: number;
  failedRules: number;
  cantTellRules: number;
  durationMs: number;
}

export interface AuditReport {
  generatedAt: string;
  sourceUrl: string;
  durationMs: number;
  options: CliOptions;
  summary: {
    totalPages: number;
    pagesWithErrors: number;
    totalViolations: number;
    totalCantTell: number;
    violationsByRule: Array<{ ruleId: string; ruleTitle: string; count: number }>;
  };
  pages: PageResult[];
}
