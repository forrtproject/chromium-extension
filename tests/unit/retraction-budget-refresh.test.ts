import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {RET_MAP_KEY} from "../../src/shared/data-extract";

vi.mock("../../src/shared/settings", async importOriginal => ({
    ...await importOriginal<typeof import("../../src/shared/settings")>(),
    isSetupComplete: async () => true,
    getSettings: async () => ({cacheQuotaMb: 0}),
}));

const WEEK = 7 * 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const map = {retractions: {"10.1000/paper": "10.1000/notice"}, concerns: {}};
let store: Record<string, unknown>;
let remoteRequests: number;
let failDownloads: boolean;

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    store = {};
    remoteRequests = 0;
    failDownloads = false;
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    chrome.storage.local.get = vi.fn(async keys => {
        const wanted = keys === null ? Object.keys(store) : Array.isArray(keys) ? keys :
            typeof keys === "string" ? [keys] : Object.keys(keys ?? {});
        return structuredClone(Object.fromEntries(wanted.filter(key => key in store).map(key => [key, store[key]])));
    });
    chrome.storage.local.set = vi.fn(async items => {Object.assign(store, structuredClone(items));});
    chrome.storage.local.remove = vi.fn(async keys => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    });
    chrome.storage.local.getBytesInUse = vi.fn(async keys =>
        (keys === null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys])
            .reduce((sum, key) => sum + (key in store ? new TextEncoder().encode(key + JSON.stringify(store[key])).length : 0), 0));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (url.startsWith("https://raw.githubusercontent.com/")) {
            remoteRequests++;
            if (failDownloads) throw new Error("network down");
        }
        return new Response(JSON.stringify(map));
    }));
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

async function checkRetraction(): Promise<unknown> {
    const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
    return new Promise(resolve => listener({type: "FLORA_RET_CHECK", dois: ["10.1000/paper"]}, {}, resolve));
}

describe("retraction map and the cache budget", () => {
    it("keeps the map through an over-budget sweep and refreshes on the weekly schedule", async () => {
        const {syncRetractionsInfo} = await import("../../src/background/service-worker");
        const {enforceCacheBudget} = await import("../../src/shared/cache-budget");
        store.flora_oa_blob = {doi: {v: "x".repeat(500), t: NOW}};
        await syncRetractionsInfo();
        expect(remoteRequests).toBe(1);
        await enforceCacheBudget(40); // too small to retain any provider cache
        expect(store[RET_MAP_KEY]).toEqual(map);
        expect(store.flora_oa_blob).toBeUndefined();
        for (let i = 0; i < 5; i++) {
            expect(await checkRetraction()).toMatchObject({results: [{originDoi: "10.1000/paper", doi: "10.1000/notice"}]});
            await syncRetractionsInfo();
        }
        expect(remoteRequests).toBe(1);
        vi.setSystemTime(NOW + WEEK + 1);
        await syncRetractionsInfo();
        expect(remoteRequests).toBe(2);
    });

    it("backs off after a failed download instead of retrying on every check", async () => {
        failDownloads = true;
        const {syncRetractionsInfo} = await import("../../src/background/service-worker");
        await syncRetractionsInfo();
        expect(remoteRequests).toBe(1);
        expect(store[RET_MAP_KEY]).toBeUndefined();
        for (let i = 0; i < 5; i++) {
            await checkRetraction();
            await vi.runAllTimersAsync(); // let the check's fire-and-forget sync settle
        }
        expect(remoteRequests).toBe(1);
        vi.setSystemTime(NOW + 10 * 60 * 1000 + 1);
        failDownloads = false;
        await syncRetractionsInfo();
        expect(remoteRequests).toBe(2);
        expect(store[RET_MAP_KEY]).toEqual(map);
    });

    it.each(["missing", "empty"])("repairs a %s map on the next sync", async kind => {
        store.synctime = NOW;
        if (kind === "empty") store[RET_MAP_KEY] = {retractions: {}, concerns: {}};
        const {syncRetractionsInfo} = await import("../../src/background/service-worker");
        await syncRetractionsInfo();
        expect(remoteRequests).toBe(1);
        expect(store[RET_MAP_KEY]).toEqual(map);
    });
});
