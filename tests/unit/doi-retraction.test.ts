import {describe, it, expect, vi, beforeEach} from "vitest";
import {doi} from "../helpers";

// retractionCheck now runs in the content scripts purely as a thin client: it
// asks the background service worker (which owns the data) for a verdict. These
// tests pin that message contract; the lookup logic itself is covered by the
// service-worker tests.
describe("doi retraction content helper", () => {
    beforeEach(() => {
        vi.resetModules();
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockReset();
    });

    it("requests retraction checks from the background service worker", async () => {
        const originalDoi = doi("10.1038/nature12373");
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
            type: "FLORA_RET_CHECK_RESULT",
            results: [{originDoi: originalDoi, doi: "10.1038/retraction", kind: "retraction"}],
        });

        const {retractionCheck} = await import("../../src/shared/doi-retraction");
        const result = await retractionCheck([originalDoi]);

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            type: "FLORA_RET_CHECK",
            dois: [originalDoi],
        });
        expect(result).toEqual([
            {originDoi: originalDoi, doi: "10.1038/retraction", kind: "retraction"},
        ]);
    });

    it("passes expression-of-concern verdicts through unchanged", async () => {
        const originalDoi = doi("10.5678/eoc-paper");
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
            type: "FLORA_RET_CHECK_RESULT",
            results: [{originDoi: originalDoi, doi: "10.5678/eoc-notice", kind: "concern"}],
        });

        const {retractionCheck} = await import("../../src/shared/doi-retraction");
        await expect(retractionCheck([originalDoi])).resolves.toEqual([
            {originDoi: originalDoi, doi: "10.5678/eoc-notice", kind: "concern"},
        ]);
    });

    it("coalesces same-tick checks into one message", async () => {
        const retracted = doi("10.1038/nature12373");
        const clean = doi("10.1234/fine");
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
            type: "FLORA_RET_CHECK_RESULT",
            results: [{originDoi: retracted, doi: "10.1038/retraction", kind: "retraction"}],
        });

        const {retractionCheck} = await import("../../src/shared/doi-retraction");
        const [first, second] = await Promise.all([
            retractionCheck([retracted]),
            retractionCheck([clean]),
        ]);

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            type: "FLORA_RET_CHECK",
            dois: [retracted, clean],
        });
        // Each caller gets only what it asked about.
        expect(first).toEqual([{originDoi: retracted, doi: "10.1038/retraction", kind: "retraction"}]);
        expect(second).toEqual([]);
    });

    it("returns no retractions for unexpected responses", async () => {
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
            type: "FLORA_LOOKUP_RESULT",
            results: {},
            errors: {},
        });

        const {retractionCheck} = await import("../../src/shared/doi-retraction");
        await expect(retractionCheck([doi("10.1038/nature12373")])).resolves.toEqual([]);
    });
});
