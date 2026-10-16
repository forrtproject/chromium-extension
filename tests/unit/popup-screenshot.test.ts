import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const POPUP_HTML = readFileSync(join(__dirname, "..", "..", "src", "popup", "popup.html"), "utf-8");
const PAGE = {id: 7, windowId: 3, url: "https://osf.io/abc"};

async function openPopup(): Promise<void> {
    document.body.innerHTML = new DOMParser().parseFromString(POPUP_HTML, "text/html").body.innerHTML;
    expect(document.getElementById("screenshot-row")!.hidden, "hidden until the tab is known").toBe(true);
    await import("../../src/popup/popup");
    await vi.waitFor(() => expect(document.getElementById("current-domain")!.textContent).toBe("osf.io"));
}

async function reportWithScreenshot(): Promise<void> {
    await vi.waitFor(() => expect(document.getElementById("screenshot-row")!.hidden).toBe(false));
    (document.getElementById("screenshot-toggle") as HTMLInputElement).checked = true;
    document.getElementById("report-btn")!.click();
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());
}

describe("the popup's screenshot option", () => {
    let visibleTab: {id: number};

    beforeEach(() => {
        chrome.runtime.getManifest = vi.fn(() => ({version: "0.0.0"})) as never;
        chrome.tabs.get = vi.fn().mockResolvedValue(PAGE) as never;
        chrome.tabs.query = vi.fn(async (query: chrome.tabs.QueryInfo) =>
            query.currentWindow ? [PAGE] : query.windowId === PAGE.windowId ? [visibleTab] : []) as never;
        chrome.tabs.sendMessage = vi.fn().mockRejectedValue(new Error("no content script")) as never;
        chrome.tabs.captureVisibleTab = vi.fn().mockResolvedValue("data:image/png;base64,AAAA") as never;
        chrome.tabs.create = vi.fn() as never;
        vi.spyOn(window, "close").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
        history.replaceState(null, "", location.pathname);
        document.body.innerHTML = "";
    });

    it("captures the page when it is the visible tab", async () => {
        visibleTab = {id: PAGE.id};
        await openPopup();
        await reportWithScreenshot();
        expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(PAGE.windowId, {format: "png"});
    });

    it("skips the capture when the popup opened as a tab in front of the page", async () => {
        history.replaceState(null, "", `?tabId=${PAGE.id}`);
        visibleTab = {id: 99};
        await openPopup();
        await reportWithScreenshot();
        expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    });
});
