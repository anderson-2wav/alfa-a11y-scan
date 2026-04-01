// Copyright (c) 2026 2wav inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

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
  passedRules: number;
  failedRules: number;
  cantTellRules: number;
  durationMs: number;
}

export interface AuditReport {
  generatedAt: string;
  sourceUrl: string;
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
