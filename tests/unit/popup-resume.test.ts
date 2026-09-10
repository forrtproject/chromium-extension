import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const POPUP_DIR = join(__dirname, "..", "..", "src", "popup");
const SNOOZE_KEY = "flora_snoozed_domains";

let localStore: Record<string, unknown> = {};

function backStorage(area: "local" | "sync", store: Record<string, unknown>): void {
  chrome.storage[area].get = vi.fn((keys: string | string[]) => {
    const names = typeof keys === "string" ? [keys] : keys;
    const out: Record<string, unknown> = {};
    for (const name of names) {
      if (name in store) out[name] = store[name];
    }
    return Promise.resolve(out);
  }) as unknown as typeof chrome.storage.local.get;
  chrome.storage[area].set = vi.fn((items: Record<string, unknown>) => {
    Object.assign(store, items);
    return Promise.resolve();
  }) as unknown as typeof chrome.storage.local.set;
}

async function openPopup(): Promise<HTMLElement> {
  const html = readFileSync(join(POPUP_DIR, "popup.html"), "utf-8");
  document.body.innerHTML = new DOMParser()
    .parseFromString(html, "text/html").body.innerHTML;
  await import("../../src/popup/popup");
  await vi.waitFor(() =>
    expect(document.getElementById("current-domain")!.textContent).toBe("paused.example")
  );
  return document.getElementById("resume-btn")!;
}

describe("the popup's resume button", () => {
  beforeEach(() => {
    localStore = {};
    backStorage("local", localStore);
    backStorage("sync", {});
    chrome.runtime.getManifest = vi.fn(() => ({version: "0.0.0"})) as never;
    chrome.tabs.query = vi.fn().mockResolvedValue([{id: 1, url: "https://paused.example/a"}]);
    chrome.tabs.sendMessage = vi.fn().mockRejectedValue(new Error("no content script"));
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("stays hidden on a domain that is not paused", async () => {
    expect((await openPopup()).hidden).toBe(true);
  });

  it("stays hidden once a pause has expired", async () => {
    localStore[SNOOZE_KEY] = {"paused.example": Date.now() - 1000};

    expect((await openPopup()).hidden).toBe(true);
  });

  it("appears while the domain is paused", async () => {
    localStore[SNOOZE_KEY] = {"paused.example": Date.now() + 60_000};

    const resume = await openPopup();

    await vi.waitFor(() => expect(resume.hidden).toBe(false));
    expect(document.getElementById("snooze-note")!.hidden).toBe(false);
  });

  it("hides itself again the moment the pause is lifted", async () => {
    localStore[SNOOZE_KEY] = {"paused.example": Date.now() + 60_000};
    const resume = await openPopup();
    await vi.waitFor(() => expect(resume.hidden).toBe(false));

    resume.click();

    await vi.waitFor(() => expect(resume.hidden).toBe(true));
    expect(localStore[SNOOZE_KEY]).toEqual({});
  });

  it("keeps [hidden] winning over any rule that sets display", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(join(POPUP_DIR, "popup.css"), "utf-8");
    document.head.appendChild(style);

    const hides = [...style.sheet!.cssRules].some(
      (rule) =>
        rule instanceof CSSStyleRule &&
        rule.selectorText.split(",").some((s) => s.trim() === "[hidden]") &&
        rule.style.display === "none" &&
        rule.style.getPropertyPriority("display") === "important"
    );

    expect(hides, "no [hidden] rule strong enough to beat a display declaration").toBe(true);
    style.remove();
  });

  it("ships the debug-only log-copy row hidden", () => {
    const markup = new DOMParser()
      .parseFromString(readFileSync(join(POPUP_DIR, "popup.html"), "utf-8"), "text/html");
    const shipped = [...markup.querySelectorAll("[hidden]")].map((el) => el.id);

    expect(shipped).toContain("log-copy-row");
    expect(shipped).toContain("snooze-note");
  });
});
