import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/shared/pubpeer-api", () => ({
  lookupPubPeerForDoi: vi.fn(() => new Promise(() => {})),
}));

import { createIndicatorPill, updateIndicatorPillBadges } from "../../src/shared/indicator-pill";
import type { DoiString, LookupState } from "../../src/shared/types";

const DOI = "10.1234/x" as DoiString;
const ACCENT_FILL = "rgba(133, 57, 83, 0.78)";

function contrastWithWhiteText(css: string): number {
  const parts = css.match(/[\d.]+/g)!.map(Number);
  const alpha = parts.length > 3 ? parts[3] : 1;
  const lin = (c: number) => {
    const v = (alpha * c + (1 - alpha) * 255) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * lin(parts[0]) + 0.7152 * lin(parts[1]) + 0.0722 * lin(parts[2]);
  return 1.05 / (luminance + 0.05);
}

function strip(wrapper: HTMLElement): HTMLElement {
  return wrapper.querySelector<HTMLElement>("[data-flora-segments]")!;
}
function segments(wrapper: HTMLElement): HTMLElement[] {
  return [...strip(wrapper).querySelectorAll<HTMLElement>("[data-flora-segment]")];
}
function labelOf(seg: HTMLElement): string {
  return seg.querySelector("[data-flora-segment-label]")!.textContent ?? "";
}
function matchedState(replications: number): Map<DoiString, LookupState> {
  return new Map([[DOI, {
    status: "matched",
    source: "extracted",
    result: { record: { stats: { n_replications_total: replications, n_reproductions_total: 0 } } },
  } as unknown as LookupState]]);
}

describe("the pill's segment strip", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("names every indicator, present or not", () => {
    expect(segments(createIndicatorPill({ doi: DOI })).map(labelOf))
      .toEqual(["DOI", "OA", "PubPeer", "Reps"]);
  });

  it("fills a present segment and strikes an absent one through", () => {
    const [doi, oa] = segments(createIndicatorPill({ doi: DOI, replicationsCount: null }));

    expect(doi.hasAttribute("data-flora-present")).toBe(true);
    expect(doi.style.background).toBe(ACCENT_FILL);
    expect(doi.style.textDecoration).toBe("none");

    expect(oa.hasAttribute("data-flora-present")).toBe(false);
    expect(oa.style.background).toBe("transparent");
    expect(oa.style.textDecoration).toContain("line-through");
  });

  it("counts what is countable, and only on a present segment", () => {
    const withReps = segments(createIndicatorPill({ doi: DOI, replicationsCount: 3 })).at(-1)!;
    const without = segments(createIndicatorPill({ doi: DOI })).at(-1)!;

    expect(withReps.textContent).toBe("Reps3");
    expect(without.textContent).toBe("Reps");
  });

  it("spaces a lit/struck boundary wider than two struck segments", () => {
    const wrapper = createIndicatorPill({ doi: DOI, replicationsCount: 2 });
    const [doi, oa, pubpeer, badge] = segments(wrapper);

    expect(strip(wrapper).querySelectorAll("[data-flora-segment-divider]")).toHaveLength(0);
    expect(doi.style.marginLeft).toBe("0px");
    expect(oa.style.marginLeft).toBe("3px");
    expect(pubpeer.style.marginLeft).toBe("2px");
    expect(badge.style.marginLeft).toBe("3px");
  });

  it("hairlines between two lit segments once a lookup lands", async () => {
    const wrapper = createIndicatorPill({
      doi: DOI,
      oaStatus: Promise.resolve({ isOa: true, url: "https://example.com/a.pdf", locations: [] }),
    });

    await vi.waitFor(() =>
      expect(segments(wrapper)[1].hasAttribute("data-flora-present")).toBe(true)
    );
    expect(strip(wrapper).querySelectorAll("[data-flora-segment-divider]")).toHaveLength(1);
    expect(segments(wrapper)[1].style.marginLeft).toBe("0px");
  });

  it("rounds only the strip's ends", () => {
    const [doi, oa, , badge] = segments(createIndicatorPill({ doi: DOI }));

    expect(doi.style.borderRadius).toBe("9999px 4px 4px 9999px");
    expect(oa.style.borderRadius).toBe("0 0 0 0");
    expect(badge.style.borderRadius).toBe("0 9999px 9999px 0");
  });

  it("gives a notice its own alarm colour and label", () => {
    const noticed = (kind: "retraction" | "concern") =>
      segments(createIndicatorPill({
        doi: DOI,
        retraction: { originDoi: DOI, doi: "10.9/n" as DoiString, kind },
      })).at(-1)!;

    expect(labelOf(noticed("retraction"))).toBe("Retracted");
    expect(labelOf(noticed("concern"))).toBe("Concern");
    expect(noticed("retraction").style.background)
      .not.toBe(noticed("concern").style.background);
  });

  it("carries its white label at AA contrast on every lit fill", () => {
    const fills = [
      segments(createIndicatorPill({ doi: DOI })).at(0)!,
      segments(createIndicatorPill({
        doi: DOI, retraction: { originDoi: DOI, doi: "10.9/n" as DoiString, kind: "retraction" },
      })).at(-1)!,
      segments(createIndicatorPill({
        doi: DOI, retraction: { originDoi: DOI, doi: "10.9/n" as DoiString, kind: "concern" },
      })).at(-1)!,
    ].map((seg) => seg.style.background);

    for (const fill of fills) {
      expect(contrastWithWhiteText(fill), fill).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("redraws the strip when a later pass carries replication counts", () => {
    const wrapper = createIndicatorPill({ doi: DOI });
    document.body.appendChild(wrapper);

    updateIndicatorPillBadges(document, matchedState(4), []);

    const badge = segments(wrapper).at(-1)!;
    expect(badge.textContent).toBe("Reps4");
    expect(badge.style.background).toBe(ACCENT_FILL);
    expect(badge.style.marginLeft).toBe("3px");
  });
});
