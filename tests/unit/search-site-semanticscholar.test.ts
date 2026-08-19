import {describe, expect, it, vi, beforeEach, afterEach} from "vitest";
import {SEMANTIC_SCHOLAR} from "../../src/content-search/sites/semanticscholar";
import {
    normaliseSemanticScholarId,
    resolveSemanticScholarIds,
} from "../../src/shared/semanticscholar-resolve";

const PAPER_ID = "516c2035d29bb711be2e027be4ad38224419065a";

// Trimmed from a live search page (semanticscholar.org/search?q=ego+depletion).
const S2_ROW = `
  <div class="result-page">
    <div class="cl-paper-row serp-papers__paper-row paper-v2-cue paper-row-normal">
      <a class="link-button--show-visited" data-test-id="title-link"
         href="/paper/Ego-depletion%3A-is-the-active-self-a-limited-Baumeister-Bratslavsky/${PAPER_ID}">
        <h2 class="cl-paper-title"><span><em>Ego</em><span> </span><em>depletion</em><span>: is the active self a limited resource?</span></span></h2>
      </a>
      <ul class="cl-paper__bulleted-row">
        <span class="cl-paper-authors">
          <span data-test-id="author-list"><a class="cl-paper-authors__author-box"><span><span>R. Baumeister</span></span></a></span>
          <span data-test-id="author-list"><a class="cl-paper-authors__author-box"><span><span>Ellen Bratslavsky</span></span></a></span>
        </span>
        <li class="cl-paper__bulleted-row__item"><span class="cl-paper-pubdates"><span><span>1 May 1998</span></span></span></li>
      </ul>
      <div class="tldr-abstract-replacement text-truncator">TLDR The results suggest…</div>
      <div class="cl-paper__bulleted-row cl-paper-controls">
        <div class="cl-paper-controls__stats"></div>
        <div class="cl-paper-controls__actions"></div>
      </div>
    </div>
  </div>`;

describe("Semantic Scholar adapter", () => {
    it("reads title, paper id, year and first-author surname from a result row", () => {
        document.body.innerHTML = S2_ROW;
        const row = document.querySelector<HTMLElement>(SEMANTIC_SCHOLAR.resultRow)!;
        expect(SEMANTIC_SCHOLAR.extractRow(row)).toMatchObject({
            title: "Ego depletion: is the active self a limited resource?",
            siteId: PAPER_ID,
            year: 1998,
            firstAuthor: "Baumeister",
            doi: null,
            confident: false,
        });
    });

    it("normalises paper ids from hrefs and bare ids, and rejects other strings", () => {
        expect(normaliseSemanticScholarId(`/paper/Some-Slug/${PAPER_ID.toUpperCase()}`)).toBe(PAPER_ID);
        expect(normaliseSemanticScholarId(PAPER_ID)).toBe(PAPER_ID);
        expect(normaliseSemanticScholarId("/author/R.-Baumeister/5142080")).toBeNull();
        expect(normaliseSemanticScholarId(null)).toBeNull();
    });
});

describe("Semantic Scholar id → DOI resolution", () => {
    const otherId = "372b50bd7bfa6cd75153d727c061545340ea5d64";
    const unknownId = "0".repeat(40);

    afterEach(() => vi.unstubAllGlobals());

    it("maps ids to DOIs, no-DOI papers to null and unknown ids to nothing", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => [
                {paperId: PAPER_ID, externalIds: {DOI: "10.1037/0022-3514.74.5.1252"}},
                {paperId: otherId, externalIds: {}},
                null,
            ],
        }));
        vi.stubGlobal("fetch", fetchMock);

        const map = await resolveSemanticScholarIds([`/paper/x/${PAPER_ID}`, otherId, unknownId]);
        expect(map.get(PAPER_ID)).toBe("10.1037/0022-3514.74.5.1252");
        expect(map.get(otherId)).toBeNull();
        expect(map.has(unknownId)).toBe(false);

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://api.semanticscholar.org/graph/v1/paper/batch?fields=externalIds");
        expect(JSON.parse(String(init.body))).toEqual({ids: [PAPER_ID, otherId, unknownId]});
    });

    it("returns an empty map when the API rate-limits, so the pipeline falls back to title search", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ok: false, status: 429, json: async () => []})));
        expect(await resolveSemanticScholarIds([PAPER_ID])).toEqual(new Map());
    });
});

describe("search pipeline on Semantic Scholar rows", () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = S2_ROW;
    });

    it("resolves the paper id to a DOI and places the panel next to the TLDR/abstract", async () => {
        const send = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
        send.mockImplementation(async (msg: {type: string}) => {
            if (msg.type === "FLORA_S2_RESOLVE") {
                return {type: "FLORA_S2_RESOLVE_RESULT", results: {[PAPER_ID]: "10.1037/0022-3514.74.5.1252"}};
            }
            return {type: "FLORA_LOOKUP_RESULT", results: {}, errors: {}};
        });
        const {processSearchResults} = await import("../../src/content-search/pipeline");
        const {SEMANTIC_SCHOLAR: adapter} = await import("../../src/content-search/sites/semanticscholar");
        await processSearchResults(adapter, document);

        expect(send).toHaveBeenCalledWith(expect.objectContaining({type: "FLORA_S2_RESOLVE", ids: [PAPER_ID]}));
        expect(send).not.toHaveBeenCalledWith(expect.objectContaining({type: "FLORA_AUGMENT"}));

        const panel = document.querySelector<HTMLElement>(".cl-paper-row > [data-flora-panel]");
        expect(panel).not.toBeNull();
        expect(panel!.previousElementSibling?.classList.contains("tldr-abstract-replacement")).toBe(true);
        expect(panel!.getAttribute("data-flora-doi")).toBe("10.1037/0022-3514.74.5.1252");
    });

    it("falls back to the author/venue line when the row has no TLDR or abstract", async () => {
        document.querySelector(".tldr-abstract-replacement")!.remove();
        const send = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
        send.mockImplementation(async (msg: {type: string}) => (msg.type === "FLORA_S2_RESOLVE"
            ? {type: "FLORA_S2_RESOLVE_RESULT", results: {[PAPER_ID]: "10.1037/0022-3514.74.5.1252"}}
            : {type: "FLORA_LOOKUP_RESULT", results: {}, errors: {}}));
        const {processSearchResults} = await import("../../src/content-search/pipeline");
        const {SEMANTIC_SCHOLAR: adapter} = await import("../../src/content-search/sites/semanticscholar");
        await processSearchResults(adapter, document);

        const panel = document.querySelector<HTMLElement>(".cl-paper-row > [data-flora-panel]");
        expect(panel!.previousElementSibling?.tagName).toBe("UL");
    });
});
