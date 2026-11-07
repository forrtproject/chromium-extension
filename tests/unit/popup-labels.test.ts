import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const POPUP_DIR = join(__dirname, "..", "..", "src", "popup");

let syncStore: Record<string, unknown> = {};

function backStorage(area: "local" | "sync", store: Record<string, unknown>): void {
  chrome.storage[area].get = vi.fn((keys: string | string[]) => {
    const names = typeof keys === "string" ? [keys] : keys;
    const out: Record<string, unknown> = {};
    for (const name of names) if (name in store) out[name] = store[name];
    return Promise.resolve(out);
  }) as unknown as typeof chrome.storage.local.get;
  chrome.storage[area].set = vi.fn((items: Record<string, unknown>) => {
    Object.assign(store, items);
    return Promise.resolve();
  }) as unknown as typeof chrome.storage.local.set;
}

async function openPopup(): Promise<void> {
  const html = readFileSync(join(POPUP_DIR, "popup.html"), "utf-8");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  await import("../../src/popup/popup");
  await vi.waitFor(() => expect(document.getElementById("current-domain")!.textContent).toBe("site.example"));
}

const text = (id: string) => document.getElementById(id)!.textContent;
const shown = (id: string) => !document.getElementById(id)!.hidden;

describe("the popup's action labels", () => {
  beforeEach(() => {
    syncStore = {};
    backStorage("local", {});
    backStorage("sync", syncStore);
    chrome.runtime.getManifest = vi.fn(() => ({version: "0.0.0"})) as never;
    chrome.tabs.query = vi.fn().mockResolvedValue([{id: 1, url: "https://site.example/a"}]);
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue({hidden: false});
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("say how long hiding and turning off last", async () => {
    await openPopup();
    await vi.waitFor(() => expect(text("block-btn-label")).toBe("Turn off on this site"));
    expect(shown("block-btn-sub")).toBe(true);
    expect(text("block-btn-sub")).toBe("Until you turn it back on");
    expect(text("hide-btn-label")).toBe("Hide on this page");
    expect(text("hide-btn-sub")).toBe("Until you reload it");
    expect(shown("hide-btn-sub")).toBe(true);
    expect(text("report-btn-label")).toBe("Report an issue");
  });

  it("offer the inverse action, without the duration note, once a site is turned off", async () => {
    syncStore.flora_blocked_domains = ["site.example"];
    await openPopup();
    await vi.waitFor(() => expect(text("block-btn-label")).toBe("Turn on for this site"));
    expect(shown("block-btn-sub")).toBe(false);
  });

  it("offer to show ORE again, without the duration note, on a hidden page", async () => {
    chrome.tabs.sendMessage = vi.fn().mockResolvedValue({hidden: true});
    await openPopup();
    await vi.waitFor(() => expect(text("hide-btn-label")).toBe("Show on this page"));
    expect(shown("hide-btn-sub")).toBe(false);
  });
});
