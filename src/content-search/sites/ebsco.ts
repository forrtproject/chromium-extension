// EBSCOhost's current interface (research.ebsco.com/c/<profile>/search/results
// ?q=…). DOM checked 2026-08: a result is
// `article[data-auto="search-result-item"]` holding
// `section[data-auto="card"]`, whose title is
// `a[data-auto="result-item-title__link"]` pointing at
// `/c/<profile>/search/details/<recordId>`, followed by
// `dl[data-auto="result-item-metadata"]` with the contributors
// (`dd[data-auto="result-item-metadata-content--contributors"]`, one `li` per
// author, "Carruth, Nicholas P.") and the source line
// (`dd[data-auto="result-item-metadata-content--published"]`, "PLoS ONE,
// Jun 29, 2023, volume 18, issue 6"). The site is a Next.js app; paging and
// re-sorting replace the rows, which the observer's "new rows" trigger covers.
//
// Rows print no DOI, so the record id carries them: resolveSiteIds reads it
// from EBSCO's own citation endpoint (see @shared/ebsco-resolve).
// content-general also runs on research.ebsco.com on purpose: record detail
// pages print the DOI, which that script annotates, and result rows print none
// for it to pick up.

import {debugLog} from "@shared/debug";
import {normaliseEbscoRecordId, resolveEbscoIds} from "@shared/ebsco-resolve";
import type {RowExtraction, SearchSiteAdapter} from "./types";
import css from "./ebsco.css";

export const EBSCO: SearchSiteAdapter = {
    id: "ebsco",
    label: "EBSCOhost",
    hostnames: ["research.ebsco.com"],
    resultRow: 'article[data-auto="search-result-item"]',
    css,
    extractRow,
    // Under the metadata list, above the abstract snippet.
    panelPlacement: [{selector: 'dl[data-auto="result-item-metadata"]', position: "after"}],
    noticeTarget: (row) => row.querySelector<HTMLElement>('[data-auto="result-item-title"]'),
    resolveSiteIds: (ids) => resolveEbscoIds(ids),
};

function extractRow(row: HTMLElement): RowExtraction | null {
    const titleLink = row.querySelector<HTMLAnchorElement>('a[data-auto="result-item-title__link"]');
    const title = titleLink?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!title) return null;

    const siteId = normaliseEbscoRecordId(titleLink?.getAttribute("href") ?? "") ?? undefined;
    if (!siteId) debugLog(`EBSCOhost: no record id on "${title}"`);

    const published = row.querySelector('[data-auto="result-item-metadata-content--published"]')?.textContent ?? "";
    const yearMatch = published.match(/\b((?:19|20)\d{2})\b/);

    return {
        title,
        firstAuthor: firstAuthorSurname(row),
        year: yearMatch ? Number(yearMatch[1]) : null,
        sourceUrl: titleLink?.href ?? null,
        doi: null,
        confident: false,
        siteId,
    };
}

/** Contributors are listed surname-first, one `li` each: "Carruth,
 *  Nicholas P." → "Carruth". */
function firstAuthorSurname(row: HTMLElement): string | null {
    const contributors = row.querySelector('[data-auto="result-item-metadata-content--contributors"]');
    const first = contributors?.querySelector("li")?.textContent ?? contributors?.textContent ?? "";
    return first.split(/[,;]/)[0]?.replace(/\s+/g, " ").trim() || null;
}
