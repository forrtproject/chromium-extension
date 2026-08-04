import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createIndicatorPill } from "../../src/shared/indicator-pill";
import type { DoiString } from "../../src/shared/types";

// Provenance is signalled inside the pill, not by its colour.
describe("indicator pill provenance", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });
  afterEach(() => vi.unstubAllGlobals());

  const build = (isAugmented: boolean) =>
    createIndicatorPill({ doi: "10.1234/x" as DoiString, isAugmented });

  const background = (wrapper: HTMLElement) =>
    (wrapper.firstElementChild as HTMLElement).style.background;

  it("uses the same background for confirmed and unconfirmed DOIs", () => {
    expect(background(build(true))).toBe(background(build(false)));
  });

  it("underlines the unconfirmed DOI and omits the check", () => {
    const seg = build(true).querySelector("[data-flora-doi-segment]") as HTMLElement;
    expect(seg.style.textDecoration).toContain("underline");
    expect(seg.querySelector("svg")).toBeNull();
    expect(seg.textContent).toContain("DOI");
  });

  it("shows a check and no underline on a confirmed DOI", () => {
    const seg = build(false).querySelector("[data-flora-doi-segment]") as HTMLElement;
    expect(seg.style.textDecoration).not.toContain("underline");
    expect(seg.querySelector("svg")).not.toBeNull();
  });

  it("lists every free copy outright in the popover", async () => {
    // The popover has room the Scholar panel does not, so nothing is folded.
    const pill = createIndicatorPill({
      doi: "10.1234/x" as DoiString,
      oaStatus: Promise.resolve({
        isOa: true,
        url: "https://publisher.example/a.pdf",
        locations: [
          { url: "https://publisher.example/a.pdf", label: "Publisher", version: "published", isPdf: true },
          { url: "https://osf.example/a", label: "OSF", version: "submitted", isPdf: false },
          { url: "https://repo.example/a.pdf", label: "Repo Uni", version: "accepted", isPdf: true },
        ],
      }),
    });

    await vi.waitFor(() =>
      expect(pill.querySelector("[data-flora-oa-choices]")).not.toBeNull()
    );
    const list = pill.querySelector<HTMLElement>("[data-flora-oa-row] > div:last-child")!;
    expect(list.style.display).toBe("flex");
    expect([...list.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "https://publisher.example/a.pdf",
      "https://osf.example/a",
      "https://repo.example/a.pdf",
    ]);
  });

  it("marks provenance on the popover's DOI by underline, not in words", () => {
    // The DOI row is one line; a provenance sentence beside it is the line the
    // DOI itself needs. The reason stays reachable on hover.
    const doiText = (isAugmented: boolean) =>
      build(isAugmented).querySelector<HTMLElement>("[data-flora-doi-text]")!;

    expect(doiText(false).style.textDecoration).not.toContain("underline");
    expect(doiText(false).title).toBe("Found on this page");
    expect(doiText(true).style.textDecoration).toContain("underline dotted");
    expect(doiText(true).title).toBe("Matched by title");

    expect(build(false).textContent).not.toContain("Found on this page");
    expect(build(true).textContent).not.toContain("Matched by title");
  });

  it("carries a caller's own provenance label on the DOI's tooltip", () => {
    // References resolved from a cited PMC id say so — the underline alone
    // can't distinguish which lookup produced the DOI.
    const pill = createIndicatorPill({
      doi: "10.1234/x" as DoiString,
      provenanceLabel: "Matched by PMC ID",
    });
    expect(pill.querySelector<HTMLElement>("[data-flora-doi-text]")!.title)
      .toBe("Matched by PMC ID");
  });
});
