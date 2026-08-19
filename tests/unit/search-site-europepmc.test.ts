import {describe, expect, it, vi, beforeEach} from "vitest";
import {EUROPEPMC} from "../../src/content-search/sites/europepmc";
import {mockResult} from "../helpers";

/** Rows copied from europepmc.org/search?query=ego%20depletion (2026-08). */
const MED_ROW = `
  <li class="separated-list-item"><div class="citation" id="search-results--single--block-42528595">
    <h3 id="citation--article--title-42528595" class="citation-title">
      <a href="/article/MED/42528595">The association between compassion fatigue and nurses' creativity.</a>
    </h3>
    <p class="citation-author-list">
      <a href="/search?query=AUTH%3A%22Chatzisarantis%20NL%22">Chatzisarantis NL</a>,
      <a href="/search?query=AUTH%3A%22Wang%20Z%22">Wang Z</a>
    </p>
    <p><a href="/search?query=JOURNAL%3A%22Front%20Psychol%22">Front Psychol</a>, 17:1748888,
      <span id="citation--id--pub-date-42528595">15 Jul 2026</span></p>
    <p><span id="citation--id--pmid-42528595">PMID: 42528595</span></p>
    <p class="citation-labels small"><span class="labels"></span></p>
  </div></li>`;

/** A preprint row: PPR ids are not PMIDs, so the title has to carry it. */
const PPR_ROW = `
  <li class="separated-list-item"><div class="citation" id="search-results--single--block-PPR1254258">
    <h3 class="citation-title"><a href="/article/PPR/PPR1254258">Ego depletion in a preregistered replication.</a></h3>
    <p class="citation-author-list"><a href="/search?query=AUTH%3A%22Wang%20B%22">Wang B</a></p>
    <p><span id="citation--id--pub-date-PPR1254258">02 Feb 2025</span></p>
    <p class="citation-labels small"><span class="labels"></span></p>
  </div></li>`;

function firstRow(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.querySelector<HTMLElement>(EUROPEPMC.resultRow)!;
}

describe("Europe PMC adapter", () => {
    it("reads title, PMID, year and first-author surname from a MED row", () => {
        expect(EUROPEPMC.extractRow(firstRow(MED_ROW))).toMatchObject({
            title: "The association between compassion fatigue and nurses' creativity.",
            firstAuthor: "Chatzisarantis",
            year: 2026,
            doi: null,
            confident: false,
            siteId: "42528595",
        });
    });

    it("leaves non-MED rows without a site id, for title search", () => {
        expect(EUROPEPMC.extractRow(firstRow(PPR_ROW))).toMatchObject({
            firstAuthor: "Wang",
            year: 2025,
            siteId: undefined,
        });
    });
});

describe("search pipeline on Europe PMC rows", () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = `<ul class="separated-list">${MED_ROW}${PPR_ROW}</ul>`;
    });

    it("resolves the MED row's PMID to a DOI and title-searches the preprint row", async () => {
        const send = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
        send.mockImplementation(async (msg: {type: string}) => {
            if (msg.type === "FLORA_PMC_RESOLVE") {
                return {type: "FLORA_PMC_RESOLVE_RESULT", results: {"42528595": "10.3389/fpsyg.2026.1748888"}};
            }
            if (msg.type === "FLORA_AUGMENT") return {type: "FLORA_AUGMENT_RESULT", results: {}};
            if (msg.type === "FLORA_LOOKUP") {
                return {type: "FLORA_LOOKUP_RESULT", results: {"10.3389/fpsyg.2026.1748888": mockResult()}, errors: {}};
            }
            return undefined;
        });
        const {processSearchResults} = await import("../../src/content-search/pipeline");
        const {EUROPEPMC: adapter} = await import("../../src/content-search/sites/europepmc");
        await processSearchResults(adapter, document);

        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({type: "FLORA_PMC_RESOLVE", pmcids: ["42528595"], idtype: "pmid"})
        );
        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            type: "FLORA_AUGMENT",
            requests: [expect.objectContaining({title: "Ego depletion in a preregistered replication.", firstAuthor: "Wang", year: 2025})],
        }));

        const panels = document.querySelectorAll<HTMLElement>(".citation [data-flora-panel]");
        expect(panels.length).toBe(1);
        expect(panels[0]!.previousElementSibling?.classList.contains("citation-labels")).toBe(true);
        expect(panels[0]!.getAttribute("data-flora-doi")).toBe("10.3389/fpsyg.2026.1748888");
    });
});
