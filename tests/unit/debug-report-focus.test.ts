import {describe, expect, it, vi} from "vitest";
import type {DebugLogEntry} from "../../src/shared/debug";

const log = vi.hoisted(() => ({entries: [] as DebugLogEntry[]}));
vi.mock("../../src/shared/debug-log", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../src/shared/debug-log")>(),
    readDebugLog: vi.fn(async () => log.entries),
}));
vi.mock("../../src/shared/settings", () => ({
    getSettings: vi.fn(async () => ({email: "a@b.c", citationStyle: "apa", cacheQuotaMb: 50})),
    effectiveCacheQuotaMb: (mb: number) => mb,
}));
vi.mock("../../src/shared/domains", () => ({
    getBlockedDomains: vi.fn(async () => []),
    getDisabledSites: vi.fn(async () => []),
}));
vi.mock("../../src/shared/pubpeer-filter", () => ({getHiddenCommenters: vi.fn(async () => [])}));

import {buildDebugReport} from "../../src/shared/debug-report";

const entry = (ctx: string, msg: string): DebugLogEntry => ({t: 0, level: "log", ctx, msg});

describe("debug report for one page", () => {
    it("keeps this page's and the extension's entries and only counts the rest", async () => {
        log.entries = [
            ...Array.from({length: 700}, () => entry("mail.google.com", "mutation carried no DOI candidates")),
            entry("osf.io", "Work: scan started"),
            entry("background", "Lookup: 1 DOI"),
            entry("ukc-word-edit.officeapps.live.com", "Word: pass"),
            ...Array.from({length: 80}, () => entry("meet.google.com", "mutation carried no DOI candidates")),
            entry("osf.io", "Work: page quiet — Done in 5.7 s"),
        ];
        const {text, data} = await buildDebugReport({pageUrl: "https://osf.io/preprints/metaarxiv/rhvqk_v3"});
        expect(data.entries.map((e) => e.ctx)).toEqual(["osf.io", "background", "osf.io"]);
        expect(text).toContain("Left out 781 entries from other pages.");
        expect(text).not.toContain("google.com");
        expect(text).not.toContain("officeapps");
    });

    it("names the reported site by host only, without its path", async () => {
        log.entries = [entry("osf.io", "a")];
        const {text} = await buildDebugReport({pageUrl: "https://osf.io/preprints/metaarxiv/rhvqk_v3"});
        expect(text).toContain("Page: osf.io");
        expect(text).not.toContain("rhvqk_v3");
    });

    it("accepts the bare hostname the popup passes", async () => {
        log.entries = [entry("osf.io", "a"), entry("mail.google.com", "b")];
        const {data} = await buildDebugReport({pageUrl: "osf.io"});
        expect(data.entries.map((e) => e.ctx)).toEqual(["osf.io"]);
    });

    it("treats a dotless page host as another page, not as the extension", async () => {
        log.entries = [entry("localhost", "local dev page"), entry("background", "worker"), entry("osf.io", "a")];
        const {data} = await buildDebugReport({pageUrl: "https://osf.io/x"});
        expect(data.entries.map((e) => e.ctx)).toEqual(["background", "osf.io"]);
        expect(data.otherPageEntries).toBe(1);
    });

    it("says the page has no entries yet when every entry came from other pages", async () => {
        log.entries = [entry("mail.google.com", "b")];
        const {text} = await buildDebugReport({pageUrl: "https://osf.io/x"});
        expect(text).toContain("No entries from this page yet");
    });

    it("keeps the Word frame's entries on the SharePoint page that hosts it", async () => {
        log.entries = [entry("ukc-word-edit.officeapps.live.com", "Word: pass"), entry("contoso.sharepoint.com", "outer"),
            entry("osf.io", "other tab")];
        const {data} = await buildDebugReport({pageUrl: "https://contoso.sharepoint.com/:w:/r/doc"});
        expect(data.entries.map((e) => e.msg)).toEqual(["Word: pass", "outer"]);
    });

    it("keeps the Word frame's entries when the document is open in Teams", async () => {
        log.entries = [entry("ukc-word-edit.officeapps.live.com", "Word: pass"), entry("osf.io", "other tab")];
        const {data, text} = await buildDebugReport({pageUrl: "https://teams.microsoft.com/v2/#/docx/viewer"});
        expect(data.entries.map((e) => e.msg)).toEqual(["Word: pass"]);
        expect(text).toContain("[office frame]");
    });

    it("treats www. and the bare host as the same page", async () => {
        log.entries = [entry("www.example.org", "a"), entry("example.org", "b"), entry("mail.google.com", "c")];
        const {data} = await buildDebugReport({pageUrl: "https://example.org/article"});
        expect(data.entries.map((e) => e.msg)).toEqual(["a", "b"]);
    });

    it("keeps every entry but numbers the pages when no page is given", async () => {
        log.entries = [entry("osf.io", "a"), entry("mail.google.com", "b"), entry("osf.io", "c"), entry("background", "d")];
        const {text, data} = await buildDebugReport();
        expect(data.entries).toHaveLength(4);
        expect(text).not.toContain("Left out");
        expect(text).not.toMatch(/osf\.io|google\.com/);
        expect(text).toMatch(/\[page 1\] INFO {3}a[\s\S]*\[page 2\] INFO {3}b[\s\S]*\[page 1\] INFO {3}c[\s\S]*\[background\]/);
    });

    it("removes links to pages but keeps the service APIs ORE calls", async () => {
        log.entries = [entry("osf.io", "Navigating to https://mail.google.com/mail/u/0/#inbox then https://api.crossref.org/works/10.1/x and https://osf.io/abc")];
        const {text} = await buildDebugReport({pageUrl: "https://osf.io/x"});
        expect(text).toContain("Navigating to [url] then https://api.crossref.org/works/10.1/x and https://osf.io/abc");
    });

    it("folds a run of identical lines into one with a count", async () => {
        log.entries = [...Array.from({length: 5}, () => entry("osf.io", "skipped full scan")), entry("osf.io", "done")];
        const {text} = await buildDebugReport({pageUrl: "https://osf.io/x"});
        expect(text.match(/skipped full scan/g)).toHaveLength(1);
        expect(text).toContain("skipped full scan  (×5)");
    });
});
