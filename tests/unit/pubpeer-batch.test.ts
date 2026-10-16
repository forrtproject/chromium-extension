import {beginCancellableWork, endCancellableWork, cancelWork} from "../../src/shared/work-cancellation";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  lookupPubPeerForDoi,
  lookupPubPeerForDois,
  _resetPubPeerCacheForTesting,
} from "../../src/shared/pubpeer-api";
import {createIndicatorPill} from "../../src/shared/indicator-pill";
import type {DoiString} from "../../src/shared/types";

/**
 * One merged indicator pill is rendered per reference, and each one looks up
 * its own DOI. Without coalescing that is a separate POST per reference — all
 * issued before any of them has written to the cache, so none of them hits it.
 */
describe("lookupPubPeerForDoi batching", () => {
  let store: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;

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
    chrome.storage.local.remove = vi.fn(async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) delete store[k];
    });
    (chrome.storage.local as unknown as Record<string, unknown>).getBytesInUse =
      vi.fn().mockResolvedValue(0);

    _resetPubPeerCacheForTesting();

    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        status: "success",
        feedbacks: [
          {
            id: "10.1234/a",
            title: "A",
            total_comments: 3,
            total_peeriodical_comments: 0,
            last_commented_at: "",
            users: "",
            url: "https://pubpeer.com/publications/a",
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    endCancellableWork();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetPubPeerCacheForTesting();
  });

  it("drops cancelled queued batches after the scan indicator ends", async () => {
    vi.useFakeTimers();
    beginCancellableWork();
    const pending = lookupPubPeerForDoi("10.1234/a");
    const outcome = expect(pending).rejects.toMatchObject({name: "AbortError"});
    cancelWork();
    endCancellableWork();
    await vi.advanceTimersByTimeAsync(50);
    await outcome;
    expect(fetchMock).not.toHaveBeenCalled();
    const retry = lookupPubPeerForDoi("10.1234/a");
    await vi.advanceTimersByTimeAsync(50);
    expect((await retry)?.total_comments).toBe(3);
  });

  it("does not attach an idle lookup to a scan started during its batching window", async () => {
    vi.useFakeTimers();
    const pending = lookupPubPeerForDoi("10.1234/a");
    beginCancellableWork();
    cancelWork();
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending)?.total_comments).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent single-DOI lookups into one request", async () => {
    const [a, b, c] = await Promise.all([
      lookupPubPeerForDoi("10.1234/a"),
      lookupPubPeerForDoi("10.1234/b"),
      lookupPubPeerForDoi("10.1234/c"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.dois).toEqual(
      expect.arrayContaining(["10.1234/a", "10.1234/b", "10.1234/c"])
    );

    // Each caller still gets only its own DOI's result.
    expect(a?.total_comments).toBe(3);
    expect(b).toBeNull();
    expect(c).toBeNull();
  });

  it("resolves every waiter for a DOI requested more than once", async () => {
    const [first, second] = await Promise.all([
      lookupPubPeerForDoi("10.1234/a"),
      lookupPubPeerForDoi("10.1234/a"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first?.total_comments).toBe(3);
    expect(second?.total_comments).toBe(3);
  });

  it("rejects a malformed feedback entry instead of caching it as a miss", async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200, headers: {get: () => null},
      json: async () => ({status: "success", feedbacks: [{id: "10.1234/a", total_comments: "many"}]}),
    });
    await expect(lookupPubPeerForDoi("10.1234/a")).rejects.toThrow("PubPeer unavailable");
    // A blank id names no publication, so the entry is unusable as well.
    fetchMock.mockResolvedValue({
      ok: true, status: 200, headers: {get: () => null},
      json: async () => ({status: "success", feedbacks: [{
        id: "  ", title: "A", total_comments: 3, total_peeriodical_comments: 0,
        last_commented_at: "", users: "", url: "https://pubpeer.com/publications/a",
      }]}),
    });
    await expect(lookupPubPeerForDoi("10.1234/a")).rejects.toThrow("PubPeer unavailable");
    fetchMock.mockResolvedValue({ok: true, status: 200, headers: {get: () => null}, json: async () => ({feedbacks: []})});
    await expect(lookupPubPeerForDoi("10.1234/a")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(["javascript:alert(1)", "data:text/html,<script></script>"])(
    "rejects a feedback whose url is %s instead of caching it", async (url) => {
      fetchMock.mockResolvedValue({
        ok: true, status: 200, headers: {get: () => null},
        json: async () => ({status: "success", feedbacks: [{
          id: "10.1234/a", title: "A", total_comments: 3, total_peeriodical_comments: 0,
          last_commented_at: "", users: "", url,
        }]}),
      });
      await expect(lookupPubPeerForDoi("10.1234/a")).rejects.toThrow("PubPeer unavailable");
      fetchMock.mockResolvedValue({ok: true, status: 200, headers: {get: () => null}, json: async () => ({feedbacks: []})});
      await expect(lookupPubPeerForDoi("10.1234/a")).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

  it("refetches a cached feedback whose url is not usable", async () => {
    store["flora_pubpeer_blob"] = {"10.1234/a": {t: Date.now(), v: {feedback: {
      id: "10.1234/a", title: "A", total_comments: 3, total_peeriodical_comments: 0,
      last_commented_at: "", users: "", url: "javascript:alert(1)",
    }}}};
    expect((await lookupPubPeerForDoi("10.1234/a"))?.url).toBe("https://pubpeer.com/publications/a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects failures without caching them, so a later retry can succeed", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(lookupPubPeerForDoi("10.1234/a")).rejects.toThrow("PubPeer unavailable");
    fetchMock.mockResolvedValue({ok: true, status: 200, json: async () => ({feedbacks: []})});
    await expect(lookupPubPeerForDoi("10.1234/a")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  function holdFetch(): {release: () => void; fail: () => void} {
    let release!: () => void;
    let fail!: () => void;
    const gate = new Promise<void>((resolve, reject) => { release = resolve; fail = () => reject(new Error("network down")); });
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      await Promise.race([gate, new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)))]);
      return respond();
    });
    return {release, fail};
  }

  it("lets a pill drawn while a prefetch is still pending share that request", async () => {
    vi.useFakeTimers();
    const {release} = holdFetch();
    const prefetch = lookupPubPeerForDois(["10.1234/A"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    createIndicatorPill({doi: "10.1234/a" as DoiString});
    const single = lookupPubPeerForDoi("10.1234/a");
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release();
    expect((await prefetch).get("10.1234/A")?.total_comments).toBe(3);
    expect((await single)?.total_comments).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a shared request's failure to every caller, so each pill can offer Retry", async () => {
    vi.useFakeTimers();
    const {fail} = holdFetch();
    const unavailable = new Set<string>();
    const prefetch = lookupPubPeerForDois(["10.1234/a"], unavailable);
    await vi.advanceTimersByTimeAsync(0);
    const single = expect(lookupPubPeerForDoi("10.1234/a")).rejects.toThrow("PubPeer unavailable");
    await vi.advanceTimersByTimeAsync(100);
    fail();
    await prefetch;
    await single;
    expect(unavailable.has("10.1234/a")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a DOI once when one call names it twice, and answers both spellings", async () => {
    const result = await lookupPubPeerForDois(["10.1234/A", "10.1234/a"], new Set(), null);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.dois).toEqual(["10.1234/a"]);
    expect(result.get("10.1234/A")?.total_comments).toBe(3);
    expect(result.get("10.1234/a")?.total_comments).toBe(3);
  });

  it("does not let a new scan join a cancelled scan's request", async () => {
    vi.useFakeTimers();
    const {release} = holdFetch();
    beginCancellableWork();
    const stale = lookupPubPeerForDois(["10.1234/a"]);
    await vi.advanceTimersByTimeAsync(0);
    cancelWork();
    endCancellableWork();
    await stale;
    const fresh = lookupPubPeerForDoi("10.1234/a");
    await vi.advanceTimersByTimeAsync(100);
    release();
    expect((await fresh)?.total_comments).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
