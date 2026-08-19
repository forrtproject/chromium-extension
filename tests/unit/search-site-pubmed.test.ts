import {describe, expect, it, vi, beforeEach} from "vitest";
import {PUBMED} from "../../src/content-search/sites/pubmed";
import {mockResult} from "../helpers";

/** Rows copied from pubmed.ncbi.nlm.nih.gov/?term=ego+depletion (2026-08). */
const ROW_WITH_DOI = `
  <article class="full-docsum" data-rel-pos="1">
    <div class="docsum-wrap"><div class="docsum-content">
      <a class="docsum-title" href="/20565167/" data-article-id="20565167">
        <b>Ego</b> <b>depletion</b> and the strength model of self-control: a meta-analysis.
      </a>
      <div class="docsum-citation full-citation">
        <span class="docsum-authors full-authors">Hagger MS, Wood C, Stiff C, Chatzisarantis NL.</span>
        <span class="docsum-authors short-authors">Hagger MS, et al.</span>
        <span class="docsum-journal-citation full-journal-citation">Psychol Bull. 2010 Jul;136(4):495-525. doi: 10.1037/a0019486.</span>
        <span class="citation-part">PMID: <span class="docsum-pmid">20565167</span></span>
      </div>
      <div class="docsum-snippet"><div class="full-view-snippet">Results revealed a significant effect …</div></div>
    </div></div>
  </article>`;

/** Same shape without the `doi:` field — the PMID has to carry the row. */
const ROW_WITHOUT_DOI = `
  <article class="full-docsum" data-rel-pos="1">
    <div class="docsum-wrap"><div class="docsum-content">
      <a class="docsum-title" href="/9599441/" data-article-id="9599441">Ego depletion: is the active self a limited resource?</a>
      <div class="docsum-citation full-citation">
        <span class="docsum-authors full-authors">Baumeister RF, Bratslavsky E, Muraven M, Tice DM.</span>
        <span class="docsum-journal-citation full-journal-citation">J Pers Soc Psychol. 1998 May;74(5):1252-65.</span>
        <span class="citation-part">PMID: <span class="docsum-pmid">9599441</span></span>
      </div>
    </div></div>
  </article>`;

function firstRow(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.querySelector<HTMLElement>("article.full-docsum")!;
}

describe("PubMed adapter", () => {
    it("reads the printed DOI, title, first-author surname and year", () => {
        expect(PUBMED.extractRow(firstRow(ROW_WITH_DOI))).toMatchObject({
            title: "Ego depletion and the strength model of self-control: a meta-analysis.",
            firstAuthor: "Hagger",
            year: 2010,
            doi: "10.1037/a0019486",
            confident: true,
            siteId: undefined,
        });
    });

    it("falls back to the PMID when the row prints no DOI", () => {
        expect(PUBMED.extractRow(firstRow(ROW_WITHOUT_DOI))).toMatchObject({
            firstAuthor: "Baumeister",
            year: 1998,
            doi: null,
            confident: false,
            siteId: "9599441",
        });
    });

    it("keeps a doubled slash in the DOI and drops the trailing full stop", () => {
        const row = firstRow(ROW_WITH_DOI);
        row.querySelector(".full-journal-citation")!.textContent =
            "J Pers Soc Psychol. 1998 May;74(5):1252-65. doi: 10.1037//0022-3514.74.5.1252.";
        expect(PUBMED.extractRow(row)).toMatchObject({doi: "10.1037//0022-3514.74.5.1252", year: 1998});
    });
});

describe("search pipeline on PubMed rows", () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = ROW_WITH_DOI + ROW_WITHOUT_DOI;
    });

    it("places one panel per row, resolving the DOI-less row through the PMID converter", async () => {
        const send = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
        send.mockImplementation(async (msg: {type: string}) => {
            if (msg.type === "FLORA_PMC_RESOLVE") {
                return {type: "FLORA_PMC_RESOLVE_RESULT", results: {"9599441": "10.1037/0022-3514.74.5.1252"}};
            }
            if (msg.type === "FLORA_LOOKUP") {
                return {type: "FLORA_LOOKUP_RESULT", results: {"10.1037/a0019486": mockResult()}, errors: {}};
            }
            return undefined;
        });
        const {processSearchResults} = await import("../../src/content-search/pipeline");
        const {PUBMED: adapter} = await import("../../src/content-search/sites/pubmed");
        await processSearchResults(adapter, document);

        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({type: "FLORA_PMC_RESOLVE", pmcids: ["9599441"], idtype: "pmid"})
        );
        expect(send).not.toHaveBeenCalledWith(expect.objectContaining({type: "FLORA_AUGMENT"}));

        const panels = document.querySelectorAll<HTMLElement>(".docsum-content > [data-flora-panel]");
        expect(panels.length).toBe(2);
        expect([...panels].map((p) => p.getAttribute("data-flora-doi"))).toEqual([
            "10.1037/a0019486",
            "10.1037/0022-3514.74.5.1252",
        ]);
    });
});
