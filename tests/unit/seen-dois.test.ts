import { describe, it, expect, beforeEach } from "vitest";
import { SeenDois } from "../../src/content-general/seen-dois";
import type { DoiString } from "../../src/shared/types";

const VALID = "10.1000/valid" as DoiString;
const INVALID = "10.1000/invalid" as DoiString;
const OFF_PAGE = "10.1000/from-title-augmentation" as DoiString;

describe("SeenDois", () => {
    let seen: SeenDois;

    beforeEach(() => {
        seen = new SeenDois();
    });

    it("reports a change on the first pass", () => {
        expect(seen.hasUnseen([VALID])).toBe(true);
    });

    it("converges once the same DOIs are seen again", () => {
        seen.mark([VALID]);

        expect(seen.hasUnseen([VALID])).toBe(false);
    });

    it("converges for a DOI that failed validation", () => {
        seen.mark([VALID, INVALID]);

        expect(seen.hasUnseen([VALID, INVALID])).toBe(false);
    });

    it("stays converged when a DOI resolved out of band is never on the page", () => {
        seen.mark([VALID]);

        expect(seen.hasUnseen([VALID])).toBe(false);
        expect(seen.hasUnseen([VALID])).toBe(false);
    });

    it("stays converged when a DOI leaves the page", () => {
        seen.mark([VALID, INVALID]);

        expect(seen.hasUnseen([VALID])).toBe(false);
    });

    it("reports a change when a new DOI appears alongside seen ones", () => {
        seen.mark([VALID, INVALID]);

        expect(seen.hasUnseen([VALID, INVALID, OFF_PAGE])).toBe(true);
    });

    it("reports no change for an empty page", () => {
        expect(seen.hasUnseen([])).toBe(false);
    });

    it("re-reports every DOI after a navigation clears it", () => {
        seen.mark([VALID]);
        seen.clear();

        expect(seen.hasUnseen([VALID])).toBe(true);
    });
});
