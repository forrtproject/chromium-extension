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
