import {describe, expect, it, vi, beforeEach, afterEach} from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";
import {SCOPUS} from "../../src/content-search/sites/scopus";
import {normaliseScopusId, resolveScopusIds} from "../../src/shared/scopus-resolve";
import {mockResult} from "../helpers";

const fixture = (name: string): string =>
    readFileSync(path.resolve(__dirname, "..", "fixtures", "scopus-live", name), "utf-8");

const LIST_VIEW = fixture("scopus-list-01.html");
const TABLE_VIEW = fixture("scopus-table-01.html");

function rows(html: string): HTMLElement[] {
    document.body.innerHTML = html;
    return [...document.querySelectorAll<HTMLElement>(SCOPUS.resultRow)];
}

describe("Scopus adapter", () => {
    it("reads a list-view row: title, record id, first author and the year in the source line", () => {
        expect(SCOPUS.extractRow(rows(LIST_VIEW)[0])).toMatchObject({
            title: "The power of virtual identities: How priming actual and ideal selves shapes cool brand preference",
            siteId: "105046159914",
            firstAuthor: "Huang",
            year: 2027,
            doi: null,
            confident: false,
        });
    });

    it("reads a table-view row, where the year has its own cell and authors are surname-first", () => {
        const tableRows = rows(TABLE_VIEW);
        expect(tableRows.length).toBe(4);
        expect(SCOPUS.extractRow(tableRows[0])).toMatchObject({
            title: "Atypical semantic priming in individuals at clinical risk for psychosis",
            siteId: "105039146513",
            firstAuthor: "Rich",
            year: 2026,
        });
    });

    it("normalises record ids from hrefs, EIDs and bare ids", () => {
        expect(normaliseScopusId("/pages/publications/105046159914?origin=resultslist")).toBe("105046159914");
        expect(normaliseScopusId("2-s2.0-105046159914")).toBe("105046159914");
        expect(normaliseScopusId("/sourceid/22992")).toBeNull();
        expect(normaliseScopusId(null)).toBeNull();
    });
});

describe("Scopus record id → DOI resolution", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("asks the gateway for all ids at once and maps each record to its DOI", async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                items: [
                    {eid: "2-s2.0-105046159914", scopusId: "105046159914", doi: "10.1016/j.jretconser.2026.105005"},
                    {eid: "2-s2.0-105045375847", scopusId: "105045375847"},
                ],
            }),
        }));
        vi.stubGlobal("fetch", fetchMock);

        const map = await resolveScopusIds(["/pages/publications/105046159914", "105045375847", "999"]);
        expect(map.get("105046159914")).toBe("10.1016/j.jretconser.2026.105005");
        expect(map.get("105045375847")).toBeNull();
        expect(map.has("999")).toBe(false);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/gateway/documents/search");
        expect(JSON.parse(String(init.body))).toEqual({
            query: "EID(2-s2.0-105046159914) OR EID(2-s2.0-105045375847)",
            itemcount: 2,
        });
    });

    it("returns an empty map when the gateway fails, so the pipeline falls back to title search", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ok: false, status: 403, json: async () => ({})})));
        expect(await resolveScopusIds(["105046159914"])).toEqual(new Map());
    });
});

describe("search pipeline on Scopus rows", () => {
    beforeEach(() => {
        vi.resetModules();
        // Answer whatever ids the page asks about with one DOI per record.
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_url: string, init: RequestInit) => ({
                ok: true,
                json: async () => ({
                    items: [...String(init.body).matchAll(/EID\(2-s2\.0-(\d+)\)/g)].map((m) => ({
                        scopusId: m[1],
                        doi: `10.1000/scopus.${m[1]}`,
                    })),
                }),
            }))
        );
    });
    afterEach(() => vi.unstubAllGlobals());

    it("places the list-view panel at the end of the columns row and the table-view panel in the title cell", async () => {
        const send = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
        send.mockImplementation(async (msg: {type: string}) =>
            msg.type === "FLORA_LOOKUP"
                ? {
                      type: "FLORA_LOOKUP_RESULT",
                      results: Object.fromEntries(
                          (msg as {dois: string[]}).dois.map((doi) => [doi, mockResult()])
                      ),
                      errors: {},
                  }
                : {type: "FLORA_AUGMENT_RESULT", results: {}}
        );
        const {processSearchResults} = await import("../../src/content-search/pipeline");
        const {SCOPUS: adapter} = await import("../../src/content-search/sites/scopus");

        document.body.innerHTML = LIST_VIEW;
        await processSearchResults(adapter, document);
        const listPanel = document.querySelector<HTMLElement>(
            'li > div > div:has([data-testid="author-list"]) > [data-flora-panel]:last-child'
        );
        expect(listPanel?.getAttribute("data-flora-doi")).toBe("10.1000/scopus.105046159914");

        document.body.innerHTML = TABLE_VIEW;
        await processSearchResults(adapter, document);
        const cellPanel = document.querySelector<HTMLElement>("td > [data-flora-panel]");
        expect(cellPanel).not.toBeNull();
        expect(cellPanel!.parentElement!.querySelector('a[href^="/pages/publications/"]')).not.toBeNull();
    });
});
