import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {installOfflineFixtures} from "../../src/walkthrough/demos";
import {lookupPubPeerForDoi, _resetPubPeerCacheForTesting} from "../../src/shared/pubpeer-api";
import {isPubPeerThreadUrl} from "../../src/shared/pubpeer-comments";
import {TOUR_REQUEST_KEY} from "../../src/shared/tour-sample";

describe("the walkthrough's offline fixtures", () => {
    const realLocal = chrome.storage.local;
    const realSync = chrome.storage.sync;
    const realFetch = globalThis.fetch;
    let local: {get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>};
    let sync: {get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>};

    beforeEach(() => {
        local = {get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined)};
        sync = {get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined)};
        chrome.storage.local = {...local} as never;
        chrome.storage.sync = sync as never;
        _resetPubPeerCacheForTesting();
        installOfflineFixtures();
    });

    afterEach(() => {
        chrome.storage.local = realLocal;
        chrome.storage.sync = realSync;
        globalThis.fetch = realFetch;
        _resetPubPeerCacheForTesting();
    });

    it("keeps demo PubPeer results out of the extension's real cache", async () => {
        const feedback = await lookupPubPeerForDoi("10.1177/0956797610383437");
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(feedback).not.toBeNull();
        expect(local.set).not.toHaveBeenCalled();
        expect(await chrome.storage.local.get("flora_pubpeer_blob")).toHaveProperty("flora_pubpeer_blob");
    });

    it("links every demo result to a real PubPeer thread", async () => {
        const response = await fetch("https://pubpeer.com/v3/publications");
        const {feedbacks} = await response.json() as {feedbacks: Array<{url: string}>};
        expect(feedbacks.length).toBeGreaterThan(0);
        for (const {url} of feedbacks) expect(isPubPeerThreadUrl(url)).toBe(true);
    });

    it("still writes the sample-tour request and settings to real storage", async () => {
        await chrome.storage.local.set({[TOUR_REQUEST_KEY]: 1, other: 2});
        expect(local.set).toHaveBeenCalledWith({[TOUR_REQUEST_KEY]: 1});
        await chrome.storage.sync.set({flora_settings: {}});
        expect(sync.set).toHaveBeenCalledWith({flora_settings: {}});
    });
});
