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

import { XMLParser } from "fast-xml-parser";

interface SitemapEntry {
  loc: string;
}

interface ParsedSitemap {
  urlset?: { url: SitemapEntry | SitemapEntry[] };
  sitemapindex?: { sitemap: SitemapEntry | SitemapEntry[] };
}

interface SitemapFetchOptions {
  jwtToken?: string;
  jwtCookieName?: string;
}

export async function fetchSitemapUrls(
  sitemapUrl: string,
  filterPattern?: string,
  authOptions?: SitemapFetchOptions
): Promise<string[]> {
  const headers: Record<string, string> = {
    "User-Agent": "siteimprove-sitemap-checker/1.0",
  };
  if (authOptions?.jwtToken) {
    headers["Cookie"] = `${authOptions.jwtCookieName ?? "token"}=${authOptions.jwtToken}`;
  }
  const response = await fetch(sitemapUrl, { headers });

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
        .map((loc) => fetchSitemapUrls(loc, filterPattern, authOptions))
    );

    return [...new Set(nestedUrls.flat())];
  }

  throw new Error(`Unrecognized sitemap format at ${sitemapUrl}`);
}
