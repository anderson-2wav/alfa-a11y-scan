# Accessibility Report for IDNR Websites by NGRREC

National Great Rivers Research and Education Center (NGRREC) develops and maintains several websites for IDNR Division of Wildlife, including
* [Wildlife Illinois](https://wildlifeillinois.org)
* [Hunt Illinois](https://huntillinois.org)
* [Outdoor Illinois Journal](https://outdoor.wildlifeillinois.org)
* [CICADA](https://cicada-idnr.org)
* [WILD](https://wild.wildlifeillinois.org) — a multi-purpose portal for NARP, NWCO, Deer Removal Permits, and (soon) hunting site information.

## Accessibility Regulations

Web accessibility has received significant attention ahead of the April 26, 2026 deadline set by the ADA Title II Web Accessibility Rule. Finalized by the Department of Justice in April 2024, the rule explicitly requires state and local governments to meet WCAG 2.1 Level AA for their websites and mobile applications. The deadline applies to entities serving 50,000 or more people; smaller entities have until April 26, 2027.

For many organizations this is a new obligation. For NGRREC and its IDNR websites, it is not. Because our projects receive federal financial assistance, accessibility has been a legal requirement for years. Section 504 of the Rehabilitation Act extends accessibility obligations to any organization receiving federal funding, and compliance is interpreted through the standard established by the 2017 Section 508 Refresh: WCAG 2.0 Level AA.

WCAG 2.1 is a strict superset of WCAG 2.0 — every criterion in 2.0 is preserved in 2.1, with additional criteria addressing mobile usability and cognitive accessibility. A site that fully meets WCAG 2.0 AA is already close to 2.1 AA compliance. For our sites, the April 2026 rule is therefore an upgrade to a newer standard, not a new requirement being imposed on work that has not previously been held to account.

## 2wav Advocacy for Accessibility and Practice

We have been active in web accessibility (A11Y) since before WCAG guidelines were required. We had employees reliant on assistive technologies as early as 2014, and we have actively advocated for A11Y and published on the topic, including a 2017 technical article on making accessible [geo-spatial applications](https://2wav.com/blogPage/making-mapbox-popups-accessible-2), and a 2023 [guide for developers](https://2wav.com/blogPage/an-interent-for-all) to evaluate and adjust web applications using pioneer tools created by the University of Illinois. 

## University of Illinois Accessibility

The University of Illinois, where we have many roots, was a pioneer in both physical and web accessibility. U of I helped write the WCAG guidelines and created the first widely used tools including:
* the [Functional Accessibility Evaluator (FAE)](https://accessibleit.disability.illinois.edu/tools/fae)
* it's companion tool the [AInspector for Firefox](https://addons.mozilla.org/en-US/firefox/addon/ainspector-wcag/)
* the [Open A11Y Library](https://opena11y.github.io/evaluation-library/), which these and other tools are based.

These are the primary tools used to assess U of I websites, which we have largely relied on to assess our applications.

## Siteimprove 

We know of three Siteimprove tools for A11Y evaluation:
* Online commercial site scanning tools only available to customer accounts. 
* A free browser extension for evaluating individual web pages.
* An open source evaluation library named [Siteimprove Alfa](https://github.com/Siteimprove/alfa), developed under a grant from the European Union. Notes in the code indicate that this is used by the Siteimprove browser extension, and likely the commerial tools. This library is under active development and is updated frequently. It is likely more up-to-date than either the browser extension or the online scanner.

We have evaluated results from these three tools:
* The browser extension and the online scanner generally return very similar results, _other than violations incorrectly reported by the scanner (described below)_.
* The [Siteimprove Alfa](https://github.com/Siteimprove/alfa) library finds several valid violations that are not reported by the extension or online scanner. This is probably due to its frequent updates.
* The browser extension and online scanner misidentify a couple issues, for example, it miscalculates the visible size of some elements. _We were easily able to change the sites to accommodate these ideosycrasies._ 

## Siteimprove Online Scanner & Browser Extension

The Siteimprove online site scanner appears to be the primary evaluation tool being used by IDNR. We have no direct access to this tool, and were advised to spot-check our pages using the free browser extension. Over the last year we investigated and and compensated for differences between the Siteimprove results and the U of I tools we previously used. However, manually spot-checking all 2000+ pages is not practical, hence our repeated requests to be given access to the whole-site online scanner.   

### Siteimprove Scanner Difficulties

Reports we received from the Siteimprove online scan indicate that the scanner does not let web pages fully form before evaluating the content. Many modern web applications dynamically construct or enhance the page in the browser itself after raw content from the webserver has been loaded. The rendered page is what human users and assistive technologies interact with. This practice is commonly called _hydration_, and it is present in most modern websites built with current generation frameworks such as Next, Nuxt, Angular, Meteor, or Ember. 

Some Siteimprove reports include temporary access to an inspector which shows the content which was evaluated by the tool. The inspector clearly shows page content before hydration by the browser, and therefore finds issues which are not present in the real web page. 

### Simple Example of a Misidentified Violation
The Siteimprove report for Hunt Illinois shows an error titled: "Visible label and accessible name do not match". The Siteimprove inspector for one instance of this error on the [Hunt Illinois Turkey](https://huntillinois.org/turkey/) page shows HTML which includes an improper **aria-label** attribute (colored in red for emphasis):

![Accessibility page report for Hunt Illinois—Turkey.png](Accessibility page report for Hunt Illinois—Turkey.png)

The _actual_ HTML for this page as rendered in a browser does _not_ contain this attribute (shown here in a browser inspector):

![Actual Turkey page](Inspector—Turkey.png)

The [Hunt Illinois Turkey](https://huntillinois.org/turkey/) page passes evaluation by both the Siteimprove browser extension and [Siteimprove Alfa](https://github.com/Siteimprove/alfa). It does not pass the online scanner because the actual page content is not being evaluated. 

![Siteimprove browser extension for Turkey](Siteimprove extenstion—Turkey.png)

## A Site Scanner Using Siteimprove's Alfa Evaluator

Manually spot-checking individual pages with a browser extension is not a practical path to compliance for a sites totalling over 2,000 pages. We needed a tool that could evaluate every page — using the same Siteimprove Alfa evaluation engine — against a fully rendered page.

No such tool existed, so we built one.

The tool, [alfa-a11y-scan](https://github.com/anderson-2wav/alfa-a11y-scan), is an open-source command-line utility developed by 2wav. It accepts an XML sitemap URL or a list of URLs, fetches each page in a headless Chromium browser (via Microsoft Playwright), waits for JavaScript to execute and the DOM to fully hydrate, then passes the rendered document to the Siteimprove Alfa evaluation library. Results are aggregated into structured reports in CSV, Excel, JSON, or HTML format.

Key design decisions:

- **Full Page rendering.** Pages are loaded in a real browser engine with JavaScript enabled. Alfa evaluates the same Document Object Model (DOM) that a user with assistive technology would encounter — not the raw HTML from the server.
- **Siteimprove Alfa evaluation engine.** The same open-source library underlying Siteimprove's browser extension and, likely, their commercial products. Results are directly comparable to Siteimprove's own tooling.
- **Whole-site coverage.** The tool crawls every URL in a sitemap or provided list in a single run, producing a complete inventory of violations across the entire site.
- **Configurable.** Concurrency, WCAG level (2.0 A, 2.1 AA, 2.1 AAA), per-page retries, URL filtering, and authenticated access via JWT cookies are all supported. Scan results can be filtered to suppress accepted exceptions.

The tool is released under the AGPL-3.0 open-source license. It was developed in response to the April 26, 2026 ADA Title II compliance deadline and is available for use by other organizations facing the same requirement.

## Site Reports
All sites have been evaluated using our A11Y scanner with no violations. Each report is available to download. A screenshot is included of the report.

### Wildlife Illinois

* 187 Pages
* 0 Violations
* [FULL REPORT](https://wildlifeillinois.org/wp-content/uploads/2026/04/wild-a11y-report.html)

![Wildlife Illinois Accessibility Report](Wildlife Illinois Accessibility Report.png)

### Hunt Illinois

* 293 Pages
* 0 Violations
* [FULL REPORT](https://wildlifeillinois.org/wp-content/uploads/2026/04/huntillinois-a11y-report.html)

![Hunt Illinois Report.png](Hunt Illinois Report.png)

### Outdoor Illinois Journal

* 1112 Pages
* 0 Violations

### CICADA

* 53 Pages
* 0 Violations
* [FULL REPORT](https://wildlifeillinois.org/wp-content/uploads/2026/04/cicada-a11y-report.html)

![CICADA REPORT](CICADA REPORT.png)

### WILD

* 32 Pages
* 0 Violations
* [FULL REPORT](https://wildlifeillinois.org/wp-content/uploads/2026/04/wild-a11y-report.html)

![WILD REPORT](WILD Report.png)
