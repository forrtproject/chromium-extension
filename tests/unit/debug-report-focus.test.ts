import {describe, expect, it, vi} from "vitest";
import type {DebugLogEntry} from "../../src/shared/debug";

const log = vi.hoisted(() => ({entries: [] as DebugLogEntry[]}));
vi.mock("../../src/shared/debug-log", () => ({readDebugLog: vi.fn(async () => log.entries)}));
vi.mock("../../src/shared/settings", () => ({
    getSettings: vi.fn(async () => ({email: "a@b.c", citationStyle: "apa", cacheQuotaMb: 50})),
    effectiveCacheQuotaMb: (mb: number) => mb,
}));
vi.mock("../../src/shared/domains", () => ({getBlockedDomains: vi.fn(async () => [])}));
vi.mock("../../src/shared/pubpeer-filter", () => ({getHiddenCommenters: vi.fn(async () => [])}));

import {buildDebugReport} from "../../src/shared/debug-report";

const entry = (ctx: string, msg: string): DebugLogEntry => ({t: 0, level: "info", ctx, msg});

describe("debug report for one page", () => {
    it("keeps this page's and the extension's entries and counts the rest", async () => {
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
        expect(text).toContain(
            "Left out 781 entries from other tabs: mail.google.com (700), meet.google.com (80), ukc-word-edit.officeapps.live.com (1)");
        expect(text).not.toContain("[mail.google.com]");
    });

    it("accepts the bare hostname the popup passes", async () => {
        log.entries = [entry("osf.io", "a"), entry("mail.google.com", "b")];
        const {data} = await buildDebugReport({pageUrl: "osf.io"});
        expect(data.entries.map((e) => e.ctx)).toEqual(["osf.io"]);
    });

    it("treats a dotless page host as another tab, not as the extension", async () => {
        log.entries = [entry("localhost", "local dev page"), entry("background", "worker"), entry("osf.io", "a")];
        const {data} = await buildDebugReport({pageUrl: "https://osf.io/x"});
        expect(data.entries.map((e) => e.ctx)).toEqual(["background", "osf.io"]);
        expect(data.otherTabs).toEqual([{ctx: "localhost", count: 1}]);
    });

    it("says the page has no entries yet when every entry came from other tabs", async () => {
        log.entries = [entry("mail.google.com", "b")];
        const {text} = await buildDebugReport({pageUrl: "https://osf.io/x"});
        expect(text).toContain("No entries from this page yet");
        expect(text).not.toContain("Turn debug mode on");
    });

    it("keeps the Word frame's entries on the SharePoint page that hosts it", async () => {
        log.entries = [entry("ukc-word-edit.officeapps.live.com", "Word: pass"), entry("contoso.sharepoint.com", "outer"),
            entry("osf.io", "other tab")];
        const {data} = await buildDebugReport({pageUrl: "https://contoso.sharepoint.com/:w:/r/doc"});
        expect(data.entries.map((e) => e.msg)).toEqual(["Word: pass", "outer"]);
    });

    it("names at most eight other tabs, however many there are", async () => {
        log.entries = Array.from({length: 30}, (_, i) => entry(`site-${i}.example.com`, "x"));
        const {text} = await buildDebugReport({pageUrl: "https://osf.io/x"});
        const note = text.split("\n").find((line) => line.startsWith("_Left out"))!;
        expect(note.match(/\.example\.com/g)).toHaveLength(8);
        expect(note).toContain("and 22 more");
    });

    it("treats www. and the bare host as the same page", async () => {
        log.entries = [entry("www.example.org", "a"), entry("example.org", "b"), entry("mail.google.com", "c")];
        const {data} = await buildDebugReport({pageUrl: "https://example.org/article"});
        expect(data.entries.map((e) => e.msg)).toEqual(["a", "b"]);
    });

    it("keeps every entry when no page is given", async () => {
        log.entries = [entry("osf.io", "a"), entry("mail.google.com", "b")];
        const {text, data} = await buildDebugReport();
        expect(data.entries).toHaveLength(2);
        expect(text).not.toContain("Left out");
    });
});
