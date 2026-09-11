import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {
    onDebugChange,
    setDebug,
    isDebugEnabled,
    isDebugEnabledAsync,
    _resetDebugForTesting,
} from "../../src/shared/debug";

describe("debug-state changes reach their listeners", () => {
    beforeEach(() => {
        _resetDebugForTesting();
        setDebug(false);
        _resetDebugForTesting();
    });

    afterEach(() => {
        setDebug(false);
        _resetDebugForTesting();
        vi.restoreAllMocks();
    });

    it("notifies when a storage read turns debug on", async () => {
        const seen: boolean[] = [];
        onDebugChange((enabled) => seen.push(enabled));
        (chrome.storage.local.get as ReturnType<typeof vi.fn>)
            .mockResolvedValue({flora_debug: true});

        await isDebugEnabledAsync();

        expect(isDebugEnabled()).toBe(true);
        expect(seen, "a read that flips the flag must notify too").toEqual([true]);
    });

    it("stays quiet when a read confirms the state it already had", async () => {
        setDebug(true);
        const seen: boolean[] = [];
        onDebugChange((enabled) => seen.push(enabled));
        (chrome.storage.local.get as ReturnType<typeof vi.fn>)
            .mockResolvedValue({flora_debug: true});

        await isDebugEnabledAsync();

        expect(seen).toEqual([]);
    });

    it("notifies on an explicit toggle, once per real change", () => {
        const seen: boolean[] = [];
        onDebugChange((enabled) => seen.push(enabled));

        setDebug(true);
        setDebug(true);
        setDebug(false);

        expect(seen).toEqual([true, false]);
    });
});
