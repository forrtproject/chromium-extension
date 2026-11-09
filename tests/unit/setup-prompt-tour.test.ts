import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {renderSetupPrompt} from "../../src/content-general/injector";
import {closePageTour, runPageTour} from "../../src/shared/page-tour";

vi.mock("../../src/shared/settings", () => ({
    getSettings: vi.fn().mockResolvedValue({email: ""}),
    isSetupComplete: vi.fn().mockResolvedValue(false),
}));

const prompt = () => document.getElementById("flora-setup-prompt");

function tour(): boolean {
    const target = document.createElement("span");
    document.body.appendChild(target);
    return runPageTour([{target, title: "A stop", text: "Some text"}]);
}

describe("setup prompt and the page tour", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        Element.prototype.scrollIntoView = vi.fn();
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({dismissed: false});
        (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    });
    afterEach(() => closePageTour());

    it("steps aside while a tour opened over it, and returns when the tour is skipped", async () => {
        await renderSetupPrompt();
        expect(prompt()!.style.display).toBe("");
        expect(tour()).toBe(true);
        expect(prompt()!.style.display).toBe("none");
        closePageTour();
        expect(prompt()!.style.display).toBe("");
    });

    it("waits for a tour that is already open", async () => {
        tour();
        await renderSetupPrompt();
        expect(prompt()!.style.display).toBe("none");
        closePageTour();
        expect(prompt()!.style.display).toBe("");
    });
});
