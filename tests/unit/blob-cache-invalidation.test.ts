import {beforeEach, describe, expect, it, vi} from "vitest";
import {BlobCache} from "../../src/shared/blob-cache";

const KEY = "flora_test_blob";

type Listener = (changes: Record<string, {newValue?: unknown}>, area: string) => void;

function storageListeners(): Listener[] {
    return (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[0] as Listener
    );
}

/** Simulate a write landing in chrome.storage from anywhere. */
function announce(newValue: unknown): void {
    for (const listener of storageListeners()) listener({[KEY]: {newValue}}, "local");
}

describe("BlobCache invalidation", () => {
    let store: Record<string, unknown>;

    beforeEach(() => {
        store = {};
        (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation(
            async (k: string) => (k in store ? {[k]: store[k]} : {})
        );
        (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockImplementation(
            async (items: Record<string, unknown>) => Object.assign(store, items)
        );
        (chrome.storage.local.remove as ReturnType<typeof vi.fn>).mockImplementation(
            async (k: string) => { delete store[k]; }
        );
        (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mockClear();
    });

    it("stops serving entries once the blob is cleared elsewhere", async () => {
        store[KEY] = {alpha: {v: "cached", t: Date.now()}};
        const cache = new BlobCache<string>({storageKey: KEY, ttlMs: 60_000});

        expect(await cache.get("alpha")).toBe("cached");

        delete store[KEY];
        announce(undefined);

        expect(await cache.get("alpha")).toBeUndefined();
    });

    it("does not write a cleared entry back on the next save", async () => {
        store[KEY] = {alpha: {v: "cached", t: Date.now()}};
        const cache = new BlobCache<string>({storageKey: KEY, ttlMs: 60_000});
        await cache.get("alpha");

        delete store[KEY];
        announce(undefined);
        await cache.set("beta", "fresh");

        expect(Object.keys(store[KEY] as object)).toEqual(["beta"]);
    });

    it("picks up a blob another context wrote", async () => {
        const cache = new BlobCache<string>({storageKey: KEY, ttlMs: 60_000});
        expect(await cache.get("alpha")).toBeUndefined();

        announce({alpha: {v: "from another context", t: Date.now()}});

        expect(await cache.get("alpha")).toBe("from another context");
    });

    it("clear() empties memory and storage together", async () => {
        store[KEY] = {alpha: {v: "cached", t: Date.now()}};
        const cache = new BlobCache<string>({storageKey: KEY, ttlMs: 60_000});
        await cache.get("alpha");

        await cache.clear();

        expect(store[KEY]).toBeUndefined();
        expect(await cache.get("alpha")).toBeUndefined();
    });
});
