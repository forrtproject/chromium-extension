import {afterEach, describe, expect, it, vi} from "vitest";
import {clearOutages, noteOutage, onOutagesChanged, outageSources, retryOutages} from "../../src/shared/outages";

describe("page outages", () => {
    afterEach(() => clearOutages());

    it("lists a source while any pill's lookup for it is failing", () => {
        const a = {}, b = {};
        noteOutage(a, "oa", () => {});
        noteOutage(b, "oa", () => {});
        noteOutage(b, "pubpeer", () => {});
        expect([...outageSources()].sort()).toEqual(["oa", "pubpeer"]);
        noteOutage(a, "oa", null);
        expect([...outageSources()].sort()).toEqual(["oa", "pubpeer"]);
        noteOutage(b, "oa", null);
        expect([...outageSources()]).toEqual(["pubpeer"]);
    });

    it("notifies only when the failing set changes", () => {
        const listener = vi.fn();
        const stop = onOutagesChanged(listener);
        const pill = {};
        noteOutage(pill, "oa", () => {});
        noteOutage(pill, "oa", () => {});
        noteOutage(pill, "pubpeer", null);
        expect(listener).toHaveBeenCalledTimes(1);
        noteOutage(pill, "oa", null);
        expect(listener).toHaveBeenCalledTimes(2);
        stop();
    });

    it("retries every failed lookup and forgets them on a page change", () => {
        const retryOa = vi.fn(), retryPubPeer = vi.fn();
        noteOutage({}, "oa", retryOa);
        noteOutage({}, "pubpeer", retryPubPeer);
        retryOutages();
        expect(retryOa).toHaveBeenCalledOnce();
        expect(retryPubPeer).toHaveBeenCalledOnce();
        clearOutages();
        expect(outageSources().size).toBe(0);
    });
});
