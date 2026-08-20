import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

vi.mock("../../src/shared/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ email: "test@example.com" }),
  isSetupComplete: vi.fn().mockResolvedValue(true),
}));

import { normalisePmcId, normalisePmid, resolvePmcIds, _resetPmcCacheForTesting } from "../../src/shared/pmc-resolve";

const IDCONV_URL = "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface Record {
  doi?: string;
  pmcid?: string;
  pmid?: number;
  "requested-id"?: string;
  status?: string;
}

function respondWith(records: Record[], seenIds?: string[][]) {
  return http.get(IDCONV_URL, ({ request }) => {
    const ids = new URL(request.url).searchParams.get("ids") ?? "";
    seenIds?.push(ids.split(","));
    return HttpResponse.json({ status: "ok", records });
  });
}

describe("normalisePmcId", () => {
  it("canonicalises case and whitespace", () => {
    expect(normalisePmcId("pmc12638941")).toBe("PMC12638941");
    expect(normalisePmcId(" PMC1234567 ")).toBe("PMC1234567");
  });

  it("rejects non-PMC input", () => {
    expect(normalisePmcId("12638941")).toBeNull();
    expect(normalisePmcId("PMID: 41271795")).toBeNull();
    expect(normalisePmcId("10.1234/x")).toBeNull();
    expect(normalisePmcId(null)).toBeNull();
  });
});

describe("normalisePmid", () => {
  it("accepts bare digits, a PMID: prefix and the numbers NCBI returns", () => {
    expect(normalisePmid("41271795")).toBe("41271795");
    expect(normalisePmid("PMID: 41271795")).toBe("41271795");
    expect(normalisePmid(41271795)).toBe("41271795");
  });

  it("rejects non-PMID input", () => {
    expect(normalisePmid("PMC12638941")).toBeNull();
    expect(normalisePmid("10.1234/x")).toBeNull();
    expect(normalisePmid(null)).toBeNull();
  });
});

describe("resolvePmcIds", () => {
  beforeEach(() => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockClear();
    _resetPmcCacheForTesting();
  });

  it("maps ids to normalised DOIs", async () => {
    server.use(respondWith([
      { doi: "10.1038/S41531-025-01179-6", pmcid: "PMC12638941", "requested-id": "PMC12638941" },
    ]));

    const result = await resolvePmcIds(["pmc12638941"]);
    expect(result.get("PMC12638941")).toBe("10.1038/s41531-025-01179-6");
  });

  it("maps an id NCBI has no record for to null", async () => {
    server.use(respondWith([
      { pmcid: "PMC99999999", "requested-id": "PMC99999999", status: "error" },
    ]));

    const result = await resolvePmcIds(["PMC99999999"]);
    expect(result.get("PMC99999999")).toBeNull();
  });

  it("maps a record with no DOI to null", async () => {
    server.use(respondWith([{ pmcid: "PMC13900", "requested-id": "PMC13900" }]));

    const result = await resolvePmcIds(["PMC13900"]);
    expect(result.get("PMC13900")).toBeNull();
  });

  it("skips ids that are not PMC ids", async () => {
    let called = false;
    server.use(http.get(IDCONV_URL, () => {
      called = true;
      return HttpResponse.json({ records: [] });
    }));

    const result = await resolvePmcIds(["41271795", "10.1234/x"]);
    expect(result.size).toBe(0);
    expect(called).toBe(false);
  });

  it("de-duplicates ids before querying", async () => {
    const seenIds: string[][] = [];
    server.use(respondWith(
      [{ doi: "10.1234/a", pmcid: "PMC1234567", "requested-id": "PMC1234567" }],
      seenIds
    ));

    await resolvePmcIds(["PMC1234567", "pmc1234567", " PMC1234567 "]);
    expect(seenIds).toEqual([["PMC1234567"]]);
  });

  it("chunks requests at NCBI's 200-id limit", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `PMC${1000000 + i}`);
    const seenIds: string[][] = [];
    server.use(http.get(IDCONV_URL, ({ request }) => {
      const batch = (new URL(request.url).searchParams.get("ids") ?? "").split(",");
      seenIds.push(batch);
      return HttpResponse.json({
        records: batch.map((id) => ({ doi: `10.1234/${id}`, "requested-id": id })),
      });
    }));

    const result = await resolvePmcIds(ids);
    expect(seenIds.map((batch) => batch.length)).toEqual([200, 1]);
    expect(result.size).toBe(201);
    expect(result.get("PMC1000200")).toBe("10.1234/pmc1000200");
  });

  it("leaves ids unresolved when the request fails", async () => {
    server.use(http.get(IDCONV_URL, () => new HttpResponse(null, { status: 503 })));

    const result = await resolvePmcIds(["PMC12638941"]);
    expect(result.has("PMC12638941")).toBe(false);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("caches resolved ids and reuses them without a second request", async () => {
    let requests = 0;
    server.use(http.get(IDCONV_URL, () => {
      requests++;
      return HttpResponse.json({
        records: [{ doi: "10.1234/a", pmcid: "PMC1234567", "requested-id": "PMC1234567" }],
      });
    }));

    await resolvePmcIds(["PMC1234567"]);
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        flora_pmc_blob: expect.objectContaining({
          PMC1234567: expect.objectContaining({ v: { doi: "10.1234/a" }, t: expect.any(Number) }),
        }),
      })
    );

    const cached = await resolvePmcIds(["PMC1234567"]);
    expect(cached.get("PMC1234567")).toBe("10.1234/a");
    expect(requests).toBe(1);
  });

  it("asks the converter with idtype=pmid and keys results by the bare PMID", async () => {
    let params: URLSearchParams | null = null;
    server.use(http.get(IDCONV_URL, ({ request }) => {
      params = new URL(request.url).searchParams;
      return HttpResponse.json({
        records: [
          { doi: "10.3389/FPSYG.2026.1748888", pmcid: "PMC13414199", pmid: 42528595, "requested-id": "42528595" },
          { pmid: 9599441, "requested-id": "9599441", status: "error" },
        ],
      });
    }));

    const result = await resolvePmcIds(["42528595", "9599441"], "pmid");
    expect(params!.get("idtype")).toBe("pmid");
    expect(result.get("42528595")).toBe("10.3389/fpsyg.2026.1748888");
    expect(result.get("9599441")).toBeNull();
  });

  it("sends the configured email and tool for NCBI's usage policy", async () => {
    let params: URLSearchParams | null = null;
    server.use(http.get(IDCONV_URL, ({ request }) => {
      params = new URL(request.url).searchParams;
      return HttpResponse.json({ records: [] });
    }));

    await resolvePmcIds(["PMC1234567"]);
    expect(params!.get("email")).toBe("test@example.com");
    expect(params!.get("tool")).toBe("flora");
    expect(params!.get("idtype")).toBe("pmcid");
    expect(params!.get("format")).toBe("json");
  });
});
