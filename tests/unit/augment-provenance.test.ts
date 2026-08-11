import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

describe("augment provenance in the page console", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        vi.resetModules();
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const {setDebug, _resetDebugForTesting} = await import("../../src/shared/debug");
        _resetDebugForTesting();
        setDebug(true);
    });

    afterEach(async () => {
        logSpy.mockRestore();
        const {_resetDebugForTesting} = await import("../../src/shared/debug");
        _resetDebugForTesting();
    });

    function lines(): string {
        return logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    }

    it.each([
        ["crossref", "via CROSSREF"],
        ["openalex", "via OPENALEX"],
        ["both", "via BOTH"],
        ["cache", "via CACHE"],
    ])("names %s as the resolving platform", async (source, expected) => {
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
            type: "FLORA_AUGMENT_RESULT",
            results: {"A test title": "10.1234/abc"},
            sources: {"A test title": source},
        });

        const {augmentDOIsViaWorker} = await import("../../src/shared/messages");
        const result = await augmentDOIsViaWorker(["A test title"]);

        expect(result.get("A test title")).toBe("10.1234/abc");
        expect(lines()).toContain(`Augment: "A test title" → 10.1234/abc ${expected}`);
    });

    it("still logs when nothing resolved", async () => {
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
            type: "FLORA_AUGMENT_RESULT",
            results: {"A test title": null},
            sources: {"A test title": null},
        });

        const {augmentDOIsViaWorker} = await import("../../src/shared/messages");
        await augmentDOIsViaWorker(["A test title"]);

        expect(lines()).toContain(`Augment: "A test title" → no match`);
    });
});
