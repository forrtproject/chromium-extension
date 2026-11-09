import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderSidePanel, removeSidePanel } from "../../src/content-general/injector";
import type { PubPeerFeedback } from "../../src/shared/pubpeer-api";
import type { DoiString, DoiContext, LookupState } from "../../src/shared/types";

const DOI = "10.1000/panel" as DoiString;

function feedback(): PubPeerFeedback {
    return {
        id: DOI,
        title: "A discussed paper",
        total_comments: 4,
        total_peeriodical_comments: 0,
        last_commented_at: "2026-01-01",
        users: "",
        url: "https://pubpeer.com/publications/abc123",
    };
}

function render(): void {
    const pageState = new Map<DoiString, LookupState>();
    const doiContext = new Map<DoiString, DoiContext>([[DOI, "article"]]);
    renderSidePanel([feedback()], [], pageState, doiContext, new Map(), []);
}

function tab(): HTMLElement {
    const el = document.querySelector<HTMLElement>(
        '[aria-label="Open the FORRT ORE panel"], [aria-label="Close FLoRA panel"]'
    );
    if (!el) throw new Error("panel tab not rendered");
    return el;
}

function headStyleCount(): number {
    return document.head.querySelectorAll("style").length;
}

describe("side panel teardown", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    });

    afterEach(() => {
        removeSidePanel();
        vi.restoreAllMocks();
    });

    it("stops following hidden-commenter changes when the panel is removed", () => {
        const addSpy = vi.mocked(chrome.storage.onChanged.addListener);
        const removeSpy = vi.mocked(chrome.storage.onChanged.removeListener);
        render();
        removeSidePanel();
        addSpy.mockClear();
        removeSpy.mockClear();

        render();
        expect(addSpy).toHaveBeenCalledTimes(1);

        removeSidePanel();

        expect(removeSpy).toHaveBeenCalledWith(addSpy.mock.calls[0][0]);
    });

    it("does not stack hidden-commenter listeners across re-renders", () => {
        const addSpy = vi.mocked(chrome.storage.onChanged.addListener);
        const removeSpy = vi.mocked(chrome.storage.onChanged.removeListener);
        render();
        removeSidePanel();
        addSpy.mockClear();
        removeSpy.mockClear();

        render();
        renderSidePanel(
            [{ ...feedback(), total_comments: 9 }],
            [],
            new Map(),
            new Map([[DOI, "article" as DoiContext]]),
            new Map(),
            []
        );

        expect(addSpy).toHaveBeenCalledTimes(2);
        expect(removeSpy).toHaveBeenCalledTimes(1);
    });

    it("leaves nothing scheduled after the panel is removed", () => {
        vi.useFakeTimers();
        try {
            render();
            removeSidePanel();

            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("reuses one <style> element across open/close toggles", () => {
        render();
        const baseline = headStyleCount();

        for (let i = 0; i < 5; i++) {
            tab().click();
            tab().click();
        }

        expect(headStyleCount()).toBeLessThanOrEqual(baseline + 1);
    });

    it("drops the z-index style when the panel is removed", () => {
        render();
        tab().click();
        const whileOpen = headStyleCount();

        removeSidePanel();

        expect(headStyleCount()).toBeLessThan(whileOpen);
    });
});
