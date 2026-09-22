// Which pages the search content script owns.
//
// content-search and content-general are both injected on the search sites
// below (Scholar excepted: manifest.json keeps content-general off it). Each
// bundle has its own progress toast and cancellation state, and the two toasts
// share one DOM id, so exactly one bundle may work any given page. The split
// is by page type: content-search owns results listings; content-general owns
// every other page on these hosts, where article/record pages print the DOI it
// annotates (title pill, reference pills, retraction banner, side panel).
//
// Most of these sites are single-page apps that move between a results list
// and a record page without reloading, so both bundles re-check `ownsUrl` on
// every pass instead of relying on manifest URL patterns.
//
// This module is imported by content-general, so it holds only hostnames and
// URL predicates — adapters in content-search/sites/ spread these entries.

export interface SearchSite {
    id: string;
    /** Bare hostnames; subdomains and www. match too. */
    hostnames: string[];
    /** True on the site's results listings, the pages content-search augments. */
    ownsUrl(url: URL): boolean;
}

const path = (url: URL): string => url.pathname.replace(/\/+$/, "") || "/";

export const SEARCH_SITES = {
    // Scholar has no article pages of its own; every page is content-search's.
    scholar: {
        id: "scholar",
        hostnames: [
            "scholar.google.com", "scholar.google.co.uk", "scholar.google.co.in",
            "scholar.google.co.jp", "scholar.google.co.kr", "scholar.google.co.za",
            "scholar.google.co.id", "scholar.google.co.th", "scholar.google.co.il",
            "scholar.google.ca", "scholar.google.de", "scholar.google.fr",
            "scholar.google.es", "scholar.google.it", "scholar.google.com.br",
            "scholar.google.com.au",
        ],
        ownsUrl: () => true,
    },
    // Results: /works?… . Work pages: /works/W… .
    openalex: {
        id: "openalex",
        hostnames: ["openalex.org"],
        ownsUrl: (url) => path(url) === "/works",
    },
    // Results: /search?q=… . Paper pages: /paper/… .
    semanticscholar: {
        id: "semanticscholar",
        hostnames: ["semanticscholar.org"],
        ownsUrl: (url) => path(url) === "/search",
    },
    // Results: the site root with a query (?term=…, ?linkname=…). Article
    // pages: /<pmid>/ . The bare homepage has no rows.
    pubmed: {
        id: "pubmed",
        hostnames: ["pubmed.ncbi.nlm.nih.gov"],
        ownsUrl: (url) => path(url) === "/" && url.search.length > 1,
    },
    // Results: /search?query=… . Article pages: /article/<source>/<id> .
    europepmc: {
        id: "europepmc",
        hostnames: ["europepmc.org"],
        ownsUrl: (url) => path(url) === "/search",
    },
    // Results: /results/results.uri?… and /pages/search/publications?… .
    // Abstract pages: /pages/publications/<id> and /record/display.uri?… .
    scopus: {
        id: "scopus",
        hostnames: ["scopus.com"],
        ownsUrl: (url) => /^\/(results\/|pages\/search\/)/.test(url.pathname),
    },
    // Results: /c/<profile>/search/results?… . Records: /c/<profile>/search/details/<id> .
    ebsco: {
        id: "ebsco",
        hostnames: ["research.ebsco.com"],
        ownsUrl: (url) => /^\/c\/[^/]+\/search\/results\/?$/.test(url.pathname),
    },
} satisfies Record<string, SearchSite>;

function normaliseHost(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, "");
}

export function matchSearchSite<T extends SearchSite>(hostname: string, registry: readonly T[]): T | null {
    const host = normaliseHost(hostname);
    return registry.find((site) =>
        site.hostnames.some((h) => host === normaliseHost(h) || host.endsWith(`.${normaliseHost(h)}`))
    ) ?? null;
}

/** True when content-search owns this URL, so content-general must stay idle. */
export function searchScriptOwns(href: string = location.href): boolean {
    const url = new URL(href);
    return matchSearchSite(url.hostname, Object.values(SEARCH_SITES))?.ownsUrl(url) ?? false;
}
