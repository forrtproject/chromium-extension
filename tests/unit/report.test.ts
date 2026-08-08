import {describe, expect, it} from "vitest";
import {
    decodeReport,
    encodeReport,
    renderReportBody,
    renderReportDocument,
    reportUrl,
    type ReportPayload,
} from "../../src/shared/report";

function payload(overrides: Partial<ReportPayload> = {}): ReportPayload {
    return {
        v: 1,
        title: "Power Posing: Brief Nonverbal Displays Affect Neuroendocrine Levels",
        doi: "10.1126/science.1185714",
        authors: "Cuddy et al.",
        year: 2010,
        sourceUrl: "https://example.org/article",
        generated: Date.UTC(2026, 0, 15),
        notice: null,
        replications: [
            {title: "A direct replication", doi: "10.1/rep", year: 2015, outcome: "failed"},
        ],
        reproductions: [],
        originals: [],
        references: [],
        pubpeer: null,
        ...overrides,
    };
}

describe("report link encoding", () => {
    it("survives a round trip through the fragment", async () => {
        const original = payload();
        const decoded = await decodeReport(await encodeReport(original));
        expect(decoded).toEqual(original);
    });

    it("produces a fragment that is URL-safe", async () => {
        expect(await encodeReport(payload())).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("compresses rather than inflating the payload", async () => {
        const big = payload({
            references: Array.from({length: 60}, (_, i) => ({
                title: `A reference about replication number ${i}`,
                doi: `10.1000/ref${i}`,
                replications: 2,
            })),
        });
        const encoded = await encodeReport(big);
        expect(encoded.length).toBeLessThan(JSON.stringify(big).length);
    });

    it("puts the report after the hash, where no server sees it", async () => {
        const url = await reportUrl(payload());
        const [base, fragment] = url.split("#");
        expect(base).not.toContain("10.1126");
        expect(fragment).toBeTruthy();
    });

    it("returns null rather than throwing on a truncated or foreign fragment", async () => {
        expect(await decodeReport("not-a-report")).toBeNull();
        expect(await decodeReport("")).toBeNull();
        const encoded = await encodeReport(payload());
        expect(await decodeReport(encoded.slice(0, encoded.length - 12))).toBeNull();
    });

    it("rejects a payload from a version it cannot read", async () => {
        const encoded = await encodeReport({...payload(), v: 2 as unknown as 1});
        expect(await decodeReport(encoded)).toBeNull();
    });
});

describe("report rendering", () => {
    it("leads with the paper and its evidence", () => {
        const html = renderReportBody(payload());
        expect(html).toContain("Power Posing");
        expect(html).toContain("Cuddy et al.");
        expect(html).toContain("10.1126/science.1185714");
        expect(html).toContain("A direct replication");
        expect(html).toContain("failed");
    });

    it("names a retraction and a concern differently", () => {
        expect(renderReportBody(payload({notice: {kind: "retraction", doi: "10.1/n"}})))
            .toContain("has been retracted");
        expect(renderReportBody(payload({notice: {kind: "concern", doi: "10.1/n"}})))
            .toContain("expression of concern");
    });

    it("lists only the references that carry a signal", () => {
        const html = renderReportBody(payload({
            references: [
                {title: "Flagged reference", doi: "10.1/a", replications: 3},
                {title: "Unremarkable reference", doi: "10.1/b"},
            ],
        }));
        expect(html).toContain("Flagged reference");
        expect(html).not.toContain("Unremarkable reference");
    });

    it("escapes a title rather than letting it inject markup", () => {
        const html = renderReportBody(payload({title: `<img src=x onerror="alert(1)">`}));
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
    });

    it("says what the evidence is and is not", () => {
        expect(renderReportBody(payload())).toContain("not a verdict");
    });

    it("prints as a standalone document with its own styles", () => {
        const doc = renderReportDocument(payload());
        expect(doc.startsWith("<!doctype html>")).toBe(true);
        expect(doc).toContain("@media print");
        expect(doc).toContain("Power Posing");
    });
});
