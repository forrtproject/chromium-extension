import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/shared/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({
    email: "test@example.com",
    cacheQuotaMb: 50,
  }),
  isSetupComplete: vi.fn().mockResolvedValue(true),
}));

import { resolveReferenceDois } from "../../src/content-general/references";
import { beginDomScanPass } from "../../src/shared/doi-extractor";

const PMC_DOI = "10.1038/s41531-025-01179-6";

function loadReferences(inner: string): void {
  document.documentElement.innerHTML = `<head></head><body>
    <ol class="references">${inner}</ol>
  </body>`;
  beginDomScanPass();
}

/** Records every message the content script sends to the service worker. */
function stubWorker(): {
  sent: Array<{ type: string; pmcids?: string[]; requests?: unknown[] }>;
} {
  const sent: Array<{ type: string; pmcids?: string[]; requests?: unknown[] }> = [];
  (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
    async (message: { type: string; pmcids?: string[] }) => {
      sent.push(message);
      if (message.type === "FLORA_PMC_RESOLVE") {
        return {
          type: "FLORA_PMC_RESOLVE_RESULT",
          results: Object.fromEntries((message.pmcids ?? []).map((id) => [id, PMC_DOI])),
        };
      }
      if (message.type === "FLORA_AUGMENT") {
        return { type: "FLORA_AUGMENT_RESULT", results: {} };
      }
      return undefined;
    }
  );
  return { sent };
}

describe("resolveReferenceDois — PMC-only entries", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockReset();
    document.documentElement.innerHTML = "";
  });

  it("resolves a cited PMC id to a DOI and marks its provenance", async () => {
    const { sent } = stubWorker();
    loadReferences(`
      <li>Smith J. Title one. Journal. 2025. PMCID: PMC12638941.</li>
      <li>Jones K. Title two. Journal. 2021. PMCID: PMC1234567.</li>
    `);

    const resolved = await resolveReferenceDois();

    expect(sent.filter((m) => m.type === "FLORA_PMC_RESOLVE")).toHaveLength(1);
    expect(sent[0].pmcids).toEqual(["PMC12638941", "PMC1234567"]);
    expect(resolved).toHaveLength(2);
    for (const r of resolved) {
      expect(r.doi).toBe(PMC_DOI);
      expect(r.mode).toBe("pmc");
    }
  });

  it("does not send PMC-only entries to title augmentation", async () => {
    const { sent } = stubWorker();
    loadReferences(`
      <li>Smith J. Title one. Journal. 2025. PMCID: PMC12638941.</li>
      <li>Jones K. Title two with no identifier at all. Journal. 2021.</li>
    `);

    await resolveReferenceDois();

    const augment = sent.find((m) => m.type === "FLORA_AUGMENT");
    expect(augment?.requests).toEqual([
      expect.objectContaining({ title: expect.stringContaining("Title two") }),
    ]);
  });

  it("resolves a PMC id even when the entry has no publication year", async () => {
    stubWorker();
    loadReferences(`
      <li>Smith J. Untitled preprint. PMCID: PMC12638941.</li>
      <li>Jones K. Another untitled preprint record here.</li>
    `);

    const resolved = await resolveReferenceDois();

    expect(resolved).toHaveLength(1);
    expect(resolved[0].mode).toBe("pmc");
  });

  it("skips doi.org validation for a PMC-mapped DOI", async () => {
    stubWorker();
    loadReferences(`
      <li>Smith J. Title one. Journal. 2025. PMCID: PMC12638941.</li>
      <li>Jones K. Title two. Journal. 2021. PMCID: PMC1234567.</li>
    `);

    await resolveReferenceDois();

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.filter(([url]) => String(url).includes("doi.org/api/handles"))).toHaveLength(0);
  });

  it("drops the entry when NCBI has no DOI for the id", async () => {
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (message: { type: string; pmcids?: string[] }) => {
        if (message.type === "FLORA_PMC_RESOLVE") {
          return {
            type: "FLORA_PMC_RESOLVE_RESULT",
            results: { PMC12638941: null, PMC1234567: null },
          };
        }
        return { type: "FLORA_AUGMENT_RESULT", results: {} };
      }
    );
    loadReferences(`
      <li>Smith J. Title one. Journal. 2025. PMCID: PMC12638941.</li>
      <li>Jones K. Title two. Journal. 2021. PMCID: PMC1234567.</li>
    `);

    expect(await resolveReferenceDois()).toEqual([]);
  });
});
