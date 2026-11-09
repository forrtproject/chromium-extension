import {afterEach, describe, expect, it, vi} from "vitest";
import {clearOutages, noteOutage, onOutagesChanged, outageEpoch, outageSources, retryOutages} from "../../src/shared/outages";

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

    it("ignores a failure from a lookup started before the page changed", () => {
        const started = outageEpoch();
        clearOutages();
        noteOutage({}, "oa", () => {}, started);
        expect(outageSources().size).toBe(0);
    });

    it("forgets a failed pill once it has been shown and then removed", () => {
        const pill = document.createElement("span");
        document.body.appendChild(pill);
        const retry = vi.fn();
        noteOutage({}, "pubpeer", retry, outageEpoch(), pill);
        expect([...outageSources()]).toEqual(["pubpeer"]);

        pill.remove();

        expect(outageSources().size).toBe(0);
        retryOutages();
        expect(retry).not.toHaveBeenCalled();
    });

    it("tells listeners when a removed pill's failure is dropped", () => {
        const pill = document.createElement("span");
        document.body.appendChild(pill);
        noteOutage({}, "oa", () => {}, outageEpoch(), pill);
        const listener = vi.fn();
        const stop = onOutagesChanged(listener);

        pill.remove();
        outageSources();

        expect(listener).toHaveBeenCalledOnce();
        stop();
    });

    it("keeps a failure whose pill has not been inserted yet", () => {
        const pill = document.createElement("span");
        noteOutage({}, "oa", () => {}, outageEpoch(), pill);

        expect([...outageSources()]).toEqual(["oa"]);
    });
});
