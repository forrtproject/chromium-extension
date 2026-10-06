import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fetchOpenAccess, _resetOpenAccessCacheForTesting} from "../../src/shared/openaccess";

const settings = vi.hoisted(() => ({email: "reader@example.org"}));
vi.mock("../../src/shared/settings", () => ({getSettings: async () => ({...settings})}));
const debug = vi.hoisted(() => ({debugWarn: vi.fn()}));
vi.mock("../../src/shared/debug", () => debug);

beforeEach(() => {
    settings.email = "reader@example.org";
    debug.debugWarn.mockReset();
    _resetOpenAccessCacheForTesting();
    vi.mocked(chrome.storage.local.get).mockResolvedValue({});
});
afterEach(() => vi.unstubAllGlobals());

const warnings = () => debug.debugWarn.mock.calls.map((c) => c.join(" ")).join("\n");

describe("when Unpaywall refuses the request", () => {
    it("says so, and repeats the reason Unpaywall gave", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(
            JSON.stringify({HTTP_status_code: 422, error: true,
                message: "Please use your own email address in API calls."}),
            {status: 422})));

        expect(await fetchOpenAccess("10.1177/2515245918810225")).toBeNull();
        expect(warnings(), "a blank padlock with no log is undiagnosable").toContain("422");
        expect(warnings()).toContain("Please use your own email address");
    });

    it("still reports a refusal that carries no message", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", {status: 503})));

        expect(await fetchOpenAccess("10.1002/bdm.2178")).toBeNull();
        expect(warnings()).toContain("503");
        expect(warnings()).toContain("no detail given");
    });

    it("leaves a 404 alone — that is an answer, not a refusal", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {status: 404})));

        expect(await fetchOpenAccess("10.5555/not-indexed")).toMatchObject({isOa: false, notIndexed: true});
        expect(debug.debugWarn).not.toHaveBeenCalled();
    });
});

describe("Unpaywall location links", () => {
    it("keeps only http(s) copies, falling back to the landing page", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            is_oa: true,
            best_oa_location: {url_for_pdf: "javascript:alert(1)", url: "https://repo.example.org/landing"},
            oa_locations: [{url: "data:text/html,<script>alert(1)</script>"}, {url_for_pdf: "https://repo.example.org/paper.pdf"}],
        }), {status: 200})));

        const status = await fetchOpenAccess("10.1234/oa.links");

        expect(status!.locations!.map((l) => l.url)).toEqual([
            "https://repo.example.org/landing",
            "https://repo.example.org/paper.pdf",
        ]);
        expect(status!.locations![0].isPdf).toBe(false);
        expect(status!.url).toBe("https://repo.example.org/landing");
    });
});

describe("a deferred Open Access lookup", () => {
    it("is still cancelled by a navigation after its pass has ended", async () => {
        vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        })));
        const {beginCancellableWork, endCancellableWork, abortWorkForNavigation, isAbortError} = await import("../../src/shared/work-cancellation");
        const {deferredOpenAccess} = await import("../../src/shared/openaccess");
        beginCancellableWork();
        const lookup = deferredOpenAccess("10.1234/deferred.navigation");
        endCancellableWork();

        const result = lookup();
        await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
        abortWorkForNavigation();

        await expect(result).rejects.toSatisfy(isAbortError);
    });
});
