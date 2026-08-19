// Europe PMC search results (europepmc.org/search?query=…). DOM checked
// 2026-08: the Vue app renders rows as
// `.citation[id^="search-results--single--block-<id>"]` inside
// `ul.separated-list`; each holds `h3.citation-title > a` pointing at
// `/article/<source>/<id>` (MED for PubMed records, PPR for preprints, also
// PMC/AGR), `p.citation-author-list` with one link per author ("Wang B"),
// a journal paragraph ending in `span[id^="citation--id--pub-date"]`
// ("15 Jul 2026"), and `p.citation-labels` last. Paging and re-sorting replace
// the row elements, which the observer's "new rows" trigger picks up.
//
// Rows print no DOI. MED rows carry a PMID, resolved through NCBI's ID
// converter; every other source falls through to a title search. content-general
// also runs on europepmc.org on purpose: article pages print the DOI for it to
// annotate, and result rows have none for it to pick up.

import {resolvePmcIdsViaWorker} from "@shared/messages";
import {normalisePmid} from "@shared/pmc-resolve";
import type {RowExtraction, SearchSiteAdapter} from "./types";
import css from "./europepmc.css";

export const EUROPEPMC: SearchSiteAdapter = {
    id: "europepmc",
    label: "Europe PMC",
    hostnames: ["europepmc.org"],
    resultRow: '.citation[id^="search-results--single--block-"]',
    css,
    extractRow,
    // Below the row's action links, the last block of the citation.
    panelPlacement: [{selector: ".citation-labels", position: "after"}],
    noticeTarget: (row) => row.querySelector<HTMLElement>(".citation-title"),
    resolveSiteIds: (ids) => resolvePmcIdsViaWorker(ids, "pmid"),
};

function extractRow(row: HTMLElement): RowExtraction | null {
    const titleLink = row.querySelector<HTMLAnchorElement>(".citation-title a");
    const title = titleLink?.textContent?.trim() ?? "";
    if (!title) return null;

    // "/article/MED/42528595" — only MED ids are PMIDs.
    const medMatch = (titleLink?.getAttribute("href") ?? "").match(/\/article\/MED\/(\d+)/i);

    const pubDate = row.querySelector('[id^="citation--id--pub-date"]')?.textContent ?? "";
    const yearMatch = pubDate.match(/\b((?:19|20)\d{2})\b/);

    return {
        title,
        firstAuthor: firstAuthorSurname(row),
        year: yearMatch ? Number(yearMatch[1]) : null,
        sourceUrl: titleLink?.href ?? null,
        doi: null,
        confident: false,
        siteId: normalisePmid(medMatch?.[1]) ?? undefined,
    };
}

/** "Wang B" / "Chatzisarantis NL" → surname, initials last. */
function firstAuthorSurname(row: HTMLElement): string | null {
    const first = row.querySelector(".citation-author-list a")?.textContent?.trim() ?? "";
    const tokens = first.split(/\s+/).filter((token) => token && !/^[A-Z]{1,3}\.?$/.test(token));
    return tokens.join(" ") || null;
}
