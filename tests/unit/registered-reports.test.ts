import { describe, it, expect, vi, afterEach } from "vitest";
import { buildRegisteredReportMap, itemDoi, stageOf, type ZoteroItem } from "../../registered-reports-updater";
import { createIndicatorPanel, updateIndicatorPillBadges } from "../../src/shared/indicator-pill";
import type { DoiString, LookupState, RetractionResponse } from "../../src/shared/types";

function item(key: string, data: Partial<ZoteroItem["data"]> & { tags?: string[] }): ZoteroItem {
  return { key, data: { key, ...data, tags: (data.tags ?? []).map((tag) => ({ tag })) } };
}

const relation = (key: string) => ({ "dc:relation": `http://zotero.org/groups/5937153/items/${key}` });

describe("registered reports updater", () => {
  it("reads stages the way RRDB does", () => {
    expect(stageOf(["Stage 2 Manuscript", "RSOS"])).toBe(2);
    expect(stageOf(["Stage 1 Linked"])).toBe(2);
    expect(stageOf(["Stage 1 Not Found"])).toBe(2);
    expect(stageOf(["Stage 1 Manuscript"])).toBe(1);
    expect(stageOf(["JMIR: Registered"])).toBeNull();
  });

  it("takes the DOI from the DOI field, falling back to a DOI URL", () => {
    expect(itemDoi({ key: "A", DOI: "https://doi.org/10.1098/RSOS.231805" })).toBe("10.1098/rsos.231805");
    expect(itemDoi({ key: "A", url: "https://royalsocietypublishing.org/doi/10.1098/rsos.180191" })).toBe("10.1098/rsos.180191");
    expect(itemDoi({ key: "A", url: "https://osf.io/24v9k" })).toBeNull();
  });

  it("links each stage to its companion and prefers the tagged copy of a duplicate", () => {
    const map = buildRegisteredReportMap([
      item("S2", { DOI: "10.1098/rsos.250508", tags: ["Stage 2 Manuscript", "Stage 1 Linked"], relations: relation("S1") }),
      item("S1", { url: "https://osf.io/abcde", tags: ["Stage 1 Manuscript"], relations: relation("S2") }),
      item("DUP", { DOI: "10.1098/rsos.250508" }),
      item("P1", { DOI: "10.5555/protocol", tags: ["Stage 1 Manuscript"], relations: relation("R2") }),
      item("R2", { DOI: "10.5555/report", tags: ["Stage 2 Manuscript"] }),
      item("NOT", { DOI: "10.5555/not", tags: ["Not an RR"] }),
    ]);
    expect(map.reports["10.1098/rsos.250508"]).toEqual({ key: "S2", stage: 2, linked: "https://osf.io/abcde" });
    expect(map.reports["10.5555/protocol"]).toEqual({ key: "P1", stage: 1, linked: "https://doi.org/10.5555/report" });
    expect(map.reports["10.5555/not"]).toBeUndefined();
  });
});

describe("Registered Report row", () => {
  afterEach(() => {
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    document.body.innerHTML = "";
  });

  function answerRrChecks(results: Record<string, unknown>, error?: string): void {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (message: { type?: string }) =>
      message?.type === "FLORA_RR_CHECK"
        ? { type: "FLORA_RR_CHECK_RESULT", results, error }
        : new Promise(() => {}));
  }

  it("sits directly under the replication row and links a Stage 2 report to its protocol", async () => {
    const doi = "10.5555/rr-stage2" as DoiString;
    answerRrChecks({ [doi]: { key: "S2", stage: 2, linked: "https://osf.io/abcde" } });
    const panel = createIndicatorPanel({ doi });
    const badge = panel.querySelector("[data-flora-badge-row]")!;
    expect(badge.nextElementSibling?.hasAttribute("data-flora-rr-row")).toBe(true);
    await vi.waitFor(() => expect(panel.querySelector<HTMLAnchorElement>("a[data-flora-rr-row]")?.href).toBe("https://osf.io/abcde"));
    expect(panel.querySelector("[data-flora-rr-row]")!.textContent).toContain("Stage 2");
  });

  it("keeps a retraction notice below the Registered Report row", async () => {
    const doi = "10.5555/rr-retracted" as DoiString;
    answerRrChecks({});
    const panel = createIndicatorPanel({ doi });
    document.body.appendChild(panel);
    await vi.waitFor(() => expect(panel.querySelector("[data-flora-rr-row]")!.textContent).toContain("None"));
    const notice: RetractionResponse = { originDoi: doi, doi: "10.5555/notice" as DoiString, kind: "retraction" };
    updateIndicatorPillBadges(document, new Map<DoiString, LookupState>(), () => [notice], "panels", undefined, { generation: () => 1 });
    expect(panel.querySelector("[data-flora-rr-row]")!.nextElementSibling?.hasAttribute("data-flora-notice-row")).toBe(true);
  });

  it("offers a retry when the worker cannot answer", async () => {
    const doi = "10.5555/rr-retry" as DoiString;
    answerRrChecks({}, "Registered Reports data unavailable");
    const panel = createIndicatorPanel({ doi });
    document.body.appendChild(panel);
    await vi.waitFor(() => expect(panel.querySelector("[data-flora-rr-row] button")).not.toBeNull());
    answerRrChecks({ [doi]: { key: "K1", stage: null } });
    panel.querySelector<HTMLButtonElement>("[data-flora-rr-row] button")!.click();
    await vi.waitFor(() => expect(panel.querySelector<HTMLAnchorElement>("a[data-flora-rr-row]")?.href)
      .toBe("https://www.zotero.org/groups/5937153/registered_reports/items/K1"));
  });
});
