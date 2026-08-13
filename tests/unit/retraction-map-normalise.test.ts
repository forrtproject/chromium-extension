import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RetractionMaps } from "../../src/shared/data-extract";
import { RET_MAP_KEY } from "../../src/shared/data-extract";

vi.mock("../../src/shared/flora-api", () => ({ lookupDOIs: vi.fn() }));
vi.mock("../../src/shared/pmc-resolve", () => ({ resolvePmcIds: vi.fn() }));
vi.mock("../../src/shared/settings", () => ({
    isSetupComplete: vi.fn().mockResolvedValue(true),
    getSettings: vi.fn().mockResolvedValue({ email: "t@example.com", cacheQuotaMb: 500 }),
}));
vi.mock("../../src/shared/data-extract", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/shared/data-extract")>()),
    storageSync: vi.fn().mockResolvedValue(true),
}));

const MIXED: RetractionMaps = {
    retractions: { "10.3233/JIFS-219197": "10.3233/notice" },
    concerns: {},
};
const PREBUILT: RetractionMaps = {
    retractions: { "10.3233/jifs-219197": "10.3233/notice" },
    concerns: {},
    lowercasedKeys: true,
};

describe("retraction map key normalisation", () => {
    let messageHandler: (m: unknown, s: unknown, r: (x: unknown) => void) => boolean | undefined;

    async function bootWith(map: RetractionMaps) {
        (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation(async (keys: unknown) => {
            const wants = (k: string) => keys === k || (Array.isArray(keys) && keys.includes(k));
            return wants(RET_MAP_KEY) ? { [RET_MAP_KEY]: map } : {};
        });
        const addListener = vi.fn();
        (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>) = addListener;
        (chrome.alarms.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        vi.resetModules();
        await import("../../src/background/service-worker");
        messageHandler = addListener.mock.calls[0][0];
    }

    function check(dois: string[]): Promise<{ results: Array<{ originDoi: string }> }> {
        return new Promise((resolve) => {
            messageHandler({ type: "FLORA_RET_CHECK", dois }, {}, resolve as (r: unknown) => void);
        });
    }

    beforeEach(() => {
        (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });

    it("still matches a legacy map whose keys carry publisher case", async () => {
        await bootWith(MIXED);

        const res = await check(["10.3233/jifs-219197"]);

        expect(res.results).toHaveLength(1);
    });

    it("matches a prebuilt lowercase map without rebuilding it", async () => {
        await bootWith(PREBUILT);

        const res = await check(["10.3233/jifs-219197"]);

        expect(res.results).toHaveLength(1);
    });

    it("takes the prebuilt map at its word instead of rebuilding it", async () => {
        await bootWith({
            retractions: { "10.3233/JIFS-219197": "10.3233/notice" },
            concerns: {},
            lowercasedKeys: true,
        });

        const res = await check(["10.3233/jifs-219197"]);

        expect(res.results).toHaveLength(0);
    });
});
