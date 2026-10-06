import { describe, it, expect } from "vitest";
import {
    isLookupRequest,
    isRetractionCheckRequest,
    isAugmentRequest,
    isPmcResolveRequest,
    isScanStateMessage,
    isSheetFetchRequest,
} from "../../src/shared/messages";

describe("message guards reject malformed payloads", () => {
    it("rejects a lookup with no dois array", () => {
        expect(isLookupRequest({ type: "FLORA_LOOKUP" })).toBe(false);
        expect(isLookupRequest({ type: "FLORA_LOOKUP", dois: null })).toBe(false);
        expect(isLookupRequest({ type: "FLORA_LOOKUP", dois: "10.1/x" })).toBe(false);
    });

    it("accepts a well-formed lookup", () => {
        expect(isLookupRequest({ type: "FLORA_LOOKUP", dois: [] })).toBe(true);
        expect(isLookupRequest({ type: "FLORA_LOOKUP", dois: ["10.1/x"] })).toBe(true);
    });

    it("rejects a retraction check with no dois array", () => {
        expect(isRetractionCheckRequest({ type: "FLORA_RET_CHECK" })).toBe(false);
        expect(isRetractionCheckRequest({ type: "FLORA_RET_CHECK", dois: [] })).toBe(true);
    });

    it("rejects an augment request with no requests array", () => {
        expect(isAugmentRequest({ type: "FLORA_AUGMENT" })).toBe(false);
        expect(isAugmentRequest({ type: "FLORA_AUGMENT", requests: [] })).toBe(true);
    });

    it("rejects a PMC resolve with no pmcids array", () => {
        expect(isPmcResolveRequest({ type: "FLORA_PMC_RESOLVE" })).toBe(false);
        expect(isPmcResolveRequest({ type: "FLORA_PMC_RESOLVE", pmcids: [] })).toBe(true);
    });

    it("rejects a PMC resolve asking for an id type the resolver has no normaliser for", () => {
        expect(isPmcResolveRequest({ type: "FLORA_PMC_RESOLVE", pmcids: [], idtype: "doi" })).toBe(false);
        expect(isPmcResolveRequest({ type: "FLORA_PMC_RESOLVE", pmcids: [], idtype: "pmid" })).toBe(true);
        expect(isPmcResolveRequest({ type: "FLORA_PMC_RESOLVE", pmcids: [], idtype: "pmcid" })).toBe(true);
    });

    it("accepts well-formed scan states", () => {
        const wrap = (state: unknown) => ({ type: "FLORA_SCAN_STATE", state });
        expect(isScanStateMessage(wrap({ phase: "scanning", papers: 0 }))).toBe(true);
        expect(isScanStateMessage(wrap({ phase: "done", papers: 3, flagged: 1, incomplete: false }))).toBe(true);
        expect(isScanStateMessage(wrap({ phase: "error", pageUrl: "https://a.test/", pageKey: "k", error: { message: "x" }, entries: [] }))).toBe(true);
    });

    it("rejects malformed scan states", () => {
        const wrap = (state: unknown) => ({ type: "FLORA_SCAN_STATE", state });
        expect(isScanStateMessage(null)).toBe(false);
        expect(isScanStateMessage({ type: "FLORA_ACTIVE_STATE", state: { phase: "scanning", papers: 1 } })).toBe(false);
        expect(isScanStateMessage(wrap({ phase: "paused" }))).toBe(false);
        expect(isScanStateMessage(wrap({ phase: "scanning" }))).toBe(false);
        expect(isScanStateMessage(wrap({ phase: "done", papers: 1, flagged: 0, incomplete: "no" }))).toBe(false);
        expect(isScanStateMessage(wrap({ phase: "error", pageUrl: "https://a.test/", pageKey: "k", error: { message: "x" } }))).toBe(false);
        expect(isScanStateMessage(wrap({ phase: "error", pageUrl: "https://a.test/", pageKey: "k", error: {}, entries: [] }))).toBe(false);
    });

    it("rejects counts that are not finite non-negative integers", () => {
        const wrap = (state: unknown) => ({ type: "FLORA_SCAN_STATE", state });
        for (const bad of [-1, NaN, Infinity, 1.5, "3"]) {
            expect(isScanStateMessage(wrap({ phase: "scanning", papers: bad }))).toBe(false);
            expect(isScanStateMessage(wrap({ phase: "done", papers: bad, flagged: 0, incomplete: false }))).toBe(false);
            expect(isScanStateMessage(wrap({ phase: "done", papers: 1, flagged: bad, incomplete: false }))).toBe(false);
        }
    });

    it("rejects an error state with a malformed error or entries", () => {
        const wrap = (state: unknown) => ({ type: "FLORA_SCAN_STATE", state });
        const entry = { t: 1, level: "log", ctx: "a.test", msg: "m" };
        const error = (overrides: object) => ({ phase: "error", pageUrl: "https://a.test/", pageKey: "k", error: { message: "x" }, entries: [], ...overrides });
        expect(isScanStateMessage(wrap(error({ pageKey: undefined })))).toBe(false);
        expect(isScanStateMessage(wrap(error({ error: "x" })))).toBe(false);
        expect(isScanStateMessage(wrap(error({ error: { message: "x", stack: 1 } })))).toBe(false);
        expect(isScanStateMessage(wrap(error({ error: { message: "x", where: {} } })))).toBe(false);
        expect(isScanStateMessage(wrap(error({ error: { message: "x", stack: "s", where: "w" } })))).toBe(true);
        expect(isScanStateMessage(wrap(error({ entries: [entry] })))).toBe(true);
        expect(isScanStateMessage(wrap(error({ entries: [null] })))).toBe(false);
        expect(isScanStateMessage(wrap(error({ entries: [{ ...entry, level: "info" }] })))).toBe(false);
        expect(isScanStateMessage(wrap(error({ entries: [{ ...entry, t: NaN }] })))).toBe(false);
        expect(isScanStateMessage(wrap(error({ entries: [{ ...entry, msg: 1 }] })))).toBe(false);
        expect(isScanStateMessage(wrap(error({ entries: [{ t: 1, level: "log", msg: "m" }] })))).toBe(false);
        expect(isScanStateMessage(wrap(error({ pageUrl: 5 })))).toBe(false);
    });
});

describe("sheet fetch requests", () => {
    it("accepts a spreadsheet id and numeric gid", () => {
        expect(isSheetFetchRequest({type: "FLORA_SHEET_FETCH", spreadsheetId: "1AbC_d-9", gid: "42"})).toBe(true);
    });

    it("rejects ids that could reshape the export URL", () => {
        expect(isSheetFetchRequest({type: "FLORA_SHEET_FETCH", spreadsheetId: "x/../../document/d/y", gid: "0"})).toBe(false);
        expect(isSheetFetchRequest({type: "FLORA_SHEET_FETCH", spreadsheetId: "book", gid: "0&tqx=out:html"})).toBe(false);
    });
});
