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

    it("asks doi.org once when two passes check the same uncached DOI", async () => {
        const doi = "10.1234/shared" as DoiString;
        let release!: () => void;
        const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
            release = () => resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ responseCode: 1 }),
            } as Response);
        }));
        vi.stubGlobal("fetch", fetchMock);

        const fastPath = validateDOIs([doi]);
        const fullScan = validateDOIs([doi]);
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        release();

        expect((await fastPath).get(doi)).toBe(true);
        expect((await fullScan).get(doi)).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("checks again once the shared flight has settled", async () => {
        const doi = "10.1234/again" as DoiString;
        const fetchMock = vi.fn(() => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ responseCode: 1 }),
        } as Response));
        vi.stubGlobal("fetch", fetchMock);

        expect((await validateDOIs([doi])).get(doi)).toBe(true);
        _resetValidationCacheForTesting();
        expect((await validateDOIs([doi])).get(doi)).toBe(true);

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not reuse an in-flight check that a reset discarded", async () => {
        const doi = "10.1234/pending" as DoiString;
        const releases: Array<() => void> = [];
        const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
            releases.push(() => resolve({
                ok: true, status: 200, json: () => Promise.resolve({ responseCode: 1 }),
            } as Response));
        }));
        vi.stubGlobal("fetch", fetchMock);

        const abandoned = validateDOIs([doi]);
        await vi.waitFor(() => expect(releases).toHaveLength(1));
        _resetValidationCacheForTesting();

        const fresh = validateDOIs([doi]);
        await vi.waitFor(() => expect(releases).toHaveLength(2));
        releases.forEach((release) => release());

        expect((await fresh).get(doi)).toBe(true);
        await abandoned;
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("keeps the live check when a discarded one settles late", async () => {
        const doi = "10.1234/late" as DoiString;
        const settle: Array<(status: number) => void> = [];
        const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
            settle.push((status) => resolve({
                ok: status === 200, status,
                json: () => Promise.resolve({ responseCode: 1 }),
            } as Response));
        }));
        vi.stubGlobal("fetch", fetchMock);

        const abandoned = validateDOIs([doi]);
        await vi.waitFor(() => expect(settle).toHaveLength(1));
        _resetValidationCacheForTesting();
        const live = validateDOIs([doi]);
        await vi.waitFor(() => expect(settle).toHaveLength(2));

        settle[0](503);
        await abandoned;

        const joiner = validateDOIs([doi]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(settle, "joiner started a third check").toHaveLength(2);

        settle[1](200);
        await Promise.all([live, joiner]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
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
