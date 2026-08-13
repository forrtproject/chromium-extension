import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  lookupPubPeerForDois,
  _resetPubPeerCacheForTesting,
} from "../../src/shared/pubpeer-api";

const MIXED = "10.3233/JIFS-219197";
const LOWER = "10.3233/jifs-219197";

function feedback(id: string) {
  return {
    id,
    title: "A paper",
    total_comments: 7,
    total_peeriodical_comments: 0,
    last_commented_at: "",
    users: "",
    url: `https://pubpeer.com/publications/${id}`,
  };
}

describe("PubPeer DOI casing", () => {
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

    _resetPubPeerCacheForTesting();

    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ status: "good", feedbacks: [feedback(LOWER)] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetPubPeerCacheForTesting();
  });

  it("matches a lowercase response id against a mixed-case query DOI", async () => {
    const result = await lookupPubPeerForDois([MIXED]);

    expect(result.get(MIXED)?.total_comments).toBe(7);
  });

  it("queries PubPeer with the lowercased DOI", async () => {
    await lookupPubPeerForDois([MIXED]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.dois).toEqual([LOWER]);
  });

  it("serves a differently-cased DOI from the same cache entry", async () => {
    await lookupPubPeerForDois([MIXED]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const result = await lookupPubPeerForDois([LOWER]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.get(LOWER)?.total_comments).toBe(7);
  });

  it("still caches a genuine miss", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ status: "good", feedbacks: [] }),
    });

    expect((await lookupPubPeerForDois([MIXED])).size).toBe(0);
    expect((await lookupPubPeerForDois([MIXED])).size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
