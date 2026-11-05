import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {TOUR_SAMPLE_URL} from "../../src/shared/tour-sample";

const POPUP_HTML = readFileSync(join(__dirname, "..", "..", "src", "popup", "popup.html"), "utf-8");
const SNOOZE_KEY = "flora_snoozed_domains";

let localStore: Record<string, unknown>;
let tourReply: () => Promise<unknown>;

async function openPopup(url = "https://example.org/article", tabId: number | undefined = 1): Promise<void> {
    chrome.tabs.query = vi.fn().mockResolvedValue([{id: tabId, url}]);
    document.body.innerHTML = new DOMParser().parseFromString(POPUP_HTML, "text/html").body.innerHTML;
    await import("../../src/popup/popup");
    await vi.waitFor(() => expect(document.getElementById("current-domain")!.textContent).not.toBe(""));
    await new Promise((resolve) => setTimeout(resolve));
}

const element = (id: string) => document.getElementById(id)!;
const helpTitle = () => element("tour-help-title").textContent;
const clickTour = () => element("page-tour-btn").click();

describe("the popup's page tour button", () => {
    beforeEach(() => {
        localStore = {};
        tourReply = async () => ({started: false});
        chrome.storage.local.get = vi.fn(async (keys: string | string[]) => {
            const out: Record<string, unknown> = {};
            for (const key of typeof keys === "string" ? [keys] : keys) if (key in localStore) out[key] = localStore[key];
            return out;
        }) as never;
        chrome.storage.local.set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(localStore, items); }) as never;
        chrome.storage.local.remove = vi.fn(async (key: string) => { delete localStore[key]; }) as never;
        chrome.storage.sync.get = vi.fn().mockResolvedValue({}) as never;
        chrome.runtime.getManifest = vi.fn(() => ({version: "0.0.0"})) as never;
        chrome.tabs.sendMessage = vi.fn((_tab: number, message: {type: string}) =>
            message.type === "FLORA_START_PAGE_TOUR" ? tourReply() : Promise.resolve({})) as never;
        chrome.tabs.create = vi.fn().mockResolvedValue({}) as never;
        chrome.tabs.reload = vi.fn().mockResolvedValue(undefined) as never;
        vi.spyOn(window, "close").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
        document.body.innerHTML = "";
    });

    it("closes the popup when the tour starts", async () => {
        tourReply = async () => ({started: true});
        await openPopup();
        clickTour();
        await vi.waitFor(() => expect(window.close).toHaveBeenCalled());
        expect(element("tour-help").hidden).toBe(true);
    });

    it("offers the sample article on a page with no pills, and leaves the reader's choice open", async () => {
        await openPopup();
        clickTour();
        await vi.waitFor(() => expect(element("tour-help").hidden).toBe(false));
        expect(helpTitle()).toBe("Nothing to show on this page");
        expect(element("tour-reload-btn").hidden).toBe(true);
        expect(chrome.tabs.create).not.toHaveBeenCalled();
        expect(window.close).not.toHaveBeenCalled();
    });

    it("opens the sample in a new tab and records the request first", async () => {
        let requestWhenTabOpened: unknown;
        chrome.tabs.create = vi.fn(async () => {
            requestWhenTabOpened = localStore.flora_page_tour_request;
            return {};
        }) as never;
        await openPopup();
        clickTour();
        await vi.waitFor(() => expect(element("tour-help").hidden).toBe(false));
        element("tour-sample-btn").click();
        await vi.waitFor(() => expect(window.close).toHaveBeenCalled());
        expect(chrome.tabs.create).toHaveBeenCalledWith({url: TOUR_SAMPLE_URL});
        expect(requestWhenTabOpened).toEqual(expect.any(Number));
    });

    it("disarms the request and says so when the sample tab cannot open", async () => {
        chrome.tabs.create = vi.fn().mockRejectedValue(new Error("Tabs cannot be edited right now")) as never;
        await openPopup();
        clickTour();
        await vi.waitFor(() => expect(element("tour-help").hidden).toBe(false));
        element("tour-sample-btn").click();
        await vi.waitFor(() => expect(element("popup-status").textContent).toBe("Couldn't open the sample article"));
        expect(localStore.flora_page_tour_request).toBeUndefined();
        expect(element("tour-help").hidden).toBe(true);
        expect(window.close).not.toHaveBeenCalled();
    });

    it("hides the offer again on Not now", async () => {
        await openPopup();
        clickTour();
        await vi.waitFor(() => expect(element("tour-help").hidden).toBe(false));
        element("tour-dismiss-btn").click();
        expect(element("tour-help").hidden).toBe(true);
    });

    it("moves focus into the dialog and hands it back when closed", async () => {
        await openPopup();
        clickTour();
        await vi.waitFor(() => expect(element("tour-help").hidden).toBe(false));
        expect(document.activeElement).toBe(element("tour-sample-btn"));
        element("tour-sample-btn").dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        expect(element("tour-help").hidden).toBe(true);
        expect(document.activeElement).toBe(element("page-tour-btn"));
    });

    it("closes when the backdrop is clicked, but not when the card is", async () => {
        await openPopup();
        clickTour();
        await vi.waitFor(() => expect(element("tour-help").hidden).toBe(false));
        element("tour-help-text").click();
        expect(element("tour-help").hidden).toBe(false);
        element("tour-help").click();
        expect(element("tour-help").hidden).toBe(true);
    });

    it("offers a reload when the tab has no content script", async () => {
        tourReply = () => Promise.reject(new Error("Receiving end does not exist"));
        await openPopup();
        clickTour();
        await vi.waitFor(() => expect(helpTitle()).toBe("ORE isn't running on this tab"));
        element("tour-reload-btn").click();
        await vi.waitFor(() => expect(chrome.tabs.reload).toHaveBeenCalledWith(1));
    });

    it("says the browser's own pages are out of reach without messaging them", async () => {
        await openPopup("chrome://extensions/");
        clickTour();
        await vi.waitFor(() => expect(helpTitle()).toBe("ORE can't run on this page"));
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(1, {type: "FLORA_START_PAGE_TOUR"});
        expect(element("tour-sample-btn").hidden).toBe(false);
        expect(element("tour-reload-btn").hidden).toBe(true);
    });

    it("explains that ORE is off when the domain is snoozed", async () => {
        localStore[SNOOZE_KEY] = {"example.org": Date.now() + 60_000};
        await openPopup();
        clickTour();
        await vi.waitFor(() => expect(helpTitle()).toBe("ORE is off on this page"));
    });

    it("says it is still checking during a slow pass, then starts the tour", async () => {
        let finish!: (reply: unknown) => void;
        tourReply = () => new Promise((resolve) => { finish = resolve; });
        await openPopup();
        clickTour();
        await vi.waitFor(() => expect(helpTitle()).toBe("Still checking this page"));
        expect(element("tour-sample-btn").hidden).toBe(true);
        expect(element("tour-dismiss-btn").hidden).toBe(false);
        finish({started: true});
        await vi.waitFor(() => expect(window.close).toHaveBeenCalled());
    });

    it("cancels the pending start on Not now and ignores the late reply", async () => {
        let finish!: (reply: unknown) => void;
        tourReply = () => new Promise((resolve) => { finish = resolve; });
        await openPopup();
        clickTour();
        await vi.waitFor(() => expect(helpTitle()).toBe("Still checking this page"));
        element("tour-dismiss-btn").click();
        expect(element("tour-help").hidden).toBe(true);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {type: "FLORA_CANCEL_PAGE_TOUR_START"});
        finish({started: false});
        await new Promise((resolve) => setTimeout(resolve));
        expect(element("tour-help").hidden).toBe(true);
        expect(window.close).not.toHaveBeenCalled();
    });

    it("stays open when the tour starts after the reader dismissed the wait", async () => {
        let finish!: (reply: unknown) => void;
        tourReply = () => new Promise((resolve) => { finish = resolve; });
        await openPopup();
        clickTour();
        await vi.waitFor(() => expect(helpTitle()).toBe("Still checking this page"));
        element("tour-dismiss-btn").click();
        finish({started: true});
        await new Promise((resolve) => setTimeout(resolve));
        expect(window.close).not.toHaveBeenCalled();
    });

    it("waits for the popup to finish loading before judging the page", async () => {
        let resolveTabs!: (tabs: unknown[]) => void;
        chrome.tabs.query = vi.fn(() => new Promise((resolve) => { resolveTabs = resolve; })) as never;
        document.body.innerHTML = new DOMParser().parseFromString(POPUP_HTML, "text/html").body.innerHTML;
        await import("../../src/popup/popup");
        clickTour();
        await vi.waitFor(() => expect(chrome.tabs.query).toHaveBeenCalled());
        expect(element("tour-help").hidden).toBe(true);
        resolveTabs([{id: 1, url: "https://example.org/article"}]);
        await vi.waitFor(() => expect(helpTitle()).toBe("Nothing to show on this page"));
    });
});
