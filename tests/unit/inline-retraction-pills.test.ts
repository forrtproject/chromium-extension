import { describe, it, expect, beforeEach } from "vitest";
import {
    injectInlineRetractionPills,
    resetRetractionPills,
    FLORA_RET_CHECK_KEY,
    type RetractionResponse,
} from "../../src/shared/doi-retraction";
import type { DoiString } from "../../src/shared/types";

const PRIMARY = "10.1000/primary" as DoiString;
const SECOND_ARTICLE = "10.1000/erratum" as DoiString;
const REFERENCE = "10.1000/reference" as DoiString;

function notice(doi: DoiString): RetractionResponse {
    return { originDoi: doi, doi: `${doi}-notice`, kind: "retraction" };
}

function anchorFor(id: string): Element {
    const el = document.createElement("span");
    el.id = id;
    el.textContent = id;
    document.body.appendChild(el);
    return el;
}

function isPilled(anchor: Element): boolean {
    return anchor.getAttribute(FLORA_RET_CHECK_KEY) === "1";
}

describe("injectInlineRetractionPills", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        resetRetractionPills();
    });

    it("pills every noticed DOI, including the page's own", () => {
        const primaryAnchor = anchorFor("primary");
        const secondAnchor = anchorFor("second");
        const map = new Map([[PRIMARY, notice(PRIMARY)], [SECOND_ARTICLE, notice(SECOND_ARTICLE)]]);

        injectInlineRetractionPills(
            [{ doi: PRIMARY, anchor: primaryAnchor }, { doi: SECOND_ARTICLE, anchor: secondAnchor }],
            map,
        );

        expect(isPilled(primaryAnchor)).toBe(true);
        expect(isPilled(secondAnchor)).toBe(true);
    });

    it("pills a noticed DOI once, at its first occurrence", () => {
        const first = anchorFor("first");
        const later = anchorFor("later");

        injectInlineRetractionPills(
            [{ doi: PRIMARY, anchor: first }, { doi: PRIMARY, anchor: later }],
            new Map([[PRIMARY, notice(PRIMARY)]]),
        );

        expect(isPilled(first)).toBe(true);
        expect(isPilled(later)).toBe(false);
    });

    it("re-places a notice its page wiped, without a reset", () => {
        const anchor = anchorFor("first");
        const occurrences = [{ doi: PRIMARY, anchor }];
        const map = new Map([[PRIMARY, notice(PRIMARY)]]);

        injectInlineRetractionPills(occurrences, map);
        // A hydrating SPA re-renders the region and takes the pill with it.
        for (const pill of document.querySelectorAll(".flora-notice-pill")) pill.remove();
        const restored = anchorFor("restored");

        injectInlineRetractionPills([{ doi: PRIMARY, anchor: restored }], map);

        expect(isPilled(restored)).toBe(true);
        expect(document.querySelectorAll(".flora-notice-pill")).toHaveLength(1);
    });

    it("pills reference occurrences", () => {
        const refAnchor = anchorFor("reference");

        injectInlineRetractionPills(
            [{ doi: REFERENCE, anchor: refAnchor }],
            new Map([[REFERENCE, notice(REFERENCE)]]),
        );

        expect(isPilled(refAnchor)).toBe(true);
    });

    it("leaves occurrences with no notice alone", () => {
        const cleanAnchor = anchorFor("clean");

        injectInlineRetractionPills(
            [{ doi: REFERENCE, anchor: cleanAnchor }],
            new Map(),
        );

        expect(isPilled(cleanAnchor)).toBe(false);
    });
});
