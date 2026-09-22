import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { validateDOIs, VALIDATION_BUDGET_MS, _resetValidationCacheForTesting } from "../../src/shared/doi-validate";
import { beginCancellableWork, cancelWork, endCancellableWork } from "../../src/shared/work-cancellation";
import type { DoiString } from "../../src/shared/types";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
// A cancelled pass leaves the module-level work state started and aborted, so
// every case starts from a clean slate whatever the previous one asserted.
afterEach(() => {
  server.resetHandlers();
  endCancellableWork();
  vi.unstubAllGlobals();
});
afterAll(() => server.close());

const doi = (s: string) => s as DoiString;

// Slashes in the DOI are preserved as URL path separators, so
// 10.1038/nature12373 → /api/handles/10.1038/nature12373 (two segments)
// and 10.6338/JDA.202212/SP_17(4).0000 → /api/handles/10.6338/JDA.202212/SP_17(4).0000
// Use a wildcard to match all handle API requests regardless of segment count.
const HANDLE_PATTERN = "https://doi.org/api/handles/*";

/** Every DOI written into the validation blob so far, across all cache flushes. */
function cachedDois(): string[] {
  const calls = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls;
  return calls.flatMap(([arg]) =>
    Object.keys((arg as Record<string, object>)?.flora_doival_blob ?? {}),
  );
}

function handleFromRequest(request: Request): string {
  const url = new URL(request.url);
  return decodeURIComponent(url.pathname.replace("/api/handles/", ""));
}

describe("DOI validation outcomes and caching", () => {
  beforeEach(() => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockClear();
    _resetValidationCacheForTesting();
  });

  it("returns true for a valid DOI (responseCode 1)", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.json({ responseCode: 1, handle: "10.1038/nature12373" })
      )
    );

    const result = (await validateDOIs([doi("10.1038/nature12373")])).get(doi("10.1038/nature12373"));
    expect(result).toBe(true);
  });

  it("returns false for an invalid DOI (responseCode 100)", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.json({ responseCode: 100, handle: "10.1038/doesnotexist" })
      )
    );

    const result = (await validateDOIs([doi("10.1038/doesnotexist")])).get(doi("10.1038/doesnotexist"));
    expect(result).toBe(false);
  });

  // A transient failure must leave the DOI *out* of the map (unknown) rather
  // than mark it invalid: processReferenceDois has already set the DOI's
  // processed marker, so a falsely-invalid verdict strands the reference, and
  // caching it strands the DOI for the whole 7-day TTL.
  it("leaves a DOI unknown and uncached on HTTP 5xx", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () =>
        new HttpResponse(null, { status: 500 })
      )
    );

    const result = await validateDOIs([doi("10.1038/nature12373")]);
    expect(result.has(doi("10.1038/nature12373"))).toBe(false);
    expect(cachedDois()).not.toContain("10.1038/nature12373");
  });

  it("leaves a DOI unknown and uncached on network error", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.error()
      )
    );

    const result = await validateDOIs([doi("10.1038/nature12373")]);
    expect(result.has(doi("10.1038/nature12373"))).toBe(false);
    expect(cachedDois()).not.toContain("10.1038/nature12373");
  });

  it.each([2, 200, 999, undefined, "1"])(
    "leaves responseCode %s unknown, uncached, and eligible for retry",
    async (responseCode) => {
      let calls = 0;
      server.use(http.get(HANDLE_PATTERN, () => {
        calls++;
        return HttpResponse.json(calls === 1 ? { responseCode } : { responseCode: 1 });
      }));
      const target = doi("10.1038/retry");
      expect((await validateDOIs([target])).has(target)).toBe(false);
      expect(cachedDois()).not.toContain(target);
      expect((await validateDOIs([target])).get(target)).toBe(true);
      expect(calls).toBe(2);
    },
  );

  it("records a DOI invalid on HTTP 404", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () => new HttpResponse(null, { status: 404 }))
    );

    const result = await validateDOIs([doi("10.1038/doesnotexist")]);
    expect(result.get(doi("10.1038/doesnotexist"))).toBe(false);
  });

  it("caches valid results", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.json({ responseCode: 1 })
      )
    );

    await validateDOIs([doi("10.1038/nature12373")]);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        flora_doival_blob: expect.objectContaining({
          "10.1038/nature12373": expect.objectContaining({
            v: { valid: true },
            t: expect.any(Number),
          }),
        }),
      })
    );
  });

  it("caches invalid results", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.json({ responseCode: 100 })
      )
    );

    await validateDOIs([doi("10.1038/doesnotexist")]);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        flora_doival_blob: expect.objectContaining({
          "10.1038/doesnotexist": expect.objectContaining({
            v: { valid: false },
          }),
        }),
      })
    );
  });

  it("flushes cache writes for a batch in a single storage write", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () => HttpResponse.json({ responseCode: 1 }))
    );
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockClear();

    await validateDOIs([doi("10.1038/one"), doi("10.1126/two")]);

    // One setMany flush for the whole batch, not one write per resolved DOI.
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it("uses cached result on second call", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      flora_doival_blob: {
        "10.1038/cached": { v: { valid: true }, t: Date.now() },
      },
    });

    const result = (await validateDOIs([doi("10.1038/cached")])).get(doi("10.1038/cached"));
    expect(result).toBe(true);
  });

  it("ignores expired cache entries", async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      flora_doival_blob: {
        "10.1038/expired": { v: { valid: false }, t: eightDaysAgo },
      },
    });

    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.json({ responseCode: 1 })
      )
    );

    const result = (await validateDOIs([doi("10.1038/expired")])).get(doi("10.1038/expired"));
    expect(result).toBe(true);
  });
});

