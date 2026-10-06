import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createIndicatorPanel, createIndicatorPill, updateIndicatorPillBadges} from "../../src/shared/indicator-pill";
import {injectInlineRetractionPills, resetRetractionPills, type RetractionResponse} from "../../src/shared/doi-retraction";
import type {DoiString, LookupState} from "../../src/shared/types";

const DOI = "10.1234/x" as DoiString;
const OTHER = "10.1234/other" as DoiString;
const HOOKS = {generation: () => 1};
const retraction: RetractionResponse = {originDoi: DOI, doi: "10.9/n" as DoiString, kind: "retraction"};
const concern: RetractionResponse = {...retraction, kind: "concern"};

function matched(doi: DoiString, replications: number): Map<DoiString, LookupState> {
    return new Map([[doi, {
        status: "matched",
        source: "extracted",
        result: {record: {stats: {n_replications_total: replications, n_reproductions_total: 0}}},
    } as unknown as LookupState]]);
}

const segments = (pill: HTMLElement) =>
    [...pill.querySelectorAll<HTMLElement>("[data-flora-segment]")]
        .map(s => s.getAttributeNames().find(n => /^data-flora-\w+-segment$/.test(n)));

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    document.body.innerHTML = "";
    resetRetractionPills();
});
afterEach(() => vi.unstubAllGlobals());

describe("notice segment", () => {
    it("sits after the replication segment alongside its count", () => {
        const pill = createIndicatorPill({doi: DOI, retraction, replicationsCount: 4});
        expect(segments(pill)).toEqual([
            "data-flora-doi-segment", "data-flora-oa-segment", "data-flora-pubpeer-segment",
            "data-flora-badge-segment", "data-flora-notice-segment",
        ]);
        expect(pill.querySelector("[data-flora-badge-segment]")!.textContent).toContain("Reps");
        expect(pill.querySelector("[data-flora-badge-segment] [data-flora-segment-count]")!.textContent).toBe("4");
        expect(pill.querySelector("[data-flora-notice-segment]")!.textContent).toContain("Retracted");
    });

    it("names an expression of concern", () => {
        const pill = createIndicatorPill({doi: DOI, retraction: concern});
        expect(pill.querySelector<HTMLElement>("[data-flora-notice-segment]")!.title).toContain("Expression of concern");
    });

    it("is absent without a notice", () => {
        const pill = createIndicatorPill({doi: DOI, replicationsCount: 2});
        expect(pill.querySelector("[data-flora-notice-segment]")).toBeNull();
        expect(segments(pill)).toHaveLength(4);
    });

    it("gets a popover row beside the replication row", () => {
        const pill = createIndicatorPill({doi: DOI, retraction, replicationsCount: 4});
        expect(pill.querySelector("[data-flora-popover] [data-flora-notice-row]")!.textContent).toContain("Retracted");
        expect(pill.querySelector("[data-flora-popover] [data-flora-badge-row]")!.textContent).toContain("Replications");
        expect(createIndicatorPanel({doi: DOI, retraction}).querySelector("[data-flora-notice-row]")).not.toBeNull();
    });

    it("is added when a retraction arrives later and removed when it clears", () => {
        const pill = createIndicatorPill({doi: DOI});
        document.body.append(pill);
        const repaint = (notices: RetractionResponse[]) =>
            updateIndicatorPillBadges(document, matched(DOI, 3), () => notices, "pills", undefined, HOOKS);

        repaint([]);
        expect(pill.querySelector("[data-flora-notice-segment]")).toBeNull();

        repaint([retraction]);
        expect(pill.querySelector("[data-flora-notice-segment]")!.textContent).toContain("Retracted");
        expect(pill.querySelector("[data-flora-badge-segment] [data-flora-segment-count]")!.textContent).toBe("3");
        expect(pill.querySelector("[data-flora-notice-row]")).not.toBeNull();

        repaint([concern]);
        expect(pill.querySelectorAll("[data-flora-notice-segment]")).toHaveLength(1);
        expect(pill.querySelector<HTMLElement>("[data-flora-notice-segment]")!.title).toContain("Expression of concern");

        repaint([]);
        expect(pill.querySelector("[data-flora-notice-segment]")).toBeNull();
        expect(pill.querySelector("[data-flora-notice-row]")).toBeNull();
        expect(pill.querySelector("[data-flora-badge-segment]")).not.toBeNull();
    });

    it("replaces a stand-alone notice pill once the DOI gains an indicator pill", () => {
        const mention = document.createElement("p");
        document.body.append(mention);
        injectInlineRetractionPills([{doi: DOI, anchor: mention}], new Map([[DOI, retraction]]));
        expect(document.querySelectorAll(".flora-notice-pill")).toHaveLength(1);

        document.body.append(createIndicatorPill({doi: DOI}));
        updateIndicatorPillBadges(document, new Map(), () => [retraction], "pills", undefined, HOOKS);
        expect(document.querySelectorAll(".flora-notice-pill")).toHaveLength(0);
    });
});

describe("stand-alone notice pills", () => {
    it("skip a mention whose DOI has an indicator pill elsewhere on the page", () => {
        document.body.innerHTML = `<h1 id="title">Title</h1><p id="mention">see ${DOI}</p>`;
        document.querySelector("#title")!.after(createIndicatorPill({doi: DOI, retraction}));
        injectInlineRetractionPills(
            [{doi: DOI, anchor: document.querySelector("#mention")!}], new Map([[DOI, retraction]]));
        expect(document.querySelectorAll(".flora-notice-pill")).toHaveLength(0);
    });

    it("still mark a bare mention of a noticed DOI with no indicator pill", () => {
        document.body.innerHTML = `<p id="mention">see ${OTHER}</p>`;
        document.body.append(createIndicatorPill({doi: DOI, retraction}));
        const bare = {...retraction, originDoi: OTHER};
        injectInlineRetractionPills([{doi: OTHER, anchor: document.querySelector("#mention")!}], new Map([[OTHER, bare]]));
        expect(document.querySelectorAll(".flora-notice-pill")).toHaveLength(1);
    });

    it("leave the title pill without an adjacent notice pill", () => {
        document.body.innerHTML = `<h1 id="title">Title</h1>`;
        const title = document.querySelector<HTMLElement>("#title")!;
        const pill = createIndicatorPill({doi: DOI, retraction});
        pill.setAttribute("data-flora-title-pill", "");
        title.after(pill);
        injectInlineRetractionPills([{doi: DOI, anchor: title}], new Map([[DOI, retraction]]));
        expect(pill.nextElementSibling).toBeNull();
        expect(title.querySelector(".flora-notice-pill")).toBeNull();
    });
});
