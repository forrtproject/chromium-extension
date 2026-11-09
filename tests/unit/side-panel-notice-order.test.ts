import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {renderSidePanel, removeSidePanel} from "../../src/content-general/injector";
import type {RetractionResponse} from "../../src/shared/doi-retraction";
import type {DoiString, DoiContext, LookupState} from "../../src/shared/types";

const doi = (n: number) => `10.1000/ref${n}` as DoiString;
const refs = Array.from({length: 8}, (_, i) => ({doi: doi(i + 1), title: `Reference ${i + 1}`}));
const notices: RetractionResponse[] = [
    {originDoi: doi(7), doi: "10.1000/eoc7" as DoiString, kind: "concern"},
    {originDoi: doi(8), doi: "10.1000/ret8" as DoiString, kind: "retraction"},
];

function rows(): HTMLLIElement[] {
    const host = document.getElementById("flora-pubpeer-panel")!;
    const root = host.shadowRoot ?? host;
    return [...root.querySelectorAll<HTMLLIElement>("ul > li")].filter((li) => li.textContent?.includes("Reference"));
}

describe("side panel reference list", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    });
    afterEach(() => {
        removeSidePanel();
        vi.unstubAllGlobals();
    });

    for (const documentMode of [false, true]) {
        it(`puts retracted and concern references first and never folds them away${documentMode ? " (document mode)" : ""}`, () => {
            const context = new Map<DoiString, DoiContext>(refs.map((r) => [r.doi, "reference"]));
            renderSidePanel([], refs, new Map<DoiString, LookupState>(), context, new Map(), notices,
                "Article", undefined, {documentMode});
            const list = rows();
            expect(list).toHaveLength(8);
            expect(list[0].textContent).toContain("Reference 8");
            expect(list[1].textContent).toContain("Reference 7");
            expect(list.slice(0, 5).every((li) => li.style.display !== "none")).toBe(true);
            expect(list.slice(5).every((li) => li.style.display === "none")).toBe(true);
        });
    }

    it("keeps every notice visible when there are more notices than the folded list shows", () => {
        const many: RetractionResponse[] = refs.slice(0, 7).map((r) => ({originDoi: r.doi, doi: `${r.doi}.n` as DoiString, kind: "retraction"}));
        renderSidePanel([], refs, new Map(), new Map(refs.map((r) => [r.doi, "reference" as DoiContext])), new Map(), many, "Article");
        const list = rows();
        expect(list.slice(0, 7).every((li) => li.style.display !== "none")).toBe(true);
        expect(list[7].style.display).toBe("none");
    });
});
