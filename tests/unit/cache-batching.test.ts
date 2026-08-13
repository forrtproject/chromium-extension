import { describe, it, expect, beforeEach, vi } from "vitest";
import { LocalCache } from "../../src/shared/cache";

describe("LocalCache batching", () => {
    let store: Record<string, unknown>;
    let getCalls: number;
    let setCalls: number;
    let bytesInUseCalls: number;

    beforeEach(() => {
        store = {};
        getCalls = 0;
        setCalls = 0;
        bytesInUseCalls = 0;

        (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation(
            async (keys: string | string[] | null) => {
                getCalls++;
                if (keys === null) return { ...store };
                const list = Array.isArray(keys) ? keys : [keys];
                const out: Record<string, unknown> = {};
                for (const k of list) if (k in store) out[k] = store[k];
                return out;
            }
        );
        (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockImplementation(
            async (items: Record<string, unknown>) => {
                setCalls++;
                Object.assign(store, items);
            }
        );
        (chrome.storage.local.remove as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        (chrome.storage.local as unknown as Record<string, unknown>).getBytesInUse =
            vi.fn(async () => { bytesInUseCalls++; return 0; });
    });

    it("reads many keys in one storage round-trip", async () => {
        const cache = new LocalCache<string>("flora");
        await cache.setMany([["a", "1"], ["b", "2"], ["c", "3"]], 60_000);
        getCalls = 0;

        const found = await cache.getMany(["a", "b", "c"]);

        expect(getCalls).toBe(1);
        expect(found.get("a")).toBe("1");
        expect(found.get("c")).toBe("3");
    });

    it("writes many entries in one storage round-trip", async () => {
        const cache = new LocalCache<string>("flora");

        await cache.setMany([["a", "1"], ["b", "2"], ["c", "3"]], 60_000);

        expect(setCalls).toBe(1);
    });

    it("omits expired entries from a batch read", async () => {
        const cache = new LocalCache<string>("flora");
        await cache.setMany([["fresh", "1"]], 60_000);
        await cache.setMany([["stale", "2"]], -1);

        const found = await cache.getMany(["fresh", "stale"]);

        expect(found.has("fresh")).toBe(true);
        expect(found.has("stale")).toBe(false);
    });

    it("does not scan the whole of storage on every write", async () => {
        const cache = new LocalCache<string>("flora");
        cache.setQuota(1024 * 1024);

        await cache.setMany([["a", "1"]], 60_000);
        await cache.setMany([["b", "2"]], 60_000);
        await cache.setMany([["c", "3"]], 60_000);

        expect(bytesInUseCalls).toBe(1);
    });
});
