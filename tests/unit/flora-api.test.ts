import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createDoiSet, lookupDOIs } from "../../src/shared/flora-api";
import { doi, mockResult, mockEntry } from "../helpers";
import { setDebug, recentDebugEntries, _resetDebugForTesting } from "../../src/shared/debug";

const API_URL = "https://rep-api.forrt.org/v1/original-lookup";
const SETS_URL = "https://rep-api.forrt.org/v1/sets";

// Row id, then the AES key the set was encrypted with — the shape the server hands back.
const SET_TOKEN = "d7dbaac1.hT9v1RkQ0s_bXm4pE7ZLn2yWgC8jUdA6oIvF3rKqNxM";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("lookupDOIs", () => {
  it("reports failed batch DOIs while preserving a later successful batch", async () => {
    const targets = Array.from({length: 51}, (_, i) => doi(`10.1038/item${i}`));
    server.use(http.get(API_URL, ({request}) => {
      const batch = new URL(request.url).searchParams.get("dois")!.split(",");
      return batch.length === 50
        ? new HttpResponse(null, {status: 503})
        : HttpResponse.json({results: {[targets[50]]: mockResult({doi: targets[50]})}});
    }));
    const errors: Record<string, string> = {};
    const results = await lookupDOIs(targets, errors);
    expect(results.has(targets[50])).toBe(true);
    expect(Object.keys(errors)).toHaveLength(50);
    expect(errors[targets[0]]).toMatch(/503/);
    expect(errors[targets[50]]).toBeUndefined();
  });

  it("rejects when the transport is cancelled instead of failing each DOI", async () => {
    server.use(http.get(API_URL, () => new Promise<never>(() => {})));
    const controller = new AbortController();
    const errors: Record<string, string> = {};
    const pending = lookupDOIs([doi("10.1038/a")], errors, controller.signal);
    const outcome = expect(pending).rejects.toMatchObject({name: "AbortError"});
    controller.abort(new DOMException("Work cancelled", "AbortError"));
    await outcome;
    expect(errors).toEqual({});
  });

  it("stops starting batches once its time budget is spent", async () => {
    vi.useFakeTimers({toFake: ["Date"]});
    const targets = Array.from({length: 150}, (_, i) => doi(`10.1038/slow${i}`));
    let calls = 0;
    server.use(http.get(API_URL, () => {
      calls++;
      vi.setSystemTime(Date.now() + 100_000);
      return HttpResponse.json({results: {}});
    }));
    const errors: Record<string, string> = {};
    try {
      await lookupDOIs(targets, errors);
    } finally {
      vi.useRealTimers();
    }
    expect(calls).toBe(2);
    expect(Object.keys(errors)).toEqual(targets.slice(100));
    expect(errors[targets[100]]).toBe("Lookup skipped: time budget spent");
  });

  it("returns matched results on 200", async () => {
    const result = mockResult();
    server.use(
      http.get(API_URL, () =>
        HttpResponse.json({
          results: { "10.1038/nature12373": result },
        })
      )
    );

    const results = await lookupDOIs([doi("10.1038/nature12373")]);
    expect(results.size).toBe(1);
    expect(
      results.get(doi("10.1038/nature12373"))?.record.stats.n_replications_total
    ).toBe(3);
  });

  it("returns empty map on 200 with empty results", async () => {
    server.use(
      http.get(API_URL, () => HttpResponse.json({ results: {} }))
    );

    const results = await lookupDOIs([doi("10.9999/nonexistent")]);
    expect(results.size).toBe(0);
  });

  it("returns empty map when called with empty array", async () => {
    const results = await lookupDOIs([]);
    expect(results.size).toBe(0);
  });

  it("returns empty map on 429 rate limit (per-batch error handling)", async () => {
    server.use(
      http.get(API_URL, () => new HttpResponse(null, { status: 429 }))
    );

    const results = await lookupDOIs([doi("10.1038/test")]);
    expect(results.size).toBe(0);
  });

  it("returns empty map on 500 server error (per-batch error handling)", async () => {
    server.use(
      http.get(API_URL, () => new HttpResponse(null, { status: 500 }))
    );

    const results = await lookupDOIs([doi("10.1038/test")]);
    expect(results.size).toBe(0);
  });

  it("returns empty map on network error (per-batch error handling)", async () => {
    server.use(http.get(API_URL, () => HttpResponse.error()));

    const results = await lookupDOIs([doi("10.1038/test")]);
    expect(results.size).toBe(0);
  });

  it("returns empty map on Zod schema mismatch (per-batch error handling)", async () => {
    server.use(
      http.get(API_URL, () =>
        HttpResponse.json({
          results: {
            "10.1038/nature12373": { doi: "10.1038/nature12373" },
          },
        })
      )
    );

    const results = await lookupDOIs([doi("10.1038/nature12373")]);
    expect(results.size).toBe(0);
  });

  it("returns empty map on completely unexpected response shape (per-batch error handling)", async () => {
    server.use(
      http.get(API_URL, () => HttpResponse.json({ data: "unexpected" }))
    );

    const results = await lookupDOIs([doi("10.1038/test")]);
    expect(results.size).toBe(0);
  });

  it("accepts a string in the authors field (consortium name)", async () => {
    const result = mockResult();
    result.record.replications = [mockEntry()];
    // FORRT returns a group name as a plain string for some entries.
    (result.record.replications[0] as Record<string, unknown>).authors =
      "Open Science Collaboration";
    server.use(
      http.get(API_URL, () =>
        HttpResponse.json({ results: { "10.1038/nature12373": result } })
      )
    );

    const results = await lookupDOIs([doi("10.1038/nature12373")]);
    expect(results.size).toBe(1);
    const authors = results.get(doi("10.1038/nature12373"))!.record.replications[0].authors;
    expect(authors).toEqual([{ family: "Open Science Collaboration" }]);
  });

  it("skips one malformed result without dropping the rest of the batch", async () => {
    const good = mockResult({ doi: "10.1038/good" });
    server.use(
      http.get(API_URL, () =>
        HttpResponse.json({
          results: {
            "10.1038/good": good,
            "10.1038/bad": { doi: "10.1038/bad" }, // missing required fields
          },
        })
      )
    );

    const errors: Record<string, string> = {};
    const results = await lookupDOIs([doi("10.1038/good"), doi("10.1038/bad")], errors);
    expect(errors["10.1038/bad"]).toMatch(/malformed/i);
    expect(errors["10.1038/good"]).toBeUndefined();
    expect(results.size).toBe(1);
    expect(results.get(doi("10.1038/good"))).toBeTruthy();
    expect(results.has(doi("10.1038/bad"))).toBe(false);
  });

  it("returns empty map when response has null fields where numbers expected (per-batch error handling)", async () => {
    const bad = mockResult();
    (bad.record.stats as Record<string, unknown>).n_replications_total = null;
    server.use(
      http.get(API_URL, () =>
        HttpResponse.json({ results: { "10.1038/nature12373": bad } })
      )
    );

    const results = await lookupDOIs([doi("10.1038/nature12373")]);
    expect(results.size).toBe(0);
  });
});

