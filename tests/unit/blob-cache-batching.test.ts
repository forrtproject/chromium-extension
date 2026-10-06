import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BlobCache} from "../../src/shared/blob-cache";

const KEY = "flora_test_blob";
const TTL = 60_000;
const WRITE_ID_KEY = "__writeId";

type Listener = (changes: Record<string, {newValue?: unknown}>, area: string) => void;
type Blob = Record<string, unknown>;

interface PendingOp {
    apply: () => void;
    resolve: () => void;
    reject: (err: Error) => void;
}

function copy<V>(value: V): V {
    return JSON.parse(JSON.stringify(value)) as V;
}

async function drain(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function elapseFlushWindow(): Promise<void> {
    await drain();
    await vi.advanceTimersByTimeAsync(10);
    await drain();
}

function track(promise: Promise<unknown>): {settled: boolean} {
    const state = {settled: false};
    promise.then(() => { state.settled = true; });
    return state;
}

function fakeStorage() {
    let stored: Blob | undefined;
    const pendingOps: PendingOp[] = [];
    const events: Array<{newValue: unknown}> = [];
    const writes: Blob[] = [];

    function enqueue(apply: () => void): Promise<void> {
        return new Promise<void>((resolve, reject) => pendingOps.push({apply, resolve, reject}));
    }
    function removeStored(): void {
        if (stored === undefined) return;
        stored = undefined;
        events.push({newValue: undefined});
    }

    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation(
        async () => (stored === undefined ? {} : {[KEY]: copy(stored)})
    );
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockImplementation(
        (items: Record<string, Blob>) => {
            const value = copy(items[KEY]);
            writes.push(value);
            return enqueue(() => {
                stored = value;
                events.push({newValue: value});
            });
        }
    );
    (chrome.storage.local.remove as ReturnType<typeof vi.fn>).mockImplementation(
        () => enqueue(removeStored)
    );

    return {
        writes,
        get pendingOps() {
            return pendingOps.length;
        },
        get pendingEvents() {
            return events.length;
        },
        async commit(): Promise<void> {
            const op = pendingOps.shift()!;
            op.apply();
            op.resolve();
            await drain();
        },
        async fail(): Promise<void> {
            pendingOps.shift()!.reject(new Error("QUOTA_BYTES quota exceeded"));
            await drain();
        },
        deliver(): void {
            const {newValue} = events.shift()!;
            const listeners = (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mock.calls
                .map((call) => call[0] as Listener);
            for (const listener of listeners) listener({[KEY]: {newValue}}, "local");
        },
        async deliverAll(): Promise<void> {
            while (events.length > 0) this.deliver();
            await drain();
        },
        seed(blob: Blob): void {
            stored = copy(blob);
        },
        foreignWrite(blob: Blob): void {
            stored = copy(blob);
            events.push({newValue: copy(blob)});
        },
        evict: removeStored,
        storedKeys(): string[] {
            return Object.keys(stored ?? {}).filter((key) => key !== WRITE_ID_KEY).sort();
        },
        stored(): Blob | undefined {
            return stored;
        },
    };
}

describe("BlobCache write batching", () => {
    let storage: ReturnType<typeof fakeStorage>;

    beforeEach(() => {
        vi.useFakeTimers();
        (chrome.storage.onChanged.addListener as ReturnType<typeof vi.fn>).mockClear();
        storage = fakeStorage();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function newCache(maxEntries?: number): BlobCache<string> {
        return new BlobCache<string>({storageKey: KEY, ttlMs: TTL, maxEntries});
    }

    async function persist(cache: BlobCache<string>, key: string): Promise<void> {
        const done = cache.set(key, key);
        await elapseFlushWindow();
        await storage.commit();
        await done;
    }

    it("coalesces 1,000 concurrent set() calls into one storage write", async () => {
        const cache = newCache();
        const all = Promise.all(Array.from({length: 1000}, (_, i) => cache.set(`k${i}`, "v")));
        await elapseFlushWindow();
        await storage.commit();
        await all;

        expect(storage.writes).toHaveLength(1);
        expect(storage.storedKeys()).toHaveLength(1000);
    });

    it("writes each batch of concurrent completions once", async () => {
        const cache = newCache();
        for (let batch = 0; batch < 20; batch++) {
            const done = Promise.all(Array.from({length: 4}, (_, i) => cache.set(`b${batch}-${i}`, "v")));
            await elapseFlushWindow();
            await storage.commit();
            await done;
            await vi.advanceTimersByTimeAsync(15);
        }

        expect(storage.writes).toHaveLength(20);
        expect(storage.storedKeys()).toHaveLength(80);
    });

    it("shares one write between set() and setMany() in the same window", async () => {
        const cache = newCache();
        const done = Promise.all([cache.set("a", "1"), cache.setMany([["b", "2"], ["c", "3"]])]);
        await elapseFlushWindow();
        await storage.commit();
        await done;

        expect(storage.writes).toHaveLength(1);
        expect(storage.storedKeys()).toEqual(["a", "b", "c"]);
    });

    it("resolves an awaited set() only after its storage write settles", async () => {
        const cache = newCache();
        const done = track(cache.set("a", "1"));
        await elapseFlushWindow();

        expect(storage.pendingOps).toBe(1);
        expect(done.settled).toBe(false);

        await storage.commit();
        expect(done.settled).toBe(true);
    });

    it("resolves an awaited setMany() only after its storage write settles", async () => {
        const cache = newCache();
        const done = track(cache.setMany([["a", "1"], ["b", "2"]]));
        await elapseFlushWindow();
        expect(done.settled).toBe(false);

        await storage.commit();
        expect(done.settled).toBe(true);
    });

    it("tags each stored blob with a write id that reads and trims ignore", async () => {
        storage.seed({[WRITE_ID_KEY]: "other-context:7", old: {v: "o", t: Date.now()}});
        const cache = newCache(1);
        expect(await cache.getMany(["old", WRITE_ID_KEY])).toEqual(new Map([["old", "o"]]));

        vi.advanceTimersByTime(1);
        await persist(cache, "new");

        expect(storage.storedKeys()).toEqual(["new"]);
        expect(typeof storage.stored()![WRITE_ID_KEY]).toBe("string");
        expect(storage.stored()![WRITE_ID_KEY]).not.toBe("other-context:7");
    });

    it("keeps a later completion when an earlier write's change event arrives late", async () => {
        const cache = newCache();
        await persist(cache, "first");
        await persist(cache, "second");

        storage.deliver();
        await persist(cache, "third");
        await storage.deliverAll();

        expect(storage.storedKeys()).toEqual(["first", "second", "third"]);
        expect(await cache.get("second")).toBe("second");
    });

    it("adopts a blob another instance wrote even though it uses the same sequence numbers", async () => {
        const writer = newCache();
        const reader = newCache();
        expect(await reader.get("a")).toBeUndefined();

        await persist(writer, "a");
        await storage.deliverAll();

        expect(await reader.get("a")).toBe("a");
    });

    it("keeps queued completions when another context's blob arrives", async () => {
        const cache = newCache();
        await persist(cache, "mine");
        await storage.deliverAll();

        const done = cache.set("queued", "q");
        await drain();
        storage.foreignWrite({theirs: {v: "t", t: Date.now()}});
        await storage.deliverAll();
        await elapseFlushWindow();
        await storage.commit();
        await done;

        expect(await cache.get("queued")).toBe("q");
        expect(await cache.get("theirs")).toBe("t");
        expect(await cache.get("mine")).toBeUndefined();
        expect(storage.storedKeys()).toEqual(["queued", "theirs"]);
    });

    describe("clear()", () => {
        it("is not undone by the delayed change event of an earlier write", async () => {
            const cache = newCache();
            await persist(cache, "old");

            const cleared = cache.clear();
            await storage.commit();
            await cleared;
            await storage.deliverAll();

            expect(await cache.get("old")).toBeUndefined();
            expect(storage.stored()).toBeUndefined();
        });

        it("cancels writes queued before it and resolves their callers without writing", async () => {
            const cache = newCache();
            await persist(cache, "old");
            const queued = track(cache.set("queued", "q"));
            await drain();

            const cleared = cache.clear();
            await storage.commit();
            await cleared;
            await elapseFlushWindow();

            expect(queued.settled).toBe(true);
            expect(storage.writes).toHaveLength(1);
            expect(storage.pendingOps).toBe(0);
            expect(await cache.get("queued")).toBeUndefined();
        });

        it("cannot be undone by a write issued before it", async () => {
            const cache = newCache();
            const inFlight = track(cache.set("old", "o"));
            await elapseFlushWindow();

            const cleared = cache.clear();
            await storage.commit();
            await storage.commit();
            await cleared;
            await storage.deliverAll();

            expect(inFlight.settled).toBe(true);
            expect(storage.stored()).toBeUndefined();
            expect(await cache.get("old")).toBeUndefined();
        });

        it("keeps a completion written before its removal event arrives", async () => {
            const cache = newCache();
            await persist(cache, "old");

            const cleared = cache.clear();
            await storage.commit();
            await cleared;
            await persist(cache, "fresh");
            await storage.deliverAll();
            await elapseFlushWindow();

            expect(await cache.get("fresh")).toBe("fresh");
            expect(await cache.get("old")).toBeUndefined();
            expect(storage.storedKeys()).toEqual(["fresh"]);
            expect(storage.pendingOps).toBe(0);
        });

        it("keeps a completion still queued when its removal event arrives", async () => {
            const cache = newCache();
            await persist(cache, "old");

            const cleared = cache.clear();
            await storage.commit();
            await cleared;
            const done = cache.set("fresh", "f");
            await drain();
            await storage.deliverAll();
            await elapseFlushWindow();
            await storage.commit();
            await done;
            await storage.deliverAll();

            expect(await cache.get("fresh")).toBe("f");
            expect(storage.storedKeys()).toEqual(["fresh"]);
        });
    });

    describe("shared-budget eviction", () => {
        it("drops entries the eviction removed", async () => {
            const cache = newCache();
            await persist(cache, "old");
            await storage.deliverAll();

            storage.evict();
            await storage.deliverAll();

            expect(await cache.get("old")).toBeUndefined();
        });

        it("rewrites the blob when a write issued before the eviction resurrected old entries", async () => {
            const cache = newCache();
            await persist(cache, "old");
            await storage.deliverAll();

            const done = cache.set("fresh", "f");
            await elapseFlushWindow();
            storage.evict();
            await storage.commit();
            await done;
            expect(storage.storedKeys()).toEqual(["fresh", "old"]);

            await storage.deliverAll();
            await elapseFlushWindow();
            await storage.commit();
            await storage.deliverAll();

            expect(storage.storedKeys()).toEqual(["fresh"]);
            expect(await cache.get("old")).toBeUndefined();
            expect(await cache.get("fresh")).toBe("f");
        });

        it("still caches a completion queued when the eviction is observed", async () => {
            const cache = newCache();
            await persist(cache, "old");
            await storage.deliverAll();

            const done = cache.setMany([["fresh", "f"]]);
            await drain();
            storage.evict();
            await storage.deliverAll();
            await elapseFlushWindow();
            await storage.commit();
            await done;

            expect(storage.storedKeys()).toEqual(["fresh"]);
            expect(await cache.get("old")).toBeUndefined();
        });

        it("caches a completion made after the eviction was observed", async () => {
            const cache = newCache();
            await persist(cache, "old");
            await storage.deliverAll();
            storage.evict();
            await storage.deliverAll();

            await persist(cache, "fresh");
            await storage.deliverAll();

            expect(storage.storedKeys()).toEqual(["fresh"]);
            expect(await cache.get("fresh")).toBe("fresh");
        });
    });

    describe("quota recovery", () => {
        it("retries a batched setMany() once after evicting the oldest half", async () => {
            const cache = newCache();
            const first = cache.setMany([["a", "1"], ["b", "2"]]);
            await elapseFlushWindow();
            await storage.commit();
            await first;
            vi.advanceTimersByTime(1_000);

            const second = track(cache.setMany([["c", "3"], ["d", "4"]]));
            await elapseFlushWindow();
            await storage.fail();
            expect(second.settled).toBe(false);
            await storage.commit();

            expect(second.settled).toBe(true);
            expect(storage.writes).toHaveLength(3);
            expect(storage.storedKeys()).toEqual(["c", "d"]);
        });

        it("resolves concurrent set() callers without throwing when the retry fails too", async () => {
            const cache = newCache();
            const done = Promise.all([cache.set("a", "1"), cache.set("b", "2")]);
            await elapseFlushWindow();
            await storage.fail();
            await storage.fail();

            await expect(done).resolves.toEqual([undefined, undefined]);
            expect(storage.writes).toHaveLength(2);
            expect(storage.stored()).toBeUndefined();
        });

        it("drops memory-only entries of a failed write once a removal is observed", async () => {
            const cache = newCache();
            await persist(cache, "old");
            await storage.deliverAll();

            const done = cache.set("lost", "l");
            await elapseFlushWindow();
            await storage.fail();
            await storage.fail();
            await done;
            storage.evict();
            await storage.deliverAll();
            await elapseFlushWindow();

            expect(await cache.get("lost")).toBeUndefined();
            expect(storage.pendingOps).toBe(0);
        });
    });
});
