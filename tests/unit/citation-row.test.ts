import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createIndicatorPill, createIndicatorPanel} from "../../src/shared/indicator-pill";
import {_resetCitationCacheForTesting} from "../../src/shared/citation";
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

function citationCalls(): unknown[][] {
  return fetchMock.mock.calls.filter(([url]) => /crossref|doi\.org/.test(String(url)));
}

function acceptHeader(call: unknown[]): string {
  return ((call[1] as RequestInit).headers as Record<string, string>).Accept;
}

function citeBtn(host: HTMLElement): HTMLElement {
  return host.querySelector<HTMLElement>("[data-flora-citation-copy]")!;
}

function storedSettings(stored: Record<string, unknown>): void {
  (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({flora_settings: stored});
}

describe("cite action", () => {
  beforeEach(() => {
    _resetCitationCacheForTesting();
    stubFetch();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (await import("../../src/shared/settings"))._resetSettingsCacheForTesting();
    document.body.innerHTML = "";
  });

  it("is offered on both the pill's popover and the Scholar panel", () => {
    expect(citeBtn(createIndicatorPill({doi: DOI}))).not.toBeNull();
    expect(citeBtn(createIndicatorPanel({doi: DOI}))).not.toBeNull();
  });

  it("sits in the DOI row, not a row of its own", () => {
    const pill = createIndicatorPill({doi: DOI});
    // The action is an icon beside the DOI; a separate labelled row would
    // repeat what the quote glyph already says.
    expect(pill.querySelector("[data-flora-citation-row]")).toBeNull();
    expect(citeBtn(pill).textContent).toBe("");
    expect(citeBtn(pill).querySelector("svg")).not.toBeNull();
  });

  it("fetches nothing until the reader asks", async () => {
    // A references list injects one of these per entry; a citation lookup per
    // reference on page load would be dozens of requests nobody asked for.
    const pill = createIndicatorPill({doi: DOI});
    document.body.appendChild(pill);
    await vi.waitFor(() => expect(citeBtn(pill).title).toContain("APA"));
    expect(citationCalls()).toHaveLength(0);
  });

  it("copies the citation on a click, and says so", async () => {
    const pill = createIndicatorPill({doi: DOI});
    document.body.appendChild(pill);

    citeBtn(pill).click();

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(CITATION));
    expect(citationCalls()).toHaveLength(1);
    expect(citeBtn(pill).title).toBe("Copied");
  });

  it("offers copying and nothing else — the style is a settings decision", () => {
    const pill = createIndicatorPill({doi: DOI});
    expect(pill.querySelector("select")).toBeNull();
    expect(pill.querySelector("[data-flora-citation-text]")).toBeNull();
  });

  it("copies in the style the reader chose in settings", async () => {
    storedSettings({email: "a@b.co", citationStyle: "ieee"});
    const pill = createIndicatorPill({doi: DOI});
    document.body.appendChild(pill);
    await vi.waitFor(() => expect(citeBtn(pill).title).toContain("IEEE"));

    citeBtn(pill).click();

    await vi.waitFor(() => expect(citationCalls()).toHaveLength(1));
    expect(acceptHeader(citationCalls()[0])).toContain("style=ieee");
  });

  it("picks up a style changed in settings while the page stayed open", async () => {
    const pill = createIndicatorPill({doi: DOI});
    document.body.appendChild(pill);
    await vi.waitFor(() => expect(citeBtn(pill).title).toContain("APA"));

    // saveSettings from the options page invalidates the cached settings via the
    // storage.onChanged listener; the button must re-read rather than reuse APA.
    storedSettings({email: "a@b.co", citationStyle: "nature"});
    (await import("../../src/shared/settings"))._resetSettingsCacheForTesting();

    citeBtn(pill).click();

    await vi.waitFor(() => expect(citationCalls()).toHaveLength(1));
    expect(acceptHeader(citationCalls()[0])).toContain("style=nature");
  });

  it("says so when the citation can't be rendered", async () => {
    fetchMock.mockImplementation((url: string) =>
      /crossref|doi\.org/.test(url)
        ? Promise.reject(new Error("offline"))
        : new Promise<Response>(() => {})
    );
    const pill = createIndicatorPill({doi: DOI});
    document.body.appendChild(pill);

    citeBtn(pill).click();

    await vi.waitFor(() => expect(citeBtn(pill).title).toBe("Citation unavailable"));
    expect(writeText).not.toHaveBeenCalled();
  });
});
