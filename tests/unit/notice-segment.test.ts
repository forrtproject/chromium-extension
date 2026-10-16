import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {deep} from "../helpers";
import {createIndicatorPanel, createIndicatorPill as createClosedPill, updateIndicatorPillBadges, ensurePopoverRows} from "../../src/shared/indicator-pill";
import {injectInlineRetractionPills, resetRetractionPills, type RetractionResponse} from "../../src/shared/doi-retraction";
import type {DoiString, LookupState} from "../../src/shared/types";

function createIndicatorPill(...args: Parameters<typeof createClosedPill>): HTMLElement {
    const pill = createClosedPill(...args);
    ensurePopoverRows(pill);
    return pill;
}

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
const popoverOf = (pill: HTMLElement) => pill.querySelector<HTMLElement>("[data-flora-popover]")!;

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
        expect(deep(pill).querySelector("[data-flora-badge-segment]")!.textContent).toContain("Reps");
        expect(deep(pill).querySelector("[data-flora-badge-segment] [data-flora-segment-count]")!.textContent).toBe("4");
        expect(deep(pill).querySelector("[data-flora-notice-segment]")!.textContent).toContain("Retracted");
    });

    it("names an expression of concern", () => {
        const pill = createIndicatorPill({doi: DOI, retraction: concern});
        expect(deep(pill).querySelector<HTMLElement>("[data-flora-notice-segment]")!.title).toContain("Expression of concern");
    });

    it("is absent without a notice", () => {
        const pill = createIndicatorPill({doi: DOI, replicationsCount: 2});
        expect(deep(pill).querySelector("[data-flora-notice-segment]")).toBeNull();
        expect(segments(pill)).toHaveLength(4);
    });

    it("gets a popover row beside the replication row", () => {
        const pill = createIndicatorPill({doi: DOI, retraction, replicationsCount: 4});
        expect(deep(popoverOf(pill)).querySelector("[data-flora-notice-row]")!.textContent).toContain("Retracted");
        expect(deep(popoverOf(pill)).querySelector("[data-flora-badge-row]")!.textContent).toContain("Replications");
        expect(createIndicatorPanel({doi: DOI, retraction}).querySelector("[data-flora-notice-row]")).not.toBeNull();
    });

    it("is added when a retraction arrives later and removed when it clears", () => {
        const pill = createIndicatorPill({doi: DOI});
        document.body.append(pill);
        const repaint = (notices: RetractionResponse[]) =>
            updateIndicatorPillBadges(document, matched(DOI, 3), () => notices, "pills", undefined, HOOKS);

        repaint([]);
        expect(deep(pill).querySelector("[data-flora-notice-segment]")).toBeNull();

        repaint([retraction]);
        expect(deep(pill).querySelector("[data-flora-notice-segment]")!.textContent).toContain("Retracted");
        expect(deep(pill).querySelector("[data-flora-badge-segment] [data-flora-segment-count]")!.textContent).toBe("3");
        expect(deep(popoverOf(pill)).querySelector("[data-flora-notice-row]")).not.toBeNull();

        repaint([concern]);
        expect(deep(pill).querySelectorAll("[data-flora-notice-segment]")).toHaveLength(1);
        expect(deep(pill).querySelector<HTMLElement>("[data-flora-notice-segment]")!.title).toContain("Expression of concern");

        repaint([]);
        expect(deep(pill).querySelector("[data-flora-notice-segment]")).toBeNull();
        expect(deep(popoverOf(pill)).querySelector("[data-flora-notice-row]")).toBeNull();
        expect(deep(pill).querySelector("[data-flora-badge-segment]")).not.toBeNull();
    });

    it("replaces a stand-alone notice pill once the DOI gains an indicator pill", () => {
        const mention = document.createElement("p");
        document.body.append(mention);
        injectInlineRetractionPills([{doi: DOI, anchor: mention}], new Map([[DOI, retraction]]));
        expect(deep(document).querySelectorAll(".flora-notice-pill")).toHaveLength(1);

        document.body.append(createIndicatorPill({doi: DOI}));
        updateIndicatorPillBadges(document, new Map(), () => [retraction], "pills", undefined, HOOKS);
        expect(deep(document).querySelectorAll(".flora-notice-pill")).toHaveLength(0);
    });

    it("retitles the badge segment when FORRT starts loading or fails with the same counts", () => {
        const pill = createIndicatorPill({doi: DOI});
        document.body.append(pill);
        const badgeTitle = () => pill.querySelector<HTMLElement>("[data-flora-badge-segment]")!.title;
        const repaint = (state?: LookupState) =>
            updateIndicatorPillBadges(document, new Map(state ? [[DOI, state]] : []), () => [], "pills", undefined, HOOKS);

        repaint();
        expect(badgeTitle()).toBe("No replication or reproduction data found");
        repaint({status: "loading"} as LookupState);
        expect(badgeTitle()).toBe("Checking FORRT…");
        repaint({status: "error", message: "x"} as LookupState);
        expect(badgeTitle()).toBe("FORRT unavailable");
    });
});

describe("stand-alone notice pills", () => {
    it("skip a mention whose DOI has an indicator pill elsewhere on the page", () => {
        document.body.innerHTML = `<h1 id="title">Title</h1><p id="mention">see ${DOI}</p>`;
        deep(document).querySelector("#title")!.after(createIndicatorPill({doi: DOI, retraction}));
        injectInlineRetractionPills(
            [{doi: DOI, anchor: deep(document).querySelector("#mention")!}], new Map([[DOI, retraction]]));
        expect(deep(document).querySelectorAll(".flora-notice-pill")).toHaveLength(0);
    });

    it("still mark a bare mention of a noticed DOI with no indicator pill", () => {
        document.body.innerHTML = `<p id="mention">see ${OTHER}</p>`;
        document.body.append(createIndicatorPill({doi: DOI, retraction}));
        const bare = {...retraction, originDoi: OTHER};
        injectInlineRetractionPills([{doi: OTHER, anchor: deep(document).querySelector("#mention")!}], new Map([[OTHER, bare]]));
        expect(deep(document).querySelectorAll(".flora-notice-pill")).toHaveLength(1);
    });

    it("leave the title pill without an adjacent notice pill", () => {
        document.body.innerHTML = `<h1 id="title">Title</h1>`;
        const title = deep(document).querySelector<HTMLElement>("#title")!;
        const pill = createIndicatorPill({doi: DOI, retraction});
        pill.setAttribute("data-flora-title-pill", "");
        title.after(pill);
        injectInlineRetractionPills([{doi: DOI, anchor: title}], new Map([[DOI, retraction]]));
        expect(pill.nextElementSibling).toBeNull();
        expect(title.querySelector(".flora-notice-pill")).toBeNull();
    });
});