describe("createDoiSet", () => {
  it("posts the DOIs and returns the set id", async () => {
    let body: unknown;
    server.use(
      http.post(SETS_URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: SET_TOKEN, count: 2 });
      })
    );

    const setId = await createDoiSet([doi("10.1038/a"), doi("10.1038/b")]);

    expect(setId).toBe(SET_TOKEN);
    expect(body).toEqual({ dois: ["10.1038/a", "10.1038/b"] });
  });

  it("keeps the key half out of the debug log", async () => {
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logged.push(...args);
    });
    setDebug(true);
    server.use(http.post(SETS_URL, () => HttpResponse.json({ id: SET_TOKEN, count: 1 })));

    await createDoiSet([doi("10.1038/a")]);

    const transcript = logged.map(String).join(" ");
    const reported = recentDebugEntries().map((e) => e.msg).join(" ");
    spy.mockRestore();
    _resetDebugForTesting();

    // The line has to have been written, or the assertion below proves nothing.
    expect(transcript).toContain("Created DOI set d7dbaac1");
    expect(transcript).not.toContain(SET_TOKEN.split(".")[1]);
    expect(reported).not.toContain(SET_TOKEN.split(".")[1]);
  });

  it("returns null for a token that lost its key half in transit", async () => {
    server.use(http.post(SETS_URL, () => HttpResponse.json({ id: "d7dbaac1", count: 1 })));

    expect(await createDoiSet([doi("10.1038/a")])).toBeNull();
  });

  it("returns null for a token whose key is the wrong length", async () => {
    server.use(
      http.post(SETS_URL, () => HttpResponse.json({ id: "d7dbaac1.tooshort", count: 1 }))
    );

    expect(await createDoiSet([doi("10.1038/a")])).toBeNull();
  });

  it("returns null without calling the API for an empty list", async () => {
    expect(await createDoiSet([])).toBeNull();
  });

  it("returns null on a server error", async () => {
    server.use(http.post(SETS_URL, () => new HttpResponse(null, { status: 500 })));

    expect(await createDoiSet([doi("10.1038/a")])).toBeNull();
  });

  it("returns null on a network error", async () => {
    server.use(http.post(SETS_URL, () => HttpResponse.error()));

    expect(await createDoiSet([doi("10.1038/a")])).toBeNull();
  });

  it("returns null when the response carries no id", async () => {
    server.use(http.post(SETS_URL, () => HttpResponse.json({ count: 1 })));

    expect(await createDoiSet([doi("10.1038/a")])).toBeNull();
  });
});
