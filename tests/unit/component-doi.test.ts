import {beforeEach, describe, expect, it, vi} from "vitest";
import {isComponentDoi, beginDomScanPass, extractDoiOccurrences} from "../../src/shared/doi-extractor";
import {injectLooseDoiPills, resetLooseDoiPills, LOOSE_PILL_ATTR} from "../../src/content-general/loose-dois";
import type {DoiContext, DoiString, LookupState} from "../../src/shared/types";

vi.mock("../../src/shared/pubpeer-api", () => ({lookupPubPeerForDoi: vi.fn().mockResolvedValue(null)}));
vi.mock("../../src/shared/settings", () => ({getSettings: vi.fn().mockResolvedValue({email: "test@example.com"})}));
vi.mock("../../src/shared/openaccess", () => ({fetchOpenAccess: vi.fn().mockResolvedValue(null), deferredOpenAccess: () => () => Promise.resolve(null)}));

const PLOS = "10.1371/journal.pmed.0020124";

describe("isComponentDoi", () => {
    it("recognises PLOS figure, table and supplement DOIs with or without the page DOI", () => {
        for (const tail of [".g001", ".t002", ".s001", ".sd001", ".G001"]) {
            expect(isComponentDoi(`${PLOS}${tail}`, PLOS)).toBe(true);
            expect(isComponentDoi(`${PLOS}${tail}`, null)).toBe(true);
        }
    });

    it("recognises component tails on the page's own DOI from other publishers", () => {
        const primary = "10.7717/peerj.1234";
        for (const tail of ["/fig-1", "/table-2", "/figures/3", "/supp-1", ".g001"]) {
            expect(isComponentDoi(`${primary}${tail}`, primary)).toBe(true);
        }
        expect(isComponentDoi("10.7717/PEERJ.1234/FIG-1", primary), "case-insensitive").toBe(true);
    });

    it("leaves papers alone", () => {
        expect(isComponentDoi(PLOS, PLOS), "the article itself").toBe(false);
        expect(isComponentDoi("10.1371/journal.pone.0123456", PLOS)).toBe(false);
        expect(isComponentDoi("10.1371/journal.pone.0123456", null)).toBe(false);
        expect(isComponentDoi("10.1234/abc.g001", null), "other prefix, no page DOI").toBe(false);
        expect(isComponentDoi("10.1234/abc.g001", "10.1234/xyz"), "other prefix, different article").toBe(false);
        expect(isComponentDoi("10.7717/peerj.1234/fig-1", "10.7717/peerj.9999")).toBe(false);
        expect(isComponentDoi("10.7717/peerj.12345", "10.7717/peerj.1234"), "longer id is a different paper").toBe(false);
        expect(isComponentDoi("10.1002/abc.2178.v2", "10.1002/abc.2178"), "version suffix").toBe(false);
    });
});

describe("loose DOI pills on a PLOS article", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        resetLooseDoiPills();
    });

    it("skips figure and table DOIs but still pills other mentioned papers", () => {
        const other = "10.1002/bdm.2178" as DoiString;
        document.body.innerHTML = `
            <figure><figcaption>Figure 1. <a href="https://doi.org/${PLOS}.g001">https://doi.org/${PLOS}.g001</a></figcaption></figure>
            <figure><figcaption>Table 2. <a href="https://doi.org/${PLOS}.t002">https://doi.org/${PLOS}.t002</a></figcaption></figure>
            <p>See ${other} for the replication.</p>`;
        const context = new Map<DoiString, DoiContext>([
            [`${PLOS}.g001` as DoiString, "other"],
            [`${PLOS}.t002` as DoiString, "other"],
            [other, "other"],
        ]);
        beginDomScanPass();
        const placed = injectLooseDoiPills({
            occurrences: extractDoiOccurrences(document),
            context, pageState: new Map<DoiString, LookupState>(), noticed: new Set(),
            primary: PLOS as DoiString,
        });
        expect(placed).toBe(1);
        const pilled = [...document.querySelectorAll(`[${LOOSE_PILL_ATTR}]`)].map(p => p.getAttribute("data-flora-doi"));
        expect(pilled).toEqual([other]);
    });
});