describe("validateDOIs", () => {
  beforeEach(() => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockClear();
    _resetValidationCacheForTesting();
  });

  it("returns empty map for empty input", async () => {
    const results = await validateDOIs([]);
    expect(results.size).toBe(0);
  });

  it("validates multiple DOIs in parallel", async () => {
    server.use(
      http.get(HANDLE_PATTERN, ({ request }) => {
        const handle = handleFromRequest(request);
        if (handle === "10.1038/valid1") {
          return HttpResponse.json({ responseCode: 1 });
        }
        return HttpResponse.json({ responseCode: 100 });
      })
    );

    const results = await validateDOIs([
      doi("10.1038/valid1"),
      doi("10.1038/invalid1"),
    ]);

    expect(results.get(doi("10.1038/valid1"))).toBe(true);
    expect(results.get(doi("10.1038/invalid1"))).toBe(false);
  });

  it("validates a DOI with a slash inside the suffix (spec example 2)", async () => {
    // 10.6338/JDA.202212/SP_17(4).0000 has two slashes — the API URL must
    // use a real path (not %2F) so doi.org routes it correctly.
    server.use(
      http.get(HANDLE_PATTERN, ({ request }) => {
        const handle = handleFromRequest(request);
        if (handle === "10.6338/jda.202212/sp_17(4).0000") {
          return HttpResponse.json({ responseCode: 1 });
        }
        return HttpResponse.json({ responseCode: 100 });
      })
    );

    const results = await validateDOIs([doi("10.6338/jda.202212/sp_17(4).0000")]);
    expect(results.get(doi("10.6338/jda.202212/sp_17(4).0000"))).toBe(true);
  });

  it("rejects a cancelled pass instead of reporting the DOIs unresolved", async () => {
    // The transport is stubbed rather than mocked through msw: this case is
    // about the abort reaching a request that is still open.
    const fetchStub = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true })));
    vi.stubGlobal("fetch", fetchStub);
    beginCancellableWork();
    const pending = validateDOIs([doi("10.1038/cancelled")]);
    const outcome = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    // Cancel the request while it is in flight.
    await vi.waitFor(() => expect(fetchStub).toHaveBeenCalled());
    cancelWork();
    await outcome;
    expect(cachedDois()).toEqual([]);
  });

  it("mixes cached and uncached DOIs", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      flora_doival_blob: {
        "10.1038/cached": { v: { valid: true }, t: Date.now() },
      },
    });

    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.json({ responseCode: 1 })
      )
    );

    const results = await validateDOIs([
      doi("10.1038/cached"),
      doi("10.1038/uncached"),
    ]);

    expect(results.get(doi("10.1038/cached"))).toBe(true);
    expect(results.get(doi("10.1038/uncached"))).toBe(true);
  });
});

describe("validateDOIs time limit", () => {
  // Stubbed transport: a request stays open until its signal aborts, unless
  // the DOI is listed in `answers`.
  function stallingFetch(answers: Record<string, number> = {}) {
    return vi.fn((url: string, init: RequestInit) => {
      const code = answers[decodeURIComponent(new URL(url).pathname.replace("/api/handles/", ""))];
      if (code !== undefined) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ responseCode: code }) } as Response);
      }
      return new Promise<Response>((_resolve, reject) =>
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockClear();
    _resetValidationCacheForTesting();
  });
  afterEach(() => { vi.useRealTimers(); });

  it("stops at the time limit, aborts open requests and skips the queued ones", async () => {
    const fetchStub = stallingFetch();
    vi.stubGlobal("fetch", fetchStub);
    const dois = Array.from({ length: 20 }, (_, i) => doi(`10.1000/slow${i}`));

    let settled = false;
    const pending = validateDOIs(dois).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(VALIDATION_BUDGET_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const results = await pending;

    // Unanswered DOIs are unknown: absent from the map, which callers keep.
    expect(results.size).toBe(0);
    expect(fetchStub).toHaveBeenCalledTimes(6);
    for (const [, init] of fetchStub.mock.calls) expect(init.signal!.aborted).toBe(true);
    expect(cachedDois()).toEqual([]);
  });

  it("keeps and caches the verdicts that arrived before the limit", async () => {
    vi.stubGlobal("fetch", stallingFetch({ "10.1000/fast": 1, "10.1000/gone": 100 }));

    const pending = validateDOIs([doi("10.1000/fast"), doi("10.1000/slow"), doi("10.1000/gone")]);
    await vi.advanceTimersByTimeAsync(VALIDATION_BUDGET_MS);
    const results = await pending;

    expect([...results]).toEqual([[doi("10.1000/fast"), true], [doi("10.1000/gone"), false]]);
    expect(cachedDois().sort()).toEqual(["10.1000/fast", "10.1000/gone"]);
  });
});
