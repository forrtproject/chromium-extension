import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createIndicatorPill} from "../../src/shared/indicator-pill";
import {_resetCitationCacheForTesting} from "../../src/shared/citation";
import {dismissToast} from "../../src/shared/toast";
import type {DoiString} from "../../src/shared/types";

const DOI = "10.1234/x" as DoiString;
const CITATION = "Ray, O. (2004). How the Mind Hurts and Heals the Body. American Psychologist.";

let fetchMock: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;

/** Citations resolve; the pill's own PubPeer lookup is left hanging. */
function stubFetch(): void {
  fetchMock = vi.fn((url: string) =>
    /crossref|doi\.org/.test(url)
      ? Promise.resolve({ok: true, status: 200, text: () => Promise.resolve(CITATION)} as unknown as Response)
      : new Promise<Response>(() => {})
  );
  vi.stubGlobal("fetch", fetchMock);
}

function toast(): HTMLElement | null {
  return document.getElementById("flora-action-toast");
}

function toastText(): string {
  return toast()?.textContent ?? "";
}

/** The copy-DOI button — its title flips to "Copied", so match on what it is not. */
function copyBtn(host: HTMLElement): HTMLElement {
  return host.querySelector<HTMLElement>("button:not([data-flora-citation-copy])")!;
}

function citeBtn(host: HTMLElement): HTMLElement {
  return host.querySelector<HTMLElement>("[data-flora-citation-copy]")!;
}

describe("copy confirmation toast", () => {
  beforeEach(() => {
    _resetCitationCacheForTesting();
    stubFetch();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    dismissToast();
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (await import("../../src/shared/settings"))._resetSettingsCacheForTesting();
    document.body.innerHTML = "";
  });

  it("shows nothing until an action is taken", () => {
    document.body.appendChild(createIndicatorPill({doi: DOI}));
    expect(toast()).toBeNull();
  });

  it("names the DOI it copied", async () => {
    const pill = createIndicatorPill({doi: DOI});
    document.body.appendChild(pill);

    copyBtn(pill).click();

    await vi.waitFor(() => expect(toastText()).toContain("DOI copied"));
    // The DOI itself, so a reader copying down a reference list can tell which
    // of several pills answered.
    expect(toastText()).toContain(DOI);
  });

  it("reports a failed DOI copy instead of confirming one that never happened", async () => {
    writeText.mockRejectedValue(new Error("blocked"));
    // The execCommand fallback is unavailable in jsdom; make its failure explicit.
    Object.defineProperty(document, "execCommand", {value: () => false, configurable: true});

    const pill = createIndicatorPill({doi: DOI});
    document.body.appendChild(pill);

    copyBtn(pill).click();

    await vi.waitFor(() => expect(toastText()).toContain("Couldn't copy"));
    // The button's optimistic check must not be left standing either.
    expect(copyBtn(pill).title).toBe("Copy DOI");
  });

  it("names the style when the citation lands", async () => {
    const pill = createIndicatorPill({doi: DOI});
    document.body.appendChild(pill);
    await vi.waitFor(() => expect(citeBtn(pill).title).toContain("APA"));

    citeBtn(pill).click();

    await vi.waitFor(() => expect(toastText()).toContain("APA citation copied"));
  });

  it("says it is fetching while the citation is in flight", async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation((url: string) =>
      /crossref|doi\.org/.test(url)
        ? new Promise<Response>((resolve) => { release = resolve; })
        : new Promise<Response>(() => {})
    );

    const pill = createIndicatorPill({doi: DOI});
    document.body.appendChild(pill);
    await vi.waitFor(() => expect(citeBtn(pill).title).toContain("APA"));

    citeBtn(pill).click();

    await vi.waitFor(() => expect(toastText()).toContain("Fetching"));

    release({ok: true, status: 200, text: () => Promise.resolve(CITATION)} as unknown as Response);
    // The pending toast never times out on its own — the result must replace it.
    await vi.waitFor(() => expect(toastText()).toContain("copied"));
  });

  it("replaces the pending toast when no service answers", async () => {
    fetchMock.mockImplementation((url: string) =>
      /crossref|doi\.org/.test(url)
        ? Promise.reject(new Error("offline"))
        : new Promise<Response>(() => {})
    );

    const pill = createIndicatorPill({doi: DOI});
    document.body.appendChild(pill);

    citeBtn(pill).click();

    await vi.waitFor(() => expect(toastText()).toContain("Couldn't reach Crossref"));
    expect(toastText()).not.toContain("Fetching");
  });

  it("reuses one toast rather than stacking them", async () => {
    const pill = createIndicatorPill({doi: DOI});
    document.body.appendChild(pill);

    copyBtn(pill).click();
    await vi.waitFor(() => expect(toastText()).toContain("DOI copied"));
    copyBtn(pill).click();
    await vi.waitFor(() => expect(toastText()).toContain("DOI copied"));

    expect(document.querySelectorAll("#flora-action-toast")).toHaveLength(1);
  });

  it("marks itself as FLoRA's own so the DOI scan skips its text", async () => {
    // The toast prints the DOI; without the marker the extractor would rescan
    // it as a page occurrence and the DOM listener would treat it as a change.
    const pill = createIndicatorPill({doi: DOI});
    document.body.appendChild(pill);

    copyBtn(pill).click();

    await vi.waitFor(() => expect(toast()).not.toBeNull());
    expect(toast()!.hasAttribute("data-flora-ui")).toBe(true);
  });
});
