import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {
    lookupArticlePubPeer,
    lookupPubPeerForDoi,
    lookupPubPeerForDois,
    pubPeerVerdict,
    _resetPubPeerCacheForTesting,
} from "../../src/shared/pubpeer-api";

const ARTICLE = "10.1000/article";
const REFERENCE = "10.1000/reference";

function ok(feedbacks: unknown[] = []) {
    return {ok: true, status: 200, headers: {get: () => null}, json: async () => ({status: "success", feedbacks})};
}

describe("article PubPeer state for the side panel", () => {
    let store: Record<string, unknown>;

    beforeEach(() => {
        store = {};
        chrome.storage.local.get = vi.fn(async (key: string | string[] | null) => {
            if (key === null) return {...store};
            const k = Array.isArray(key) ? key[0] : key;
            return k in store ? {[k]: store[k]} : {};
        });
        chrome.storage.local.set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items); });
        chrome.storage.local.remove = vi.fn(async () => {});
        (chrome.storage.local as unknown as Record<string, unknown>).getBytesInUse = vi.fn().mockResolvedValue(0);
        _resetPubPeerCacheForTesting();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        _resetPubPeerCacheForTesting();
    });

    it("agrees with the pill: a confirmed miss is 'no discussion', not unavailable", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ok()));
        await expect(lookupPubPeerForDoi(ARTICLE)).resolves.toBeNull();
        // The panel's later lookup fails at the network but reuses the pill's answer.
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
        await expect(lookupArticlePubPeer(ARTICLE, null)).resolves.toEqual({feedback: null, unavailable: false});
        expect(pubPeerVerdict(ARTICLE)).toBe("clear");
    });

    it("is unavailable only when the article's own lookup fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
        const refUnavailable = new Set<string>();
        await lookupPubPeerForDois([REFERENCE], refUnavailable, null);
        expect(refUnavailable.has(REFERENCE)).toBe(true);

        vi.stubGlobal("fetch", vi.fn(async () => ok()));
        await expect(lookupArticlePubPeer(ARTICLE, null)).resolves.toEqual({feedback: null, unavailable: false});

        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
        await expect(lookupArticlePubPeer("10.1000/other", null)).resolves.toEqual({feedback: null, unavailable: true});
    });

    it("returns the article's thread when PubPeer has one", async () => {
        const thread = {
            id: ARTICLE, title: "A", total_comments: 2, total_peeriodical_comments: 0,
            last_commented_at: "", users: "", url: "https://pubpeer.com/publications/a",
        };
        vi.stubGlobal("fetch", vi.fn(async () => ok([thread])));
        const result = await lookupArticlePubPeer(ARTICLE, null);
        expect(result.unavailable).toBe(false);
        expect(result.feedback?.total_comments).toBe(2);
    });
});
