import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";

vi.mock("../../src/walkthrough/demos", () => ({installOfflineFixtures: vi.fn(), mountDemos: vi.fn()}));
vi.mock("../../src/shared/site-category-picker", () => ({mountSiteCategoryPicker: vi.fn()}));

const WALKTHROUGH_HTML = readFileSync(join(__dirname, "..", "..", "src", "walkthrough", "index.html"), "utf-8");

const sampleError = () => document.getElementById("tour-sample-error")!;
const clickSample = () => document.getElementById("tour-sample-btn")!.click();

describe("the walkthrough's sample article button", () => {
    beforeAll(async () => {
        document.body.innerHTML = new DOMParser().parseFromString(WALKTHROUGH_HTML, "text/html").body.innerHTML;
        await import("../../src/walkthrough/walkthrough");
        document.dispatchEvent(new Event("DOMContentLoaded"));
    });

    beforeEach(() => {
        sampleError().hidden = true;
        chrome.storage.local.set = vi.fn().mockResolvedValue(undefined) as never;
        chrome.storage.local.remove = vi.fn().mockResolvedValue(undefined) as never;
    });

    it("opens one tab per click and shows no message when it opens", async () => {
        chrome.tabs.create = vi.fn().mockResolvedValue({}) as never;
        clickSample();
        await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve));
        expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
        expect(sampleError().hidden).toBe(true);
    });

    it("opens one tab for a double click and keeps the tour request", async () => {
        let finish!: (tab: unknown) => void;
        chrome.tabs.create = vi.fn(() => new Promise((resolve) => { finish = resolve; })) as never;
        clickSample();
        clickSample();
        await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());
        clickSample();
        finish({});
        await new Promise((resolve) => setTimeout(resolve));
        expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
        expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    });

    it("says so when the tab cannot open, and clears the message on a successful retry", async () => {
        chrome.tabs.create = vi.fn().mockRejectedValue(new Error("Tabs cannot be edited right now")) as never;
        clickSample();
        await vi.waitFor(() => expect(sampleError().hidden).toBe(false));

        chrome.tabs.create = vi.fn().mockResolvedValue({}) as never;
        clickSample();
        expect(sampleError().hidden).toBe(true);
        await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve));
        expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
        expect(sampleError().hidden).toBe(true);
    });
});
