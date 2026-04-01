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

import { XMLParser } from "fast-xml-parser";

interface SitemapEntry {
  loc: string;
}

interface ParsedSitemap {
  urlset?: { url: SitemapEntry | SitemapEntry[] };
  sitemapindex?: { sitemap: SitemapEntry | SitemapEntry[] };
}

export async function fetchSitemapUrls(
  sitemapUrl: string,
  filterPattern?: string
): Promise<string[]> {
  const response = await fetch(sitemapUrl, {
    headers: { "User-Agent": "siteimprove-sitemap-checker/1.0" },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch sitemap ${sitemapUrl}: ${response.status} ${response.statusText}`
    );
  }

  const xml = await response.text();
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const parsed = parser.parse(xml) as ParsedSitemap;

  if (parsed.urlset) {
    const rawUrls = parsed.urlset.url;
    const urlArray = Array.isArray(rawUrls) ? rawUrls : [rawUrls];
    let urls = urlArray
      .map((u) => u?.loc)
      .filter((loc): loc is string => typeof loc === "string" && loc.length > 0);

    if (filterPattern) {
      const re = new RegExp(filterPattern);
      urls = urls.filter((u) => re.test(u));
    }

    return [...new Set(urls)];
  }

  if (parsed.sitemapindex) {
    const rawSitemaps = parsed.sitemapindex.sitemap;
    const sitemapArray = Array.isArray(rawSitemaps)
      ? rawSitemaps
      : [rawSitemaps];

    const nestedUrls = await Promise.all(
      sitemapArray
        .map((s) => s?.loc)
        .filter((loc): loc is string => typeof loc === "string")
        .map((loc) => fetchSitemapUrls(loc, filterPattern))
    );

    return [...new Set(nestedUrls.flat())];
  }

  throw new Error(`Unrecognized sitemap format at ${sitemapUrl}`);
}
