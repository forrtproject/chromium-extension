import { describe, it, expect } from "vitest";
import {
    isLookupRequest,
    isRetractionCheckRequest,
    isAugmentRequest,
    isPmcResolveRequest,
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
});
