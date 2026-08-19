import {describe, expect, it, vi, beforeEach, afterEach} from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";
import {EBSCO} from "../../src/content-search/sites/ebsco";
import {doiFromCitation, ebscoProfileFromPath, resolveEbscoIds} from "../../src/shared/ebsco-resolve";
import {mockResult} from "../helpers";

const RESULTS = readFileSync(
    path.resolve(__dirname, "..", "fixtures", "ebsco-live", "ebsco-live-01.html"),
    "utf-8"
);
const RECORD_ID = "l3xto7keqv";
const DOI = "10.1371/journal.pone.0287687";

const citation = (doi: string): string =>
    `Carruth, N. P., Ramos, J. A., & Miyake, A. (2023). Does willpower mindset really moderate the ego-depletion effect? <i>PLOS ONE</i>, <i>18</i>(6), e0287687. https://doi.org/${doi}`;

describe("EBSCOhost adapter", () => {
    it("reads title, record id, first-author surname and year from a result row", () => {
        document.body.innerHTML = RESULTS;
        const row = document.querySelector<HTMLElement>(EBSCO.resultRow)!;
        expect(EBSCO.extractRow(row)).toMatchObject({
            title:
                "Does willpower mindset really moderate the ego-depletion effect? " +
                "A preregistered replication of Job, Dweck, and Walton (2010).",
            siteId: RECORD_ID,
            firstAuthor: "Carruth",
            year: 2023,
            doi: null,
            confident: false,
        });
    });

    it("reads the profile from the page path and the record id from a details href", () => {
        expect(ebscoProfileFromPath("/c/abc123/search/results")).toBe("abc123");
        expect(ebscoProfileFromPath("/some/other/path")).toBeNull();
        expect(EBSCO.extractRow(document.querySelectorAll<HTMLElement>(EBSCO.resultRow)[2])).toMatchObject({
            siteId: "oadywwnglf",
            firstAuthor: "Dang",
            year: 2021,
        });
    });
});

describe("EBSCOhost record id → DOI resolution", () => {
    it("reads the DOI from the APA citation and asks for both required query parameters", async () => {
        const fetchMock = vi.fn(async () => ({ok: true, json: async () => [{citeStyleId: "apa", data: citation(DOI)}]}));
        const map = await resolveEbscoIds([`/c/abc123/search/details/${RECORD_ID}`], "abc123", fetchMock as never);

        expect(map.get(RECORD_ID)).toBe(DOI);
        const [url] = fetchMock.mock.calls[0] as unknown as [string];
        expect(url).toBe(`/api/search/v5/citation/records/${RECORD_ID}?profileIdentifier=abc123&citationStyle=apa`);
    });

    it("maps a citation without a DOI to null and leaves a failed record out of the map", async () => {
        const fetchMock = vi.fn(async (url: string) =>
            url.includes("book")
                ? {ok: true, json: async () => [{data: "Baumeister, R. F. (2011). <i>Willpower</i>. Penguin Press."}]}
                : {ok: false, status: 500, json: async () => []}
        );
        const map = await resolveEbscoIds(["book1", "broken1"], "abc123", fetchMock as never);
        expect(map.get("book1")).toBeNull();
        expect(map.has("broken1")).toBe(false);
    });

    it("resolves every record when there are more of them than requests in flight", async () => {
        const ids = Array.from({length: 11}, (_, i) => `rec${i}`);
        const fetchMock = vi.fn(async (url: string) => {
            const id = url.split("/").pop()!.split("?")[0];
            return {ok: true, json: async () => [{data: citation(`10.1000/${id}`)}]};
        });
        const map = await resolveEbscoIds(ids, "abc123", fetchMock as never);
        expect([...map.keys()].sort()).toEqual([...ids].sort());
        expect(map.get("rec7")).toBe("10.1000/rec7");
    });

    it("strips a trailing full stop from the DOI URL", () => {
        expect(doiFromCitation(`${citation(DOI)}.`)).toBe(DOI);
        expect(doiFromCitation("No DOI in this citation.")).toBeNull();
    });
});

describe("search pipeline on EBSCOhost rows", () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = RESULTS;
        vi.stubGlobal("fetch", vi.fn(async () => ({ok: true, json: async () => [{data: citation(DOI)}]})));
        history.replaceState({}, "", "/c/abc123/search/results");
    });
    afterEach(() => vi.unstubAllGlobals());

    it("resolves each record through the citation endpoint and places one panel under its metadata", async () => {
        const send = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
        send.mockImplementation(async (msg: {type: string}) =>
            msg.type === "FLORA_LOOKUP"
                ? {type: "FLORA_LOOKUP_RESULT", results: {[DOI]: mockResult()}, errors: {}}
                : {type: "FLORA_AUGMENT_RESULT", results: {}}
        );
        const {processSearchResults} = await import("../../src/content-search/pipeline");
        const {EBSCO: adapter} = await import("../../src/content-search/sites/ebsco");
        await processSearchResults(adapter, document);

        const panels = document.querySelectorAll<HTMLElement>(
            'dl[data-auto="result-item-metadata"] + [data-flora-panel]'
        );
        expect(panels.length).toBe(10);
        expect(panels[0].getAttribute("data-flora-doi")).toBe(DOI);
        expect(send).not.toHaveBeenCalledWith(expect.objectContaining({type: "FLORA_AUGMENT"}));
    });
});
