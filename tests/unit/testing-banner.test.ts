import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const POPUP_DIR = join(__dirname, "..", "..", "src", "popup");

async function openPopup(): Promise<HTMLElement> {
  const html = readFileSync(join(POPUP_DIR, "popup.html"), "utf-8");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  await import("../../src/popup/popup");
  return document.getElementById("testing-banner")!;
}

describe("the popup's testing banner", () => {
  beforeEach(() => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({}) as never;
    chrome.storage.sync.get = vi.fn().mockResolvedValue({}) as never;
    chrome.runtime.getManifest = vi.fn(() => ({version: "0.0.0"})) as never;
    chrome.tabs.query = vi.fn().mockResolvedValue([{id: 1, url: "https://example.com/a"}]);
    chrome.tabs.sendMessage = vi.fn().mockRejectedValue(new Error("no content script"));
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("appears in a testing build", async () => {
    vi.stubGlobal("__ORE_TESTING_BUILD__", true);

    const banner = await openPopup();

    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("Testing version");
  });

  it("stays hidden in a stable build", async () => {
    vi.stubGlobal("__ORE_TESTING_BUILD__", false);

    expect((await openPopup()).hidden).toBe(true);
  });
});
