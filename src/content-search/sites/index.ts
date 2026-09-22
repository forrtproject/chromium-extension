// Registry of search-results sites the search content script augments.
//
// ── Adding a site ────────────────────────────────────────────────────────────
// 1. Add the site's hostnames and results-page predicate (`ownsUrl`) to
//    SEARCH_SITES in @shared/search-sites. content-general stays idle on the
//    URLs it claims and works every other page on the host.
// 2. Create sites/<site>.ts exporting a SearchSiteAdapter (see types.ts) that
//    spreads that entry, and sites/<site>.css with the panel's placement rules
//    for that site's DOM. Check selectors on a live page and note the DOM path
//    in a comment.
// 3. Append the adapter to SEARCH_SITE_ADAPTERS below.
// 4. manifest.json: add the site's URL patterns to the content-search entry's
//    `matches`. Leave content-general's `exclude_matches` alone.
// 5. tests/unit/search-sites.test.ts checks the manifest and the ownership
//    split; add a results URL and a record URL for the site there.
// ─────────────────────────────────────────────────────────────────────────────

import {matchSearchSite} from "@shared/search-sites";
import type {SearchSiteAdapter} from "./types";
import {SCHOLAR} from "./scholar";
import {OPENALEX} from "./openalex";
import {PUBMED} from "./pubmed";
import {EUROPEPMC} from "./europepmc";
import {SEMANTIC_SCHOLAR} from "./semanticscholar";
import {SCOPUS} from "./scopus";
import {EBSCO} from "./ebsco";

export type {RowExtraction, SearchSiteAdapter} from "./types";

export const SEARCH_SITE_ADAPTERS: readonly SearchSiteAdapter[] = [SCHOLAR, OPENALEX, SEMANTIC_SCHOLAR, PUBMED, EUROPEPMC, SCOPUS, EBSCO];

export function resolveSearchSite(
    hostname: string,
    registry: readonly SearchSiteAdapter[] = SEARCH_SITE_ADAPTERS
): SearchSiteAdapter | null {
    return matchSearchSite(hostname, registry);
}
