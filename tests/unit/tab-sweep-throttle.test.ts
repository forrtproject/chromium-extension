import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderSidePanel, removeSidePanel } from "../../src/content-general/injector";
import type { PubPeerFeedback } from "../../src/shared/pubpeer-api";
import type { DoiString, DoiContext, LookupState } from "../../src/shared/types";

const DOI = "10.1000/sweep" as DoiString;

function feedback(comments: number): PubPeerFeedback {
    return {
        id: DOI, title: "Paper", total_comments: comments, total_peeriodical_comments: 0,
        last_commented_at: "", users: "", url: "https://pubpeer.com/publications/x",
    };
}

function render(comments: number): void {
    renderSidePanel(
        [feedback(comments)], [], new Map<DoiString, LookupState>(),
        new Map<DoiString, DoiContext>([[DOI, "article"]]), new Map(), []
    );
}

describe("right-edge sweep throttling", () => {
    let queryAllCalls = 0;

    beforeEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
        removeSidePanel();
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
        queryAllCalls = 0;
        const original = document.querySelectorAll.bind(document);
        vi.spyOn(document, "querySelectorAll").mockImplementation((sel: string) => {
            if (sel === "*") queryAllCalls++;
            return original(sel);
        });
    });

    afterEach(() => {
        removeSidePanel();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("does not re-measure the whole page on every re-render", () => {
        render(1);
        const afterFirst = queryAllCalls;
        expect(afterFirst).toBeGreaterThan(0);

        render(2);
        render(3);

        expect(queryAllCalls).toBe(afterFirst);
    });

    it("measures again once the throttle window has passed", () => {
        vi.useFakeTimers();
        try {
            render(1);
            const afterFirst = queryAllCalls;

            vi.setSystemTime(Date.now() + 5000);
            render(2);

            expect(queryAllCalls).toBeGreaterThan(afterFirst);
        } finally {
            vi.useRealTimers();
        }
    });
});
