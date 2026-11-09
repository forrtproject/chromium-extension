import {afterEach, describe, expect, it, vi} from "vitest";
import {buildReportPdf, pdfText, reportPdfFilename} from "../../src/shared/report-pdf";
import type {ReportPayload} from "../../src/shared/report";
import {renderSidePanel, removeSidePanel} from "../../src/content-general/injector";
import type {DoiContext, DoiString, LookupState} from "../../src/shared/types";
import {doi, mockResult} from "../helpers";

function payload(overrides: Partial<ReportPayload> = {}): ReportPayload {
    return {
        v: 1,
        title: "Power Posing: Brief Nonverbal Displays",
        doi: "10.1177/0956797610383437",
        authors: "Carney et al.",
        year: 2010,
        sourceUrl: "https://example.org/article",
        generated: Date.UTC(2026, 0, 15),
        notice: {kind: "retraction", doi: "10.1/notice"},
        replications: [{title: "A direct replication", doi: "10.1/rep", url: "https://example.org/rep", year: 2015, outcome: "failed"}],
        reproductions: [],
        originals: [],
        references: [{title: "A cited paper", doi: "10.1/cited", replications: 2, notice: "concern"}],
        pubpeer: {comments: 13, url: "https://pubpeer.com/publications/X"},
        ...overrides,
    };
}

const text = (pdf: ArrayBuffer): string => new TextDecoder("latin1").decode(pdf);

describe("the report PDF", () => {
    it("is a PDF that carries the report's text and clickable links", () => {
        const pdf = text(buildReportPdf(payload()));

        expect(pdf.startsWith("%PDF-")).toBe(true);
        expect(pdf).toContain("Power Posing: Brief Nonverbal Displays");
        expect(pdf).toContain("This article has been retracted.");
        expect(pdf).toContain("A direct replication");
        expect(pdf).toContain("FLAGGED REFERENCES");
        expect(pdf).toContain("not a verdict");
        expect(pdf).toContain("/URI (https://example.org/article)");
        expect(pdf).toContain("/URI (https://doi.org/10.1/notice)");
        expect(pdf).toContain("/URI (https://doi.org/10.1/cited)");
    });

    it("runs onto further pages for a long report and numbers them", () => {
        const many = Array.from({length: 80}, (_, i) => ({title: `Replication number ${i + 1}`, doi: `10.1/rep${i}`, year: 2020}));
        const pdf = text(buildReportPdf(payload({replications: many})));

        expect(pdf).toMatch(/page 1 of [2-9]/);
        expect(pdf).toContain("Replication number 80");
    });

    it("never links an invalid DOI", () => {
        const pdf = text(buildReportPdf(payload({
            notice: {kind: "retraction"},
            replications: [{title: "Odd record", doi: "10.1/\uD800bad", year: 2015}],
        })));

        expect(pdf).toContain("Odd record");
        expect(pdf).not.toContain("doi.org/10.1/\uD800");
    });

    it("keeps the characters the built-in fonts can print and simplifies the rest", () => {
        expect(pdfText("Café – “quoted” — naïve")).toBe("Café – “quoted” — naïve");
        expect(pdfText("Łódź α-synuclein")).toBe("Lódz ?-synuclein");
    });

    it("names the file after the article, without characters a file system rejects", () => {
        expect(reportPdfFilename(payload({title: "<i>Power</i> Posing: a/b?"}))).toBe("ORE report – Power Posing a b.pdf");
    });
});

describe("the panel's Download button", () => {
    const ARTICLE = doi("10.1038/nature12373");
    const sendMessage = vi.mocked(chrome.runtime.sendMessage);

    afterEach(() => {
        removeSidePanel();
        vi.restoreAllMocks();
        sendMessage.mockResolvedValue({type: "FLORA_LOOKUP_RESULT", results: {}, errors: {}});
    });

    it("asks the worker for the PDF and saves it without opening a print window", async () => {
        sendMessage.mockResolvedValue({type: "FLORA_REPORT_PDF_RESULT", pdf: btoa("%PDF-1.3 test"), filename: "ORE report – Test.pdf", error: null});
        const openSpy = vi.spyOn(window, "open");
        const clicks: HTMLAnchorElement[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
        URL.createObjectURL = vi.fn(() => "blob:report");
        URL.revokeObjectURL = vi.fn();

        renderSidePanel([], [], new Map<DoiString, LookupState>([[ARTICLE, {status: "matched", result: mockResult(), source: "extracted"}]]),
            new Map<DoiString, DoiContext>([[ARTICLE, "article"]]), new Map(), [], "Test article");
        [...document.querySelectorAll<HTMLButtonElement>("#flora-pubpeer-panel button")].find((b) => b.textContent === "Download")!.click();

        await vi.waitFor(() => expect(clicks).toHaveLength(1));
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({type: "FLORA_REPORT_PDF", payload: expect.objectContaining({v: 1, title: "Test article"})}));
        expect(clicks[0].download).toBe("ORE report – Test.pdf");
        expect(clicks[0].href).toBe("blob:report");
        expect(openSpy).not.toHaveBeenCalled();
    });
});
