import {describe, expect, it, vi, beforeEach} from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";
import {resolveSearchSite, SEARCH_SITE_ADAPTERS} from "../../src/content-search/sites";
import {OPENALEX} from "../../src/content-search/sites/openalex";
import {normaliseOpenAlexId} from "../../src/shared/openalex-resolve";
import {SEARCH_SITES, searchScriptOwns} from "../../src/shared/search-sites";
import {mockResult, patternToRegExp} from "../helpers";

const OPENALEX_ROW = `
  <div class="results-container">
    <div class="result-item">
      <div class="result-content">
        <div class="result-row-1"><span class="result-title-wrap">
          <a class="result-title" href="/works/w2142773606">Understanding Priming Effects in Social Psychology</a>
        </span></div>
        <div class="result-meta mt-1">
          <span>2014</span><span>·</span>
          <span><span><span>C. Daryl Cameron, Jazmin L. Brown-Iannuzzi, et al.</span></span></span>
          <span>·</span><span class="font-italic">Social Cognition</span><span>·</span>
          <span class="cited-by">201</span>
        </div>
      </div>
    </div>
  </div>`;

describe("search site registry", () => {
    it("resolves hosts to adapters, including subdomains and www.", () => {
        expect(resolveSearchSite("scholar.google.com")?.id).toBe("scholar");
        expect(resolveSearchSite("scholar.google.co.uk")?.id).toBe("scholar");
        expect(resolveSearchSite("openalex.org")?.id).toBe("openalex");
        expect(resolveSearchSite("www.openalex.org")?.id).toBe("openalex");
        expect(resolveSearchSite("api.openalex.org")?.id).toBe("openalex");
        expect(resolveSearchSite("www.nature.com")).toBeNull();
    });

    it("every adapter ships a stylesheet and unique id", () => {
        const ids = SEARCH_SITE_ADAPTERS.map((a) => a.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const adapter of SEARCH_SITE_ADAPTERS) expect(typeof adapter.css).toBe("string");
    });

    it("manifest routes every adapter host to the search content script", () => {
        const manifest = JSON.parse(
            readFileSync(path.resolve(__dirname, "..", "..", "manifest.json"), "utf-8")
        ) as {content_scripts: {js: string[]; matches: string[]}[]};
        const entry = manifest.content_scripts.find((s) => s.js.includes("dist/content-search.js"))!;
        expect(entry).toBeDefined();
        const covered = (host: string): boolean =>
            entry.matches.some((pattern) => {
                const patternHost = pattern.replace(/^\*:\/\//, "").replace(/\/.*$/, "");
                return patternHost === host || (patternHost.startsWith("*.") && host.endsWith(patternHost.slice(1)));
            });
        for (const adapter of SEARCH_SITE_ADAPTERS) {
            for (const host of adapter.hostnames) expect(covered(host), host).toBe(true);
        }
    });
});

// One results URL and one record URL per search site. Record pages need
// content-general (title pill, reference pills, retraction banner); results
// pages need content-search alone, since the two bundles' toasts collide.
const PAGES: Record<keyof typeof SEARCH_SITES, {results: string[]; records: string[]}> = {
    scholar: {results: ["https://scholar.google.com/scholar?q=replication"], records: []},
    openalex: {
        results: ["https://openalex.org/works?page=1&filter=default.search:priming"],
        records: ["https://openalex.org/works/w2142773606", "https://openalex.org/"],
    },
    semanticscholar: {
        results: ["https://www.semanticscholar.org/search?q=ego%20depletion"],
        records: ["https://www.semanticscholar.org/paper/Ego-depletion/0123456789abcdef0123456789abcdef01234567"],
    },
    pubmed: {
        results: [
            "https://pubmed.ncbi.nlm.nih.gov/?term=ego+depletion",
            "https://pubmed.ncbi.nlm.nih.gov/?linkname=pubmed_pubmed&from_uid=20565167",
        ],
        records: ["https://pubmed.ncbi.nlm.nih.gov/20565167/", "https://pubmed.ncbi.nlm.nih.gov/"],
    },
    europepmc: {
        results: ["https://europepmc.org/search?query=ego%20depletion"],
        records: ["https://europepmc.org/article/MED/20565167"],
    },
    scopus: {
        results: [
            "https://www.scopus.com/results/results.uri?src=s&sid=abc",
            "https://www.scopus.com/pages/search/publications?searchId=abc",
        ],
        records: ["https://www.scopus.com/pages/publications/85123456789", "https://www.scopus.com/record/display.uri?eid=2-s2.0-1"],
    },
    ebsco: {
        results: ["https://research.ebsco.com/c/abc123/search/results?q=priming"],
        records: ["https://research.ebsco.com/c/abc123/search/details/xyz789"],
    },
};

describe("page ownership between content-search and content-general", () => {
    const manifest = JSON.parse(
        readFileSync(path.resolve(__dirname, "..", "..", "manifest.json"), "utf-8")
    ) as {content_scripts: {js: string[]; matches: string[]; exclude_matches?: string[]}[]};
    const injects = (script: string, url: string): boolean => manifest.content_scripts.some((s) =>
        s.js.includes(script)
        && s.matches.some((p) => patternToRegExp(p).test(url))
        && !(s.exclude_matches ?? []).some((p) => patternToRegExp(p).test(url)));

    it("every search site lists a results page", () => {
        for (const id of Object.keys(SEARCH_SITES) as (keyof typeof SEARCH_SITES)[]) {
            expect(PAGES[id]?.results.length, id).toBeGreaterThan(0);
        }
    });

    it.each(Object.values(PAGES).flatMap((p) => p.results))("content-search alone works %s", (url) => {
        expect(injects("dist/content-search.js", url)).toBe(true);
        // content-general is either not injected or stands down at runtime.
        expect(searchScriptOwns(url)).toBe(true);
    });

    it.each(Object.values(PAGES).flatMap((p) => p.records))("content-general alone works %s", (url) => {
        expect(injects("dist/content-general.js", url)).toBe(true);
        expect(searchScriptOwns(url)).toBe(false);
        const adapter = resolveSearchSite(new URL(url).hostname)!;
        expect(adapter.ownsUrl(new URL(url))).toBe(false);
    });
});

describe("OpenAlex adapter", () => {
    it("reads title, work id, year and first-author surname from a result row", () => {
        document.body.innerHTML = OPENALEX_ROW;
        const row = document.querySelector<HTMLElement>(".result-item")!;
        expect(OPENALEX.extractRow(row)).toMatchObject({
            title: "Understanding Priming Effects in Social Psychology",
            siteId: "W2142773606",
            year: 2014,
            firstAuthor: "Cameron",
            doi: null,
            confident: false,
        });
    });

    it("normalises OpenAlex ids from hrefs and bare ids", () => {
        expect(normaliseOpenAlexId("/works/w2142773606")).toBe("W2142773606");
        expect(normaliseOpenAlexId("https://openalex.org/W2142773606")).toBe("W2142773606");
        expect(normaliseOpenAlexId("W12")).toBeNull();
        expect(normaliseOpenAlexId("A5023888391")).toBeNull();
    });
});

describe("search pipeline on OpenAlex rows", () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = OPENALEX_ROW;
    });

    it("resolves the work id to a DOI, places the panel beside the text column and looks it up", async () => {
        const send = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
        send.mockImplementation(async (msg: {type: string}) => {
            if (msg.type === "FLORA_OPENALEX_RESOLVE") {
                return {type: "FLORA_OPENALEX_RESOLVE_RESULT", results: {W2142773606: "10.1521/soco.2014.32.supp.1"}};
            }
            if (msg.type === "FLORA_LOOKUP") {
                return {type: "FLORA_LOOKUP_RESULT", results: {"10.1521/soco.2014.32.supp.1": mockResult()}, errors: {}};
            }
            return undefined;
        });
        const {processSearchResults} = await import("../../src/content-search/pipeline");
        const {OPENALEX: adapter} = await import("../../src/content-search/sites/openalex");
        await processSearchResults(adapter, document);

        expect(send).toHaveBeenCalledWith(expect.objectContaining({type: "FLORA_OPENALEX_RESOLVE", ids: ["W2142773606"]}));
        expect(send).toHaveBeenCalledWith(expect.objectContaining({type: "FLORA_LOOKUP", dois: ["10.1521/soco.2014.32.supp.1"]}));
        expect(send).not.toHaveBeenCalledWith(expect.objectContaining({type: "FLORA_AUGMENT"}));

        const panel = document.querySelector<HTMLElement>(".result-item > [data-flora-panel]");
        expect(panel).not.toBeNull();
        expect(panel!.previousElementSibling?.classList.contains("result-content")).toBe(true);
        expect(panel!.getAttribute("data-flora-doi")).toBe("10.1521/soco.2014.32.supp.1");
    });

    it("falls back to title augmentation when the site has no DOI for the work", async () => {
        const send = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
        send.mockImplementation(async (msg: {type: string}) => {
            if (msg.type === "FLORA_OPENALEX_RESOLVE") return {type: "FLORA_OPENALEX_RESOLVE_RESULT", results: {W2142773606: null}};
            if (msg.type === "FLORA_AUGMENT") return {type: "FLORA_AUGMENT_RESULT", results: {}};
            return {type: "FLORA_LOOKUP_RESULT", results: {}, errors: {}};
        });
        const {processSearchResults} = await import("../../src/content-search/pipeline");
        const {OPENALEX: adapter} = await import("../../src/content-search/sites/openalex");
        await processSearchResults(adapter, document);

        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            type: "FLORA_AUGMENT",
            requests: [expect.objectContaining({title: "Understanding Priming Effects in Social Psychology", firstAuthor: "Cameron", year: 2014})],
        }));
        expect(document.querySelector("[data-flora-panel]")).toBeNull();
    });
});
