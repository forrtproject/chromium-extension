import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {
    onDebugChange,
    setDebug,
    isDebugEnabled,
    isDebugEnabledAsync,
    _resetDebugForTesting,
} from "../../src/shared/debug";

describe("debug-state changes reach their listeners", () => {
    const disposers: Array<() => void> = [];
    let fired = 0;

    function listen(): boolean[] {
        const seen: boolean[] = [];
        disposers.push(onDebugChange((enabled) => {
            fired++;
            seen.push(enabled);
        }));
        return seen;
    }

    beforeEach(() => {
        _resetDebugForTesting();
        setDebug(false);
        _resetDebugForTesting();
    });

    afterEach(() => {
        for (const dispose of disposers.splice(0)) dispose();
        setDebug(false);
        _resetDebugForTesting();
        vi.restoreAllMocks();
    });

    it("notifies when a storage read turns debug on", async () => {
        const seen = listen();
        (chrome.storage.local.get as ReturnType<typeof vi.fn>)
            .mockResolvedValue({flora_debug: true});

        await isDebugEnabledAsync();

        expect(isDebugEnabled()).toBe(true);
        expect(seen, "a read that flips the flag must notify too").toEqual([true]);
    });

    it("stays quiet when a read confirms the state it already had", async () => {
        setDebug(true);
        const seen = listen();
        (chrome.storage.local.get as ReturnType<typeof vi.fn>)
            .mockResolvedValue({flora_debug: true});

        await isDebugEnabledAsync();

        expect(seen).toEqual([]);
    });

    it("stops notifying a listener that has been disposed", () => {
        const seen: boolean[] = [];
        const dispose = onDebugChange((enabled) => seen.push(enabled));

        setDebug(true);
        dispose();
        setDebug(false);

        expect(seen, "a disposed listener must hear nothing further").toEqual([true]);
    });

    it("does not leak a listener into the next test", () => {
        const seen = listen();
        fired = 0;

        setDebug(true);

        expect(fired, "a listener from an earlier test is still registered").toBe(1);
        expect(seen).toEqual([true]);
    });

    it("notifies on an explicit toggle, once per real change", () => {
        const seen = listen();

        setDebug(true);
        setDebug(true);
        setDebug(false);

        expect(seen).toEqual([true, false]);
    });
});
