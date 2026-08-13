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

    it("skips only the DOI the title pill will carry", () => {
        const primaryAnchor = anchorFor("primary");
        const secondAnchor = anchorFor("second");
        const map = new Map([[PRIMARY, notice(PRIMARY)], [SECOND_ARTICLE, notice(SECOND_ARTICLE)]]);

        injectInlineRetractionPills(
            [{ doi: PRIMARY, anchor: primaryAnchor }, { doi: SECOND_ARTICLE, anchor: secondAnchor }],
            map,
            PRIMARY
        );

        expect(isPilled(primaryAnchor)).toBe(false);
        expect(isPilled(secondAnchor)).toBe(true);
    });

    it("pills the primary DOI when no title pill will be placed", () => {
        const primaryAnchor = anchorFor("primary");

        injectInlineRetractionPills(
            [{ doi: PRIMARY, anchor: primaryAnchor }],
            new Map([[PRIMARY, notice(PRIMARY)]]),
            null
        );

        expect(isPilled(primaryAnchor)).toBe(true);
    });

    it("pills reference occurrences", () => {
        const refAnchor = anchorFor("reference");

        injectInlineRetractionPills(
            [{ doi: REFERENCE, anchor: refAnchor }],
            new Map([[REFERENCE, notice(REFERENCE)]]),
            PRIMARY
        );

        expect(isPilled(refAnchor)).toBe(true);
    });

    it("leaves occurrences with no notice alone", () => {
        const cleanAnchor = anchorFor("clean");

        injectInlineRetractionPills(
            [{ doi: REFERENCE, anchor: cleanAnchor }],
            new Map(),
            PRIMARY
        );

        expect(isPilled(cleanAnchor)).toBe(false);
    });
});
