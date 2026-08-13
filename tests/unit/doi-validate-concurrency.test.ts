import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { validateDOIs, _resetValidationCacheForTesting } from "../../src/shared/doi-validate";
import type { DoiString } from "../../src/shared/types";

describe("doi.org fan-out is capped", () => {
    beforeEach(() => {
        (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
        (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        _resetValidationCacheForTesting();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("never has more than a handful of checks in flight", async () => {
        let inFlight = 0;
        let peak = 0;
        const release: Array<() => void> = [];

        vi.stubGlobal("fetch", vi.fn(() => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            return new Promise((resolve) => {
                release.push(() => {
                    inFlight--;
                    resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({ responseCode: 1 }),
                    } as Response);
                });
            });
        }));

        const dois = Array.from({ length: 40 }, (_, i) => `10.1000/ref${i}` as DoiString);
        const pending = validateDOIs(dois);

        let settled = false;
        void pending.then(() => { settled = true; });
        for (let tick = 0; tick < 200 && !settled; tick++) {
            for (const r of release.splice(0, release.length)) r();
            await new Promise((res) => setTimeout(res, 0));
        }
        await pending;

        expect(peak).toBeLessThanOrEqual(8);
        expect(peak).toBeGreaterThan(1);
    });

    it("still validates every DOI it was given", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ responseCode: 1 }),
        } as Response)));

        const dois = Array.from({ length: 20 }, (_, i) => `10.1000/ok${i}` as DoiString);
        const result = await validateDOIs(dois);

        expect(result.size).toBe(20);
        expect([...result.values()].every(Boolean)).toBe(true);
    });
});
