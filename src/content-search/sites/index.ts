// Registry of search-results sites the search content script augments.
//
// ── Adding a site ────────────────────────────────────────────────────────────
// 1. Create sites/<site>.ts exporting a SearchSiteAdapter (see types.ts) and
//    sites/<site>.css with the panel's placement rules for that site's DOM.
//    Check selectors on a live page and note the DOM path in a comment.
// 2. Append the adapter to SEARCH_SITE_ADAPTERS below.
// 3. manifest.json: add the site's URL patterns to the content-search entry's
//    `matches`. If the site prints DOIs in its result rows, also add them to
//    content-general's `exclude_matches`, or both scripts will annotate them.
// 4. tests/unit/search-sites.test.ts checks the manifest covers every host.
// ─────────────────────────────────────────────────────────────────────────────

import type {SearchSiteAdapter} from "./types";
import {SCHOLAR} from "./scholar";
import {OPENALEX} from "./openalex";
import {PUBMED} from "./pubmed";
import {EUROPEPMC} from "./europepmc";
import {SEMANTIC_SCHOLAR} from "./semanticscholar";

export type {RowExtraction, SearchSiteAdapter} from "./types";

export const SEARCH_SITE_ADAPTERS: readonly SearchSiteAdapter[] = [SCHOLAR, OPENALEX, SEMANTIC_SCHOLAR, PUBMED, EUROPEPMC];

function normaliseHost(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, "");
}

export function resolveSearchSite(
    hostname: string,
    registry: readonly SearchSiteAdapter[] = SEARCH_SITE_ADAPTERS
): SearchSiteAdapter | null {
    const host = normaliseHost(hostname);
    return registry.find((adapter) =>
        adapter.hostnames.some((h) => host === normaliseHost(h) || host.endsWith(`.${normaliseHost(h)}`))
    ) ?? null;
}
