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

  it("offers the durations only after the snooze button is clicked", async () => {
    await openPopup();
    const snooze = document.getElementById("snooze-btn")!;
    const options = document.getElementById("snooze-options")!;

    expect(options.hidden, "the durations stay out of the way until asked for").toBe(true);
    expect(snooze.getAttribute("aria-expanded")).toBe("false");

    snooze.click();

    expect(options.hidden).toBe(false);
    expect(snooze.getAttribute("aria-expanded")).toBe("true");
    expect([...options.querySelectorAll("button")].map((b) => b.textContent))
      .toEqual(["15 minutes", "1 hour", "Until tomorrow"]);
  });

  it("snoozes the domain for the duration picked", async () => {
    const resume = await openPopup();
    document.getElementById("snooze-btn")!.click();

    const hour = [...document.querySelectorAll<HTMLButtonElement>(".popup-snooze-choice")]
      .find((b) => b.textContent === "1 hour")!;
    hour.click();

    await vi.waitFor(() => expect(resume.hidden).toBe(false));
    const until = (localStore[SNOOZE_KEY] as Record<string, number>)["paused.example"];
    expect(until - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(until - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    expect(document.getElementById("snooze-note")!.hidden).toBe(false);
  });

  it("swaps the snooze button for resume while it is snoozed", async () => {
    localStore[SNOOZE_KEY] = {"paused.example": Date.now() + 60_000};
    const resume = await openPopup();

    await vi.waitFor(() => expect(resume.hidden).toBe(false));
    expect(document.getElementById("snooze-btn")!.hidden,
      "no point offering a second snooze").toBe(true);

    resume.click();

    await vi.waitFor(() => expect(document.getElementById("snooze-btn")!.hidden).toBe(false));
  });

  it("tells the worker to badge the tab as snoozed, and to clear it on resume", async () => {
    const seen: Array<{snoozedUntil?: number | null; tabId?: number}> = [];
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (m: unknown) => {
      const msg = m as {type?: string; snoozedUntil?: number | null; tabId?: number};
      if (msg.type === "FLORA_ACTIVE_STATE") seen.push(msg);
      return undefined;
    });
    const resume = await openPopup();
    const sent = () => seen;

    document.getElementById("snooze-btn")!.click();
    document.querySelector<HTMLButtonElement>(".popup-snooze-choice")!.click();
    await vi.waitFor(() => expect(sent()).toHaveLength(1));

    expect(sent()[0].snoozedUntil).toBeGreaterThan(Date.now());
    expect(sent()[0].tabId, "the popup has no sender.tab, so it names the tab").toBe(1);

    await vi.waitFor(() => expect(resume.hidden).toBe(false));
    resume.click();
    await vi.waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()[1].snoozedUntil, "resume clears the badge").toBeNull();
  });

  it("does not let the page teardown wipe the badge it just set", async () => {
    const seen: Array<{snoozedUntil?: number | null}> = [];
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ok: true}));
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (m: unknown) => {
      const msg = m as {type?: string; snoozedUntil?: number | null};
      if (msg.type === "FLORA_ACTIVE_STATE") seen.push(msg);
      return undefined;
    });
    const resume = await openPopup();

    document.getElementById("snooze-btn")!.click();
    document.querySelector<HTMLButtonElement>(".popup-snooze-choice")!.click();
    await vi.waitFor(() => expect(resume.hidden).toBe(false));

    expect(seen.at(-1)!.snoozedUntil, "the last word must still be snoozed").toBeGreaterThan(Date.now());
  });

  it("offers nothing to snooze on a chrome:// page", async () => {
    (chrome.tabs.query as ReturnType<typeof vi.fn>)
      .mockResolvedValue([{id: 1, url: "chrome://extensions/"}]);
    const html = readFileSync(join(POPUP_DIR, "popup.html"), "utf-8");
    document.body.innerHTML = new DOMParser()
      .parseFromString(html, "text/html").body.innerHTML;
    await import("../../src/popup/popup");
    await vi.waitFor(() =>
      expect(document.getElementById("current-domain")!.textContent).toBe("Internal page")
    );

    expect(document.getElementById("snooze-btn")!.style.display,
      "ORE cannot run here, so there is nothing to pause").toBe("none");
    expect(document.getElementById("block-btn")!.style.display).toBe("none");
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
