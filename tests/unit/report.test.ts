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

describe("a crafted report link", () => {
    async function decodeRaw(raw: unknown): Promise<ReportPayload | null> {
        return decodeReport(await encodeReport(raw as ReportPayload));
    }

    it("cannot inject markup through a count field", async () => {
        const decoded = await decodeRaw(payload({
            references: [{title: "Ref", doi: "10.1/x", replications: "<img src=x onerror=alert(1)>" as unknown as number}],
            pubpeer: {comments: "<script>alert(1)</script>" as unknown as number, url: "https://pubpeer.com/x"},
        }));
        const html = renderReportBody(decoded!);
        expect(html).not.toContain("<img");
        expect(html).not.toContain("<script");
    });

    it("cannot turn a title or entry link into script", async () => {
        const decoded = await decodeRaw(payload({
            sourceUrl: "javascript:alert(document.domain)",
            replications: [{title: "Rep", url: "JavaScript:alert(1)", doi: "10.1/rep"}],
        }));
        const html = renderReportBody(decoded!);
        expect(html.toLowerCase()).not.toContain("javascript:");
        expect(html).toContain('href="https://doi.org/10.1/rep"');
    });

    it("drops entries and references that are not objects", async () => {
        const decoded = await decodeRaw(payload({
            replications: ["<b>x</b>", null] as unknown as ReportPayload["replications"],
            references: [{title: "No DOI"} as ReportPayload["references"][number]],
        }));
        expect(decoded!.replications).toEqual([]);
        expect(decoded!.references).toEqual([]);
    });

    it("rejects a payload with a missing or impossible compile date", async () => {
        const {generated: _omitted, ...withoutDate} = payload();
        expect(await decodeRaw(withoutDate)).toBeNull();
        expect(await decodeRaw({...payload(), generated: 1e20})).toBeNull();
    });

    it("keeps a crafted DOI inside its doi.org path", async () => {
        const decoded = await decodeRaw(payload({
            references: [{title: "Ref", doi: "10.1/x?y=1#z", replications: 2}],
        }));
        expect(renderReportBody(decoded!)).toContain('href="https://doi.org/10.1/x%3Fy%3D1%23z"');
    });

    it("rejects a payload without a text title", async () => {
        expect(await decodeRaw({...payload(), title: 7})).toBeNull();
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
    });

    it("escapes the characters markup is built from in a title", () => {
        const html = renderReportBody(payload({title: "A < B & C"}));
        expect(html).toContain("A &lt; B &amp; C");
    });

    it("shows a title carrying markup and entities as plain text", () => {
        const html = renderReportBody(payload({title: "<i>Fusobacterium</i> &amp;nbsp;infection"}));
        expect(html).toContain("Fusobacterium infection");
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
