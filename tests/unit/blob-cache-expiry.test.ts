import {beforeEach, describe, expect, it, vi} from "vitest";
import {BlobCache} from "../../src/shared/blob-cache";

const KEY = "flora_test_blob";
const TTL = 60_000;

describe("BlobCache expiry sweeping", () => {
    let store: Record<string, any>;

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
    });

    function storedKeys(): string[] {
        return Object.keys((store[KEY] ?? {}) as object);
    }

    it("drops expired entries on load even though nobody queries them", async () => {
        const now = Date.now();
        store[KEY] = {
            stale: {v: "old", t: now - TTL - 1},
            fresh: {v: "new", t: now},
        };
        const cache = new BlobCache<string>({storageKey: KEY, ttlMs: TTL});

        expect(await cache.get("fresh")).toBe("new");
        await vi.waitFor(() => expect(storedKeys()).toEqual(["fresh"]));
    });

    it("writes the pruned blob back when only reads happen", async () => {
        const now = Date.now();
        store[KEY] = {stale: {v: "old", t: now - TTL - 1}};
        const cache = new BlobCache<string>({storageKey: KEY, ttlMs: TTL});

        expect(await cache.get("missing")).toBeUndefined();
        await vi.waitFor(() => expect(storedKeys()).toEqual([]));
    });

    it("prunes expired entries of other keys on write", async () => {
        const now = Date.now();
        store[KEY] = {stale: {v: "old", t: now - TTL - 1}};
        const cache = new BlobCache<string>({storageKey: KEY, ttlMs: TTL});
        await cache.set("beta", "fresh");

        expect(storedKeys()).toEqual(["beta"]);
    });

    it("keeps unexpired entries", async () => {
        const now = Date.now();
        store[KEY] = {alpha: {v: "still good", t: now - TTL + 5_000}};
        const cache = new BlobCache<string>({storageKey: KEY, ttlMs: TTL});
        await cache.set("beta", "fresh");

        expect(storedKeys().sort()).toEqual(["alpha", "beta"]);
        expect(await cache.get("alpha")).toBe("still good");
    });

    it("trims the oldest entries once the cap is exceeded", async () => {
        const now = Date.now();
        store[KEY] = {
            oldest: {v: "1", t: now - 3_000},
            middle: {v: "2", t: now - 2_000},
            newest: {v: "3", t: now - 1_000},
        };
        const cache = new BlobCache<string>({storageKey: KEY, ttlMs: TTL, maxEntries: 3});
        await cache.set("added", "4");

        expect(storedKeys().sort()).toEqual(["added", "middle", "newest"]);
        expect(await cache.get("oldest")).toBeUndefined();
    });

    it("does not trim while under the cap", async () => {
        const cache = new BlobCache<string>({storageKey: KEY, ttlMs: TTL, maxEntries: 3});
        await cache.setMany([["a", "1"], ["b", "2"]]);

        expect(storedKeys().sort()).toEqual(["a", "b"]);
    });
});
