import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createIndicatorPill,
  PAGE_PROVENANCE,
  SEARCH_PROVENANCE,
} from "../../src/shared/indicator-pill";
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

  it("opens the best-ranked free copy on a click, with the rest a chevron away", async () => {
    // Picking from a list is a tax on the common case: the first copy is the
    // one the reader wants nearly every time. The others stay one click away
    // for when it turns out to be dead or the wrong version.
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
      expect(pill.querySelector("a[data-flora-oa-primary]")).not.toBeNull()
    );
    const primary = pill.querySelector<HTMLAnchorElement>("a[data-flora-oa-primary]")!;
    expect(primary.href).toBe("https://publisher.example/a.pdf");
    expect(primary.target).toBe("_blank");

    const list = pill.querySelector<HTMLElement>("[data-flora-oa-row] > div:last-child")!;
    expect(list.style.display).toBe("none");

    pill.querySelector<HTMLElement>("[data-flora-oa-choices]")!.click();

    expect(list.style.display).toBe("flex");
    expect([...list.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "https://publisher.example/a.pdf",
      "https://osf.example/a",
      "https://repo.example/a.pdf",
    ]);
  });

  it("keeps the chevron from navigating the row it sits in", async () => {
    // The toggle is a sibling of the <a>, not a child — nested, one click would
    // both open the tab and expand the list.
    const pill = createIndicatorPill({
      doi: "10.1234/x" as DoiString,
      oaStatus: Promise.resolve({
        isOa: true,
        url: "https://publisher.example/a.pdf",
        locations: [
          { url: "https://publisher.example/a.pdf", label: "Publisher", version: "published", isPdf: true },
          { url: "https://osf.example/a", label: "OSF", version: "submitted", isPdf: false },
        ],
      }),
    });

    await vi.waitFor(() =>
      expect(pill.querySelector("[data-flora-oa-choices]")).not.toBeNull()
    );
    expect(pill.querySelector("[data-flora-oa-choices]")!.closest("a")).toBeNull();
  });

  it("marks provenance on the popover's DOI by underline, not in words", () => {
    // The DOI row is one line; a provenance sentence beside it is the line the
    // DOI itself needs. The reason stays reachable on hover.
    const doiText = (isAugmented: boolean) =>
      build(isAugmented).querySelector<HTMLElement>("[data-flora-doi-text]")!;

    expect(doiText(false).style.textDecoration).not.toContain("underline");
    expect(doiText(false).title).toBe(PAGE_PROVENANCE);
    expect(doiText(true).style.textDecoration).toContain("underline dotted");
    expect(doiText(true).title).toBe(SEARCH_PROVENANCE);

    expect(build(false).textContent).not.toContain(PAGE_PROVENANCE);
    expect(build(true).textContent).not.toContain(SEARCH_PROVENANCE);
  });

  it("names the search, not just the title, on an unconfirmed DOI", () => {
    expect(SEARCH_PROVENANCE).toContain("Matched by search");
    expect(SEARCH_PROVENANCE).toContain("first author");
    expect(SEARCH_PROVENANCE).toContain("year");
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
