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

    it("sits on its own row at the end of the paragraph, leaving the text unsplit", () => {
        document.body.innerHTML = `<p>See ${LOOSE} for the replication.</p>`;
        run(new Map([[LOOSE, "other"]]));
        const p = document.querySelector("p")!;
        const row = p.lastElementChild!;
        expect(row.classList.contains("flora-pill-row")).toBe(true);
        expect(row.contains(pills()[0])).toBe(true);
        expect(p.childNodes).toHaveLength(2);
        expect(p.firstChild!.textContent).toBe(`See ${LOOSE} for the replication.`);
    });

    it("puts a mention on a <br>-separated line right after that <br>", () => {
        document.body.innerHTML = `<p>Journal X<br>doi: ${LOOSE}<br>Next line</p>`;
        run(new Map([[LOOSE, "other"]]));
        const brs = document.querySelectorAll("br");
        expect(brs[1].nextElementSibling!.classList.contains("flora-pill-row")).toBe(true);
        expect(brs[0].nextSibling!.textContent).toBe(`doi: ${LOOSE}`);
    });

    it("stops the line run at a block sibling", () => {
        document.body.innerHTML = `<div>Cite ${LOOSE} <span>inline</span><div>block</div>tail</div>`;
        run(new Map([[LOOSE, "other"]]));
        const outer = document.querySelector("div")!;
        const row = outer.querySelector(".flora-pill-row")!;
        expect(row.previousElementSibling!.tagName).toBe("SPAN");
        expect(row.nextElementSibling!.tagName).toBe("DIV");
    });

    it("shares one row between two DOIs in a paragraph", () => {
        const OTHER = "10.1002/other.9" as DoiString;
        document.body.innerHTML = `<p>See ${LOOSE} and ${OTHER} here.</p>`;
        run(new Map<DoiString, DoiContext>([[LOOSE, "other"], [OTHER, "other"]]));
        const rows = document.querySelectorAll(".flora-pill-row");
        expect(rows).toHaveLength(1);
        expect(rows[0].querySelectorAll(`[${LOOSE_PILL_ATTR}]`)).toHaveLength(2);
    });

    it("puts the pill below an arXiv-style link, after its inline-block tooltip", () => {
        document.body.innerHTML =
            `<table><tbody><tr><td>Cite as: <a href="https://doi.org/${LOOSE}">doi</a>` +
            `<span style="display:inline-block" class="tip">?</span></td></tr></tbody></table>`;
        run(new Map([[LOOSE, "other"]]));
        const td = document.querySelector("td")!;
        expect(td.lastElementChild!.classList.contains("flora-pill-row")).toBe(true);
        expect(td.querySelector("a")!.nextElementSibling!.className).toBe("tip");
    });

    it("keeps a trailing doi link at the end of a <br>-separated paragraph", () => {
        document.body.innerHTML =
            `<p>Title<br>Journal 2020<br>doi: <a href="https://doi.org/${LOOSE}">${LOOSE}</a></p>`;
        run(new Map([[LOOSE, "other"]]));
        expect(document.querySelector("p")!.lastElementChild!.classList.contains("flora-pill-row")).toBe(true);
    });

    it("places a flat [n] entry's pill after its <br>, before the next anchor", () => {
        document.body.innerHTML =
            `<div><a id="intRef1">[1]</a> Author. Title. ${LOOSE}<br><a id="intRef2">[2]</a> Next.</div>`;
        run(new Map([[LOOSE, "other"]]));
        const br = document.querySelector("br")!;
        expect(br.nextElementSibling!.classList.contains("flora-pill-row")).toBe(true);
        expect(br.nextElementSibling!.nextElementSibling!.id).toBe("intRef2");
    });

    it("skips an occurrence inside an entry the reference renderer owns", () => {
        document.body.innerHTML = `<ol><li data-flora-ref-processed="true">See ${LOOSE}</li></ol>`;
        expect(run(new Map([[LOOSE, "other"]]))).toBe(0);
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

describe("a mention that is a prefix of the primary DOI", () => {
    function runWithPrimary(doi: DoiString, primary: DoiString): number {
        document.body.innerHTML = `<p>Cited ${doi} here.</p>`;
        beginDomScanPass();
        return injectLooseDoiPills({
            occurrences: extractDoiOccurrences(document),
            context: new Map([[doi, "other"]]),
            pageState,
            noticed: new Set(),
            primary,
        });
    }

    it("skips a journal prefix of the primary", () => {
        expect(runWithPrimary("10.18559/ebr" as DoiString, "10.18559/ebr.2021.2.2" as DoiString)).toBe(0);
    });

    it("skips a versionless form of the primary", () => {
        expect(runWithPrimary("10.6084/m9.figshare.29863007" as DoiString, "10.6084/m9.figshare.29863007.v1" as DoiString)).toBe(0);
    });

    it("still pills an unrelated DOI", () => {
        expect(runWithPrimary(LOOSE, "10.18559/ebr.2021.2.2" as DoiString)).toBe(1);
    });

    it("does not skip a DOI that merely shares leading characters", () => {
        expect(runWithPrimary("10.1234/abc" as DoiString, "10.1234/abcd" as DoiString)).toBe(1);
    });
});
