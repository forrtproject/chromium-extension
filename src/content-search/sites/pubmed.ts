// PubMed search results (pubmed.ncbi.nlm.nih.gov/?term=…). DOM checked
// 2026-08: rows are `article.full-docsum` holding
// `.docsum-wrap > .docsum-content`, which carries
// `a.docsum-title[data-article-id=<pmid>]`, a `.docsum-citation` block with
// `.docsum-authors.full-authors` ("Hagger MS, Wood C, …") and
// `.docsum-journal-citation.full-journal-citation`
// ("Psychol Bull. 2010 Jul;136(4):495-525. doi: 10.1037/a0019486."), then an
// optional `.docsum-snippet`.
//
// Most rows carry that explicit `doi:` field, which needs no doi.org check.
// Rows without one fall back to the PMID, resolved through NCBI's ID
// converter — which only knows articles with a PMC record, so unresolved
// PMIDs drop through to a title search.
//
// Search results live at the site root with a query string, so content-general
// is excluded from `/?*` only (see manifest.json): it would otherwise annotate
// the same printed DOIs a second time. Article pages `/<pmid>/` keep it.

import {normaliseDOI} from "@shared/doi-normalise";
import {resolvePmcIdsViaWorker} from "@shared/messages";
import {normalisePmid} from "@shared/pmc-resolve";
import type {DoiString} from "@shared/types";
import type {RowExtraction, SearchSiteAdapter} from "./types";
import css from "./pubmed.css";

export const PUBMED: SearchSiteAdapter = {
    id: "pubmed",
    label: "PubMed",
    hostnames: ["pubmed.ncbi.nlm.nih.gov"],
    resultRow: "article.full-docsum",
    css,
    extractRow,
    // Last block of the row's single text column, under the snippet.
    panelPlacement: [{selector: ".docsum-content", position: "append"}],
    noticeTarget: (row) => row.querySelector<HTMLElement>(".docsum-title"),
    resolveSiteIds: (ids) => resolvePmcIdsViaWorker(ids, "pmid"),
};

function extractRow(row: HTMLElement): RowExtraction | null {
    const titleLink = row.querySelector<HTMLAnchorElement>("a.docsum-title");
    const title = titleLink?.textContent?.trim() ?? "";
    if (!title) return null;

    const citation = row.querySelector(".docsum-journal-citation.full-journal-citation")?.textContent ?? "";
    const doi = extractCitationDoi(citation);

    // "Psychol Bull. 2010 Jul;136(4):495-525." — the DOI that follows carries
    // digits of its own, so read the year from the text before it.
    const beforeDoi = citation.split(/\bdoi:/i)[0] ?? "";
    const yearMatch = beforeDoi.match(/\b((?:19|20)\d{2})\b/);

    return {
        title,
        firstAuthor: firstAuthorSurname(row),
        year: yearMatch ? Number(yearMatch[1]) : null,
        sourceUrl: titleLink?.href ?? null,
        doi,
        confident: doi !== null,
        siteId: doi ? undefined : normalisePmid(titleLink?.getAttribute("data-article-id")) ?? undefined,
    };
}

/** The `doi: 10.1037/a0019486.` field PubMed prints in the journal citation. */
function extractCitationDoi(citation: string): DoiString | null {
    const match = citation.match(/\bdoi:\s*(\S+)/i);
    if (!match) return null;
    return normaliseDOI(match[1].replace(/[.,;]+$/, ""));
}

/** "Hagger MS, Wood C, Stiff C." → "Hagger" (surname first, initials last). */
function firstAuthorSurname(row: HTMLElement): string | null {
    const authors = row.querySelector(".docsum-authors.full-authors")?.textContent ?? "";
    const first = authors.split(",")[0]?.trim() ?? "";
    const tokens = first.split(/\s+/).filter((token) => token && !/^[A-Z]{1,3}\.?$/.test(token));
    return tokens.join(" ") || null;
}
