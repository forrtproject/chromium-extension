import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import type {PageFindings, PageStateResponse} from "../../src/shared/messages";

const POPUP_DIR = join(__dirname, "..", "..", "src", "popup");

function backStorage(area: "local" | "sync"): void {
  chrome.storage[area].get = vi.fn(() => Promise.resolve({})) as unknown as typeof chrome.storage.local.get;
  chrome.storage[area].set = vi.fn(() => Promise.resolve()) as unknown as typeof chrome.storage.local.set;
}

async function openPopup(url = "https://journal.example/article"): Promise<void> {
  chrome.tabs.query = vi.fn().mockResolvedValue([{id: 7, url}]);
  const html = readFileSync(join(POPUP_DIR, "popup.html"), "utf-8");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  await import("../../src/popup/popup");
  await vi.waitFor(() => expect(document.getElementById("current-domain")!.textContent).not.toBe(""));
}

const findings = (over: Partial<PageFindings> = {}): PageFindings => ({
  checking: false,
  article: {retracted: false, concern: false, replications: 3, reproductions: 0, originals: 0, pubpeerComments: 2, incomplete: false},
  others: {papers: 28, checked: 28, unavailable: 0, retracted: 1, concern: 0, replications: 4, pubpeer: 0},
  panel: true,
  ...over,
});

function answer(response: PageStateResponse | Error): void {
  chrome.tabs.sendMessage = vi.fn((_tab: number, msg: {type: string}) => {
    if (msg.type === "FLORA_OPEN_PANEL") return Promise.resolve({opened: true});
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  }) as never;
}

const summary = () => document.getElementById("page-findings")!;

async function stateAnswered(): Promise<void> {
  const send = vi.mocked(chrome.tabs.sendMessage);
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith(7, {type: "FLORA_GET_STATE"}));
  const call = send.mock.calls.findIndex(([, msg]) => (msg as {type: string}).type === "FLORA_GET_STATE");
  await Promise.resolve(send.mock.results[call].value).catch(() => {});
  await new Promise((r) => setTimeout(r, 0));
}

describe("the popup's findings summary", () => {
  beforeEach(() => {
    backStorage("local");
    backStorage("sync");
    chrome.runtime.getManifest = vi.fn(() => ({version: "0.0.0"})) as never;
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("summarises the article and its references, with a button to open the report", async () => {
    answer({hidden: false, findings: findings()});
    await openPopup();
    await vi.waitFor(() => expect(summary().hidden).toBe(false));
    expect(summary().textContent).toContain("This article");
    expect(summary().textContent).toContain("3 replication studies · 2 PubPeer comments");
    expect(summary().textContent).toContain("References");
    expect(summary().textContent).toContain("28 checked · 1 retracted · 4 with replication studies");
    const open = document.getElementById("open-report-btn")!;
    expect(open.hidden).toBe(false);
    window.close = vi.fn();
    open.click();
    await vi.waitFor(() => expect(window.close).toHaveBeenCalled());
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {type: "FLORA_OPEN_PANEL"});
  });

  it("counts every paper on a page without an article", async () => {
    answer({hidden: false, findings: findings({article: undefined, panel: false,
      others: {papers: 5, checked: 5, unavailable: 0, retracted: 0, concern: 0, replications: 0, pubpeer: 2}})});
    await openPopup();
    await vi.waitFor(() => expect(summary().hidden).toBe(false));
    expect(summary().textContent).toContain("On this page");
    expect(summary().textContent).toContain("5 checked · 2 discussed on PubPeer");
    expect(document.getElementById("open-report-btn")!.hidden).toBe(true);
  });

  it("summarises a search results page", async () => {
    answer({hidden: false, results: {papers: 10, flagged: 2, incomplete: false}});
    await openPopup("https://scholar.google.com/scholar?q=x");
    await vi.waitFor(() => expect(summary().hidden).toBe(false));
    expect(summary().textContent).toContain("10 checked · 2 with findings");
  });

  it("stays hidden on a page with no papers, on a hidden page, and where ORE isn't running", async () => {
    answer({hidden: false, findings: findings({article: undefined,
      others: {papers: 0, checked: 0, unavailable: 0, retracted: 0, concern: 0, replications: 0, pubpeer: 0}})});
    await openPopup();
    await stateAnswered();
    expect(summary().hidden).toBe(true);

    vi.resetModules();
    answer({hidden: true, findings: findings()});
    await openPopup();
    await vi.waitFor(() => expect(document.getElementById("hide-btn-label")!.textContent).toBe("Show on this page"));
    expect(summary().hidden).toBe(true);

    vi.resetModules();
    answer(new Error("no content script"));
    await openPopup();
    await stateAnswered();
    expect(summary().hidden).toBe(true);
  });

  it("stays hidden on internal pages", async () => {
    answer({hidden: false, findings: findings()});
    await openPopup("chrome://extensions");
    expect(document.getElementById("current-domain")!.textContent).toBe("Internal page");
    await new Promise((r) => setTimeout(r, 20));
    expect(summary().hidden).toBe(true);
  });

  it("says when checks failed instead of claiming there are no findings", async () => {
    answer({hidden: false, findings: findings({
      article: {retracted: false, concern: false, replications: 0, reproductions: 0, originals: 0, pubpeerComments: 0, incomplete: true},
      others: {papers: 5, checked: 5, unavailable: 2, retracted: 0, concern: 0, replications: 0, pubpeer: 0},
    })});
    await openPopup();
    await vi.waitFor(() => expect(summary().hidden).toBe(false));
    expect(summary().textContent).toContain("some checks unavailable");
    expect(summary().textContent).not.toContain("No replications");
    expect(summary().textContent).toContain("5 checked · 2 not fully checked");
    expect(summary().textContent).not.toContain("no findings");
  });

  it("names reproductions and replicated originals for the article", async () => {
    answer({hidden: false, findings: findings({
      article: {retracted: false, concern: false, replications: 0, reproductions: 1, originals: 2, pubpeerComments: 0, incomplete: false},
    })});
    await openPopup();
    await vi.waitFor(() => expect(summary().hidden).toBe(false));
    expect(summary().textContent).toContain("1 reproduction · Replicates 2 original studies");
  });

  it("keeps asking a search page that is still checking, and only then says no findings", async () => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    try {
      answer({hidden: false, results: {papers: 4, flagged: 0, incomplete: false, checking: true}});
      await openPopup("https://scholar.google.com/scholar?q=x");
      await vi.waitFor(() => expect(summary().textContent).toContain("Checking 4…"));
      expect(summary().textContent).not.toContain("no findings");
      answer({hidden: false, results: {papers: 4, flagged: 0, incomplete: false, checking: false}});
      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() => expect(summary().textContent).toContain("4 checked · no findings"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the page again after showing ORE", async () => {
    answer({hidden: true, findings: findings({panel: false})});
    await openPopup();
    await vi.waitFor(() => expect(document.getElementById("hide-btn-label")!.textContent).toBe("Show on this page"));
    answer({hidden: false, findings: findings()});
    document.getElementById("hide-btn")!.click();
    await vi.waitFor(() => expect(document.getElementById("open-report-btn")!.hidden).toBe(false));
  });
});
