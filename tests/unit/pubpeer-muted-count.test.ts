import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    applyCommenterMutes,
    commentersOf,
    lookupPubPeerForDois,
    _resetPubPeerCacheForTesting,
    type PubPeerFeedback,
} from "../../src/shared/pubpeer-api";
import { saveHiddenCommenters } from "../../src/shared/pubpeer-filter";

function feedback(overrides: Partial<PubPeerFeedback> = {}): PubPeerFeedback {
    return {
        id: "10.1234/a",
        title: "A paper",
        total_comments: 4,
        total_peeriodical_comments: 0,
        last_commented_at: "",
        users: "Alice Adams, FORRT, Bob Brown, FORRT",
        url: "https://pubpeer.com/publications/a",
        ...overrides,
    };
}

describe("counting the comments a reader can actually see", () => {
    it("reads one commenter name per comment", () => {
        expect(commentersOf(feedback())).toEqual(["Alice Adams", "FORRT", "Bob Brown", "FORRT"]);
    });

    it("takes off one comment per muted commenter", () => {
        const visible = applyCommenterMutes(feedback(), ["FORRT"]);

        expect(visible.total_comments).toBe(2);
        expect(visible.users).toBe("Alice Adams, Bob Brown");
    });

    it("matches names case- and space-insensitively", () => {
        expect(applyCommenterMutes(feedback(), ["  forrt "]).total_comments).toBe(2);
    });

    it("leaves the count alone when the muted commenter said nothing here", () => {
        const original = feedback();

        expect(applyCommenterMutes(original, ["Someone Else"])).toBe(original);
        expect(applyCommenterMutes(original, [])).toBe(original);
    });

    it("reaches zero when every comment is muted", () => {
        const visible = applyCommenterMutes(
            feedback({ total_comments: 2, users: "FORRT, FORRT" }),
            ["FORRT"]
        );

        expect(visible.total_comments).toBe(0);
        expect(visible.users).toBe("");
    });

    it("never goes negative when PubPeer lists more names than comments", () => {
        const visible = applyCommenterMutes(
            feedback({ total_comments: 1, users: "FORRT, FORRT, FORRT" }),
            ["FORRT"]
        );

        expect(visible.total_comments).toBe(0);
    });
});

describe("muting and the PubPeer cache", () => {
    let store: Record<string, unknown>;

    beforeEach(() => {
        store = {};
        chrome.storage.local.get = vi.fn(async (key: string | string[] | null) => {
            if (key === null) return { ...store };
            const k = Array.isArray(key) ? key[0] : key;
            return k in store ? { [k]: store[k] } : {};
        });
        chrome.storage.local.set = vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(store, items);
        });
        (chrome.storage.local as unknown as Record<string, unknown>).getBytesInUse =
            vi.fn().mockResolvedValue(0);
        chrome.storage.sync.get = vi.fn().mockResolvedValue({});
        chrome.storage.sync.set = vi.fn().mockResolvedValue(undefined);

        _resetPubPeerCacheForTesting();
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ status: "success", feedbacks: [feedback()] }),
        })));
    });

    afterEach(async () => {
        vi.unstubAllGlobals();
        _resetPubPeerCacheForTesting();
        await saveHiddenCommenters([]);
    });

    it("subtracts on every read, so unmuting restores the count", async () => {
        await saveHiddenCommenters(["FORRT"]);
        const muted = await lookupPubPeerForDois(["10.1234/a"]);
        expect(muted.get("10.1234/a")?.total_comments).toBe(2);

        await saveHiddenCommenters([]);
        const restored = await lookupPubPeerForDois(["10.1234/a"]);
        expect(restored.get("10.1234/a")?.total_comments).toBe(4);
    });
});
