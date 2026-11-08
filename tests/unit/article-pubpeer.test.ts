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
        await expect(lookupArticlePubPeer(ARTICLE, null, null)).resolves.toEqual({feedbacks: [], feedback: null, unavailable: false});
        expect(pubPeerVerdict(ARTICLE)).toBe("clear");
    });

    it("is unavailable only when the article's own lookup fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
        const refUnavailable = new Set<string>();
        await lookupPubPeerForDois([REFERENCE], refUnavailable, null);
        expect(refUnavailable.has(REFERENCE)).toBe(true);

        vi.stubGlobal("fetch", vi.fn(async () => ok()));
        await expect(lookupArticlePubPeer(ARTICLE, null, null)).resolves.toEqual({feedbacks: [], feedback: null, unavailable: false});

        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
        await expect(lookupArticlePubPeer("10.1000/other", null, null)).resolves.toEqual({feedbacks: [], feedback: null, unavailable: true});
    });

    it("returns the article's thread when PubPeer has one", async () => {
        const thread = {
            id: ARTICLE, title: "A", total_comments: 2, total_peeriodical_comments: 0,
            last_commented_at: "", users: "", url: "https://pubpeer.com/publications/a",
        };
        vi.stubGlobal("fetch", vi.fn(async () => ok([thread])));
        const result = await lookupArticlePubPeer(ARTICLE, null, null);
        expect(result.unavailable).toBe(false);
        expect(result.feedback?.total_comments).toBe(2);
    });

    const urlThread = {
        id: "10.1000/preprint-of-article", title: "Matched by URL", total_comments: 5, total_peeriodical_comments: 0,
        last_commented_at: "", users: "", url: "https://pubpeer.com/publications/url",
    };
    const PAGE = "https://journal.example.org/article/1";
    const bodyOf = (call: unknown[]) => JSON.parse((call[1] as {body: string}).body) as {dois: string[]; urls: string[]};

    it("falls back to a thread PubPeer matches only by the page URL", async () => {
        const fetchMock = vi.fn(async (_url: string, init: {body: string}) =>
            ok(JSON.parse(init.body).urls.length > 0 ? [urlThread] : []));
        vi.stubGlobal("fetch", fetchMock);
        const result = await lookupArticlePubPeer(ARTICLE, PAGE, null);
        expect(result).toMatchObject({feedback: null, unavailable: false});
        expect(result.feedbacks.map((f) => f.title)).toEqual(["Matched by URL"]);
        expect(fetchMock.mock.calls.map((c) => bodyOf(c).urls)).toEqual([[], [PAGE]]);
    });

    it("uses the DOI thread without a URL lookup, and a pill's known answer without any lookup", async () => {
        const thread = {...urlThread, id: ARTICLE, title: "By DOI", total_comments: 2};
        const fetchMock = vi.fn(async () => ok([thread]));
        vi.stubGlobal("fetch", fetchMock);
        expect((await lookupArticlePubPeer(ARTICLE, PAGE, null)).feedbacks.map((f) => f.title)).toEqual(["By DOI"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockClear();
        expect((await lookupArticlePubPeer(ARTICLE, PAGE, null, thread)).feedbacks).toEqual([thread]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps the DOI answer when only the URL fallback fails", async () => {
        let calls = 0;
        vi.stubGlobal("fetch", vi.fn(async () => { if (calls++ === 0) return ok(); throw new Error("offline"); }));
        await expect(lookupArticlePubPeer(ARTICLE, PAGE, null)).resolves.toEqual({feedbacks: [], feedback: null, unavailable: false});
    });

    it("starts the 429 back-off from the URL fallback and skips the fallback while it runs", async () => {
        const limited = {ok: false, status: 429, headers: {get: () => "120"}, json: async () => ({})};
        const fetchMock = vi.fn(async (_url: string, init: {body: string}) =>
            JSON.parse(init.body).urls.length > 0 ? limited : ok());
        vi.stubGlobal("fetch", fetchMock);
        await expect(lookupArticlePubPeer(ARTICLE, PAGE, null)).resolves.toMatchObject({unavailable: false});
        expect(fetchMock).toHaveBeenCalledTimes(2);
        fetchMock.mockClear();
        // DOI answer is cached; the URL fallback is skipped during the back-off.
        await expect(lookupArticlePubPeer(ARTICLE, PAGE, null)).resolves.toMatchObject({unavailable: false});
        expect(fetchMock).not.toHaveBeenCalled();
        // Other DOI lookups honour the same back-off.
        const unavailable = new Set<string>();
        await lookupPubPeerForDois([REFERENCE], unavailable, null);
        expect(unavailable.has(REFERENCE)).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("is unavailable, so the panel offers Retry, when the article's own DOI lookup fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
        await expect(lookupArticlePubPeer(ARTICLE, PAGE, null)).resolves.toMatchObject({unavailable: true});
    });
});

