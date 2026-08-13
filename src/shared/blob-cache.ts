// Single chrome.storage.local key holding a JSON object of all entries.
// Cross-context concurrent writes are last-writer-wins on the whole blob —
// acceptable for a cache (lost write = re-fetch).

import {debugLog, debugWarn} from "./debug";

interface CacheEntry<T> {
    v: T;
    t: number;
}

type CacheBlob<T> = Record<string, CacheEntry<T>>;

const DEFAULT_MAX_ENTRIES = 5000;

export interface BlobCacheOptions {
    storageKey: string;
    ttlMs: number;
    maxEntries?: number;
    /** One-shot cleanup of legacy per-row keys from the pre-blob cache shape. */
    legacyPrefixes?: string[];
}

export class BlobCache<T> {
    private mem: CacheBlob<T> | null = null;
    private loading: Promise<void> | null = null;
    // Bumped whenever the blob changes underneath us, so a read that started
    // before the change doesn't install what it found afterwards.
    private generation = 0;
    private listenerInstalled = false;

    constructor(private readonly opts: BlobCacheOptions) {}

    /**
     * Without this, clearing the cache does nothing while a context is alive:
     * reads keep serving the in-memory copy, and the next write flushes it
     * straight back into storage.
     */
    private installInvalidation(): void {
        if (this.listenerInstalled) return;
        this.listenerInstalled = true;
        try {
            chrome.storage.onChanged?.addListener((changes, area) => {
                if (area !== "local" || !(this.opts.storageKey in changes)) return;
                const next = changes[this.opts.storageKey].newValue as CacheBlob<T> | undefined;
                this.generation++;
                this.loading = null;
                this.mem = next && typeof next === "object" ? next : null;
                if (!this.mem) {
                    debugLog(`Cache ${this.opts.storageKey}: cleared elsewhere, dropping in-memory copy`);
                }
            });
        } catch {
            // Storage change events are unavailable in tests and some contexts.
        }
    }

    private async ensureLoaded(): Promise<void> {
        this.installInvalidation();
        if (this.mem) return;
        if (!this.loading) {
            this.loading = this.load();
        }
        await this.loading;
        this.mem ??= {};
    }

    private async load(): Promise<void> {
        const generation = this.generation;
        let blob: CacheBlob<T> = {};
        try {
            const raw = await chrome.storage.local.get(this.opts.storageKey);
            const stored = raw[this.opts.storageKey] as CacheBlob<T> | undefined;
            blob = stored && typeof stored === "object" ? stored : {};
        } catch (err) {
            debugWarn(`Cache ${this.opts.storageKey}: load failed, starting empty —`, err);
        }
        const dropped = this.sweepExpired(blob);
        // A change landed mid-read; the listener's copy is the newer truth.
        if (generation === this.generation) {
            this.mem = blob;
            if (dropped > 0) {
                debugLog(`Cache ${this.opts.storageKey}: dropped ${dropped} expired entr(ies) on load`);
                void this.flush();
            }
        }
        if (this.opts.legacyPrefixes && this.opts.legacyPrefixes.length > 0) {
            void this.sweepLegacy(this.opts.legacyPrefixes);
        }
    }

    private async sweepLegacy(prefixes: string[]): Promise<void> {
        try {
            const all = await chrome.storage.local.get(null);
            const stale = Object.keys(all).filter((k) =>
                prefixes.some((p) => k.startsWith(p))
            );
            if (stale.length > 0) {
                await chrome.storage.local.remove(stale);
            }
        } catch (err) {
            debugWarn(`Cache ${this.opts.storageKey}: legacy sweep failed —`, err);
        }
    }

    async get(key: string): Promise<T | undefined> {
        await this.ensureLoaded();
        const entry = this.mem![key];
        if (!entry) return undefined;
        if (Date.now() - entry.t > this.opts.ttlMs) {
            delete this.mem![key];
            void this.flush();
            return undefined;
        }
        return entry.v;
    }

    async getMany(keys: string[]): Promise<Map<string, T>> {
        await this.ensureLoaded();
        const out = new Map<string, T>();
        const now = Date.now();
        let mutated = false;
        for (const key of keys) {
            const entry = this.mem![key];
            if (!entry) continue;
            if (now - entry.t > this.opts.ttlMs) {
                delete this.mem![key];
                mutated = true;
                continue;
            }
            out.set(key, entry.v);
        }
        if (mutated) void this.flush();
        return out;
    }

    async set(key: string, value: T): Promise<void> {
        await this.ensureLoaded();
        this.mem![key] = {v: value, t: Date.now()};
        await this.flush();
    }

    async setMany(entries: Iterable<[string, T]>): Promise<void> {
        await this.ensureLoaded();
        const now = Date.now();
        for (const [key, value] of entries) {
            this.mem![key] = {v: value, t: now};
        }
        await this.flush();
    }

    private sweepExpired(blob: CacheBlob<T>): number {
        const now = Date.now();
        let dropped = 0;
        for (const key of Object.keys(blob)) {
            if (now - blob[key].t > this.opts.ttlMs) {
                delete blob[key];
                dropped++;
            }
        }
        return dropped;
    }

    private trimToMaxEntries(blob: CacheBlob<T>): number {
        const max = this.opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
        const keys = Object.keys(blob);
        if (keys.length <= max) return 0;
        keys.sort((a, b) => blob[a].t - blob[b].t);
        const dropCount = keys.length - max;
        for (let i = 0; i < dropCount; i++) delete blob[keys[i]];
        return dropCount;
    }

    private async flush(): Promise<void> {
        if (!this.mem) return;
        this.sweepExpired(this.mem);
        const trimmed = this.trimToMaxEntries(this.mem);
        if (trimmed > 0) {
            debugLog(`Cache ${this.opts.storageKey}: trimmed ${trimmed} oldest entr(ies) over the cap`);
        }
        try {
            await chrome.storage.local.set({[this.opts.storageKey]: this.mem});
        } catch {
            // Likely storage quota. Attempt one recovery: evict the oldest half
            // of this blob's entries (by timestamp) and retry the write once.
            this.evictOldestHalf();
            try {
                await chrome.storage.local.set({[this.opts.storageKey]: this.mem});
            } catch {
                debugLog(
                    `BlobCache(${this.opts.storageKey}): write failed after evicting oldest half; keeping in-memory copy only`
                );
            }
        }
    }

    private evictOldestHalf(): void {
        if (!this.mem) return;
        const keys = Object.keys(this.mem);
        if (keys.length <= 1) return;
        keys.sort((a, b) => this.mem![a].t - this.mem![b].t);
        const dropCount = Math.floor(keys.length / 2);
        for (let i = 0; i < dropCount; i++) {
            delete this.mem[keys[i]];
        }
    }

    /** Drop every entry, in memory and in storage. */
    async clear(): Promise<void> {
        this.mem = {};
        this.generation++;
        try {
            await chrome.storage.local.remove(this.opts.storageKey);
        } catch (err) {
            debugWarn(`Cache ${this.opts.storageKey}: clear failed —`, err);
        }
    }

    resetForTesting(): void {
        this.mem = null;
        this.loading = null;
        this.generation++;
        this.listenerInstalled = false;
    }
}
