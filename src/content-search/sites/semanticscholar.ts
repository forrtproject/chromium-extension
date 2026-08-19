// Semantic Scholar search (semanticscholar.org/search?q=…). DOM checked
// 2026-08: a result row is `.cl-paper-row.serp-papers__paper-row` — the
// `serp-papers__` half matters, because paper pages reuse `.cl-paper-row` for
// their citation and reference lists. Inside a row, `a[data-test-id=title-link]`
// wraps the `h2.cl-paper-title` and points at /paper/<slug>/<40-hex id>; each
// author is a `[data-test-id=author-list]` span; `.cl-paper-pubdates` holds the
// publication date ("1 May 1998" or "2025"). Below those comes either a TLDR
// summary (`.tldr-abstract-replacement`), a plain abstract snippet
// (`.cl-paper-abstract`) or neither, then the controls line
// (`.cl-paper-controls`) — all of them direct children of the row.
// Rows print no DOI, so the paper id
// is resolved to one through the Semantic Scholar API in one batched call.
// The site is a single-page app: rows arrive after load and are replaced on
// paging and re-sorting (checked live), which the observer's "new rows" trigger
// covers.
//
// content-general also runs on semanticscholar.org on purpose: paper pages
// (/paper/…) print the DOI, which that script annotates, and result rows print
// no DOI for it to pick up.

import {debugLog} from "@shared/debug";
import {resolveSemanticScholarIdsViaWorker} from "@shared/messages";
import {normaliseSemanticScholarId} from "@shared/semanticscholar-resolve";
import type {RowExtraction, SearchSiteAdapter} from "./types";
import css from "./semanticscholar.css";

export const SEMANTIC_SCHOLAR: SearchSiteAdapter = {
    id: "semanticscholar",
    label: "Semantic Scholar",
    hostnames: ["semanticscholar.org"],
    resultRow: ".cl-paper-row.serp-papers__paper-row",
    css,
    extractRow,
    // The panel goes beside the TLDR/abstract block: the site CSS turns the row
    // into a two-column grid, so a panel placed right after that block lands in
    // its right-hand column. Rows without a TLDR/abstract put it beside the
    // author/venue line instead.
    panelPlacement: [
        {selector: ".tldr-abstract-replacement, .cl-paper-abstract", position: "after"},
        {selector: "ul.cl-paper__bulleted-row:not(.cl-paper-controls)", position: "after"},
    ],
    resolveSiteIds: resolveSemanticScholarIdsViaWorker,
};

function extractRow(row: HTMLElement): RowExtraction | null {
    const titleLink = row.querySelector<HTMLAnchorElement>('a[data-test-id="title-link"]');
    // The title is split across <em> highlight spans, so collapse whitespace.
    const title = titleLink?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!title) return null;

    const firstAuthorName = row.querySelector<HTMLElement>('[data-test-id="author-list"]')
        ?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const nameTokens = firstAuthorName.split(" ").filter(Boolean);
    const firstAuthor = nameTokens[nameTokens.length - 1] ?? null;

    const yearMatch = row.querySelector<HTMLElement>(".cl-paper-pubdates")?.textContent?.match(/(?:19|20)\d{2}/);
    const year = yearMatch ? Number(yearMatch[0]) : null;

    const siteId = normaliseSemanticScholarId(titleLink?.getAttribute("href") ?? "") ?? undefined;
    if (!siteId) debugLog(`Semantic Scholar: no paper id on "${title}"`);
    return {
        title,
        firstAuthor,
        year,
        sourceUrl: titleLink?.href ?? null,
        doi: null,
        confident: false,
        siteId,
    };
}
