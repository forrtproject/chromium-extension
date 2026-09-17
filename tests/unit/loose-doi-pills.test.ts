import {beforeEach, describe, expect, it, vi} from "vitest";
import {injectLooseDoiPills, resetLooseDoiPills, LOOSE_PILL_ATTR} from "../../src/content-general/loose-dois";
import {beginDomScanPass, extractDoiOccurrences} from "../../src/shared/doi-extractor";
import type {DoiContext, DoiString, LookupState} from "../../src/shared/types";

vi.mock("../../src/shared/pubpeer-api", () => ({lookupPubPeerForDoi: vi.fn().mockResolvedValue(null)}));
vi.mock("../../src/shared/settings", () => ({getSettings: vi.fn().mockResolvedValue({email: "test@example.com"})}));
vi.mock("../../src/shared/openaccess", () => ({fetchOpenAccess: vi.fn().mockResolvedValue(null)}));

const LOOSE = "10.1002/bdm.2178" as DoiString;
const pageState = new Map<DoiString, LookupState>();

function run(context: Map<DoiString, DoiContext>, noticed: Set<DoiString> = new Set()): number {
    beginDomScanPass();
    return injectLooseDoiPills({occurrences: extractDoiOccurrences(document), context, pageState, noticed});
}

const pills = () => document.querySelectorAll(`[${LOOSE_PILL_ATTR}]`);

beforeEach(() => {
    document.body.innerHTML = "";
    resetLooseDoiPills();
    pageState.clear();
});

describe("DOIs loose on a page, outside an article or reference list", () => {
    it("pills a DOI mentioned in ordinary prose", () => {
        document.body.innerHTML = `<p>See ${LOOSE} for the replication.</p>`;
        expect(run(new Map([[LOOSE, "other"]]))).toBe(1);
        expect(pills()[0].getAttribute("data-flora-doi")).toBe(LOOSE);
    });

    it("sits beside the mention, not after the trailing prose", () => {
        document.body.innerHTML = `<p>See ${LOOSE} for the replication.</p>`;
        run(new Map([[LOOSE, "other"]]));
        const pill = pills()[0];
        expect(pill.previousSibling!.textContent!.endsWith(LOOSE)).toBe(true);
        expect(pill.nextSibling!.textContent).toBe(" for the replication.");
        const ownText = [...document.querySelector("p")!.childNodes]
            .filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join("");
        expect(ownText, "the sentence itself must read exactly as before")
            .toBe(`See ${LOOSE} for the replication.`);
    });

    it("leaves article and reference DOIs to their own renderers", () => {
        document.body.innerHTML = `<p>See ${LOOSE} here.</p>`;
        expect(run(new Map([[LOOSE, "article"]]))).toBe(0);
        expect(run(new Map([[LOOSE, "reference"]]))).toBe(0);
        expect(pills()).toHaveLength(0);
    });

    it("stands aside for a DOI that already carries a notice", () => {
        document.body.innerHTML = `<p>See ${LOOSE} here.</p>`;
        expect(run(new Map([[LOOSE, "other"]]), new Set([LOOSE]))).toBe(0);
    });

    it("never writes into a draft the reader is editing", () => {
        document.body.innerHTML =
            `<div contenteditable="true"><p>Citing ${LOOSE} in my draft.</p></div>` +
            `<textarea>Bibliography: ${LOOSE}</textarea>`;
        expect(run(new Map([[LOOSE, "other"]]))).toBe(0);
        expect(document.querySelector("textarea")!.value).toBe(`Bibliography: ${LOOSE}`);
    });

    it("pills each DOI once, however many passes run", () => {
        document.body.innerHTML = `<p>${LOOSE} and again ${LOOSE}.</p>`;
        const context = new Map<DoiString, DoiContext>([[LOOSE, "other"]]);
        expect(run(context)).toBe(1);
        expect(run(context)).toBe(0);
        expect(pills()).toHaveLength(1);
    });

    it("puts the pill back after an SPA wipes it", () => {
        document.body.innerHTML = `<p>See ${LOOSE} here.</p>`;
        const context = new Map<DoiString, DoiContext>([[LOOSE, "other"]]);
        run(context);
        document.body.innerHTML = `<p>See ${LOOSE} here.</p>`;
        expect(run(context), "the marker must not outlive the pill it tracked").toBe(1);
    });
});
