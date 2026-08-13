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

    it("removes the iframe message listener when the panel is removed", () => {
        const addSpy = vi.spyOn(window, "addEventListener");
        const removeSpy = vi.spyOn(window, "removeEventListener");

        render();
        const added = addSpy.mock.calls.filter(([type]) => type === "message");
        expect(added).toHaveLength(1);

        removeSidePanel();

        expect(removeSpy).toHaveBeenCalledWith("message", added[0][1]);
    });

    it("does not stack message listeners across re-renders", () => {
        const addSpy = vi.spyOn(window, "addEventListener");
        const removeSpy = vi.spyOn(window, "removeEventListener");

        render();
        renderSidePanel(
            [{ ...feedback(), total_comments: 9 }],
            [],
            new Map(),
            new Map([[DOI, "article" as DoiContext]]),
            new Map(),
            []
        );

        const added = addSpy.mock.calls.filter(([type]) => type === "message");
        const removed = removeSpy.mock.calls.filter(([type]) => type === "message");
        expect(added).toHaveLength(2);
        expect(removed).toHaveLength(1);
    });

    it("does not fire the fallback timer after the panel is removed", () => {
        vi.useFakeTimers();
        try {
            render();
            removeSidePanel();
            const before = document.body.innerHTML;

            vi.advanceTimersByTime(10_000);

            expect(document.body.innerHTML).toBe(before);
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
