import { describe, it, expect, beforeEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
    beginDomScanPass,
    extractDoiOccurrences,
    classifyPageDois,
    extractPrimaryDOI,
    pageMightContainDoi,
} from "../../src/shared/doi-extractor";
import { isFloraOwnedNode, owningElement } from "../../src/shared/flora-ui";

function docFrom(body: string): Document {
    return new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`).window.document;
}

describe("DOI probe gating", () => {
    beforeEach(() => {
        beginDomScanPass();
    });

    it("skips the text passes on a page with no DOI-like text", () => {
        const doc = docFrom("<p>Just an ordinary page about gardening.</p>");
        const innerText = vi.fn(() => "Just an ordinary page about gardening.");
        Object.defineProperty(doc.body, "innerText", { get: innerText, configurable: true });

        expect(pageMightContainDoi(doc)).toBe(false);
        expect(extractDoiOccurrences(doc)).toHaveLength(0);
        classifyPageDois(doc);

        expect(innerText).not.toHaveBeenCalled();
    });

    it("still extracts when the page has DOI text", () => {
        const doc = docFrom("<p>See 10.1038/nature12373 for details.</p>");
        Object.defineProperty(doc.body, "innerText", {
            get: () => doc.body.textContent,
            configurable: true,
        });

        expect(pageMightContainDoi(doc)).toBe(true);
        expect(classifyPageDois(doc).allDois).toContain("10.1038/nature12373");
        expect(extractDoiOccurrences(doc).length).toBeGreaterThan(0);
    });

    it("passes the gate for a DOI that appears only in a link href", () => {
        const doc = docFrom('<a href="https://doi.org/10.1038/nature12373">paper</a>');

        expect(pageMightContainDoi(doc)).toBe(true);
    });

    it("re-probes after a new scan pass", () => {
        const doc = docFrom("<p>nothing here</p>");
        expect(pageMightContainDoi(doc)).toBe(false);

        doc.body.innerHTML = "<p>10.1038/nature12373</p>";
        expect(pageMightContainDoi(doc)).toBe(false);

        beginDomScanPass();
        expect(pageMightContainDoi(doc)).toBe(true);
    });
});

describe("text-node mutations", () => {
    it("does not claim a page text node as FLoRA's own", () => {
        const doc = docFrom('<ul id="refs"></ul>');
        const list = doc.getElementById("refs")!;
        const text = doc.createTextNode("Smith et al. 2020. 10.1038/nature12373");
        list.appendChild(text);

        expect(isFloraOwnedNode(text)).toBe(false);
        expect(owningElement(text)).toBe(list);
    });

    it("still claims a text node inside FLoRA's own UI", () => {
        const doc = docFrom('<span data-flora-ui=""></span>');
        const pill = doc.querySelector("[data-flora-ui]")!;
        const text = doc.createTextNode("10.1038/nature12373");
        pill.appendChild(text);

        expect(isFloraOwnedNode(text)).toBe(true);
    });

    it("ignores comment nodes so framework markers do not trigger scans", () => {
        const doc = docFrom("<div></div>");
        const comment = doc.createComment("react-marker");
        doc.querySelector("div")!.appendChild(comment);

        expect(isFloraOwnedNode(comment)).toBe(true);
        expect(owningElement(comment)).toBeNull();
    });
});

describe("primary DOI is resolved once per pass", () => {
    beforeEach(() => {
        beginDomScanPass();
    });

    it("reuses the result across the pass's several call sites", () => {
        const doc = docFrom("<p>body</p>");
        const meta = doc.createElement("meta");
        meta.setAttribute("name", "citation_doi");
        meta.setAttribute("content", "10.1038/nature12373");
        doc.head.appendChild(meta);

        expect(extractPrimaryDOI(doc)).toBe("10.1038/nature12373");

        meta.setAttribute("content", "10.1126/science.9999999");
        expect(extractPrimaryDOI(doc)).toBe("10.1038/nature12373");
    });

    it("re-reads the document on the next pass", () => {
        const doc = docFrom("<p>body</p>");
        const meta = doc.createElement("meta");
        meta.setAttribute("name", "citation_doi");
        meta.setAttribute("content", "10.1038/nature12373");
        doc.head.appendChild(meta);
        expect(extractPrimaryDOI(doc)).toBe("10.1038/nature12373");

        meta.setAttribute("content", "10.1126/science.9999999");
        beginDomScanPass();

        expect(extractPrimaryDOI(doc)).toBe("10.1126/science.9999999");
    });
});
