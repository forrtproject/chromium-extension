import { describe, it, expect, beforeEach } from "vitest";
import { renderSheetsModal, removeSheetsModal } from "../../src/content-general/injector";
import type { DoiString, RetractionResponse } from "../../src/shared/types";
import { mockResult } from "../helpers";

const MODAL_ID = "flora-sheets-modal";

const modal = () => document.getElementById(MODAL_ID);

function withStats(replications: number, reproductions: number) {
  const base = mockResult();
  return {
    doi: "10.1038/nature12373",
    result: mockResult({
      record: {
        ...base.record,
        stats: {
          ...base.record.stats,
          n_replications_total: replications,
          n_reproductions_total: reproductions,
        },
      },
    }),
  };
}

function notice(originDoi: string, kind: RetractionResponse["kind"]): RetractionResponse {
  return { originDoi: originDoi as DoiString, doi: `${originDoi}/notice`, kind };
}

describe("renderSheetsModal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("stays away when the sheet has nothing to report", () => {
    renderSheetsModal([], []);
    expect(modal()).toBeNull();

    renderSheetsModal([withStats(0, 0)], []);
    expect(modal()).toBeNull();
  });

  it("reports replication data as before", () => {
    renderSheetsModal([withStats(3, 2)], []);
    expect(modal()!.querySelector("[data-flora-repl-count]")!.textContent).toBe("3");
    expect(modal()!.querySelector("[data-flora-repro-count]")!.textContent).toBe("2");
  });

  it("opens for a retraction even when no paper in the sheet has replication data", () => {
    // The whole point: a retracted row would otherwise pass in silence.
    renderSheetsModal([], [notice("10.1/retracted", "retraction")]);

    expect(modal()).not.toBeNull();
    expect(modal()!.querySelector("[data-flora-modal-title]")!.textContent!.trim())
      .toBe("1 retracted paper in this sheet");
    expect(modal()!.querySelector("[data-flora-notices]")).not.toBeNull();
    expect(modal()!.textContent).toContain("10.1/retracted");
  });

  it("names retractions and concerns apart, leading with the retraction", () => {
    renderSheetsModal([], [
      notice("10.1/a", "concern"),
      notice("10.1/b", "retraction"),
    ]);

    const text = modal()!.textContent!;
    expect(text).toContain("Retracted");
    expect(text).toContain("Concern");
    expect(modal()!.querySelector("[data-flora-modal-title]")!.textContent!.trim())
      .toBe("1 retracted paper in this sheet");
  });

  it("headlines a concern when nothing is outright retracted", () => {
    renderSheetsModal([], [notice("10.1/a", "concern"), notice("10.1/b", "concern")]);
    expect(modal()!.querySelector("[data-flora-modal-title]")!.textContent!.trim())
      .toBe("2 papers with an expression of concern");
  });

  it("links each flagged paper to its notice", () => {
    renderSheetsModal([], [notice("10.1/a", "retraction")]);
    const link = modal()!.querySelector<HTMLAnchorElement>("[data-flora-notices] a")!;
    expect(link.href).toContain("doi.org");
    expect(link.href).toContain(encodeURIComponent("10.1/a/notice"));
  });

  it("carries both findings at once", () => {
    renderSheetsModal([withStats(4, 0)], [notice("10.1/a", "retraction")]);
    expect(modal()!.querySelector("[data-flora-repl-count]")!.textContent).toBe("4");
    expect(modal()!.querySelector("[data-flora-notices]")).not.toBeNull();
  });

  it("leaves an unchanged popup alone rather than replaying its entrance", () => {
    renderSheetsModal([withStats(3, 0)], [notice("10.1/a", "retraction")]);
    const first = modal();
    renderSheetsModal([withStats(3, 0)], [notice("10.1/a", "retraction")]);
    expect(modal()).toBe(first);

    renderSheetsModal([withStats(5, 0)], [notice("10.1/a", "retraction")]);
    expect(modal()).not.toBe(first);
  });

  it("closes once the sheet no longer has anything to report", () => {
    renderSheetsModal([], [notice("10.1/a", "retraction")]);
    expect(modal()).not.toBeNull();
    renderSheetsModal([], []);
    expect(modal()).toBeNull();
  });

  it("clears on removeSheetsModal", () => {
    renderSheetsModal([withStats(1, 0)], []);
    removeSheetsModal();
    expect(modal()).toBeNull();
  });
});
