import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    beginWorkIndicator,
    endWorkIndicator,
    hideWorkIndicator,
    reportNothingFound,
    reportWorkStage,
    resetWorkSummary,
    WORK_TOAST_ID,
    _resetWorkIndicatorForTesting,
} from "../../src/shared/progress-toast";
import {NOTHING_FOUND_ID, PROGRESS_TAB_ID, withdrawNothingFound} from "../../src/shared/progress-tab";
import {removeSidePanel, renderSidePanel} from "../../src/content-general/injector";
import {_resetDebugForTesting} from "../../src/shared/debug";
import type {PubPeerFeedback} from "../../src/shared/pubpeer-api";
import type {DoiContext, DoiString, LookupState} from "../../src/shared/types";

vi.mock("../../src/shared/settings", () => ({
    getSettings: vi.fn(async () => ({offerLogCopyAfterPass: false})),
}));

const DOI = "10.1000/tab" as DoiString;

function tab(): HTMLElement | null {
    return document.getElementById(PROGRESS_TAB_ID);
}

function note(): HTMLElement | null {
    return document.getElementById(NOTHING_FOUND_ID);
}

function fillHeight(el: HTMLElement): string {
    return el.querySelector<HTMLElement>("[data-flora-tab-fill]")!.style.height;
}

function settle(): void {
    vi.advanceTimersByTime(300);
}

function renderPanel(): HTMLButtonElement {
    const feedback: PubPeerFeedback = {
        id: DOI, title: "Paper", total_comments: 2, total_peeriodical_comments: 0,
        last_commented_at: "", users: "", url: "https://pubpeer.com/publications/x",
    };
    renderSidePanel(
        [feedback], [], new Map<DoiString, LookupState>(),
        new Map<DoiString, DoiContext>([[DOI, "article"]]), new Map(), []
    );
    return document.querySelector<HTMLButtonElement>("#flora-pubpeer-panel button[data-flora-tab]")!;
}

function panelOpen(): boolean {
    return document.getElementById("flora-pubpeer-panel")?.dataset.floraPanelOpen === "1";
}

describe("progress tab", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    });

    afterEach(() => {
        removeSidePanel();
        _resetWorkIndicatorForTesting();
        _resetDebugForTesting();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = "";
    });

    it("shows a grey tab that fills as the pass reports stages, with no toast", () => {
        beginWorkIndicator();
        settle();
        expect(tab()).not.toBeNull();
        expect(document.getElementById(WORK_TOAST_ID)).toBeNull();
        expect(tab()!.getAttribute("role")).toBe("progressbar");
        expect(tab()!.hasAttribute("aria-valuenow")).toBe(false);

        reportWorkStage("lookup", "Looking up 10 DOIs…");
        expect(fillHeight(tab()!)).toBe("72%");
        expect(tab()!.getAttribute("aria-valuenow")).toBe("72");
        expect(tab()!.title).toBe("Looking up 10 DOIs…");
    });

    it("stays silent through a pass that finishes quickly", () => {
        beginWorkIndicator();
        endWorkIndicator();
        vi.advanceTimersByTime(2000);
        expect(tab()).toBeNull();
    });

    it("fills up and slides away once the page's work is done", () => {
        beginWorkIndicator();
        settle();
        endWorkIndicator();
        expect(fillHeight(tab()!)).toBe("100%");
        vi.advanceTimersByTime(900);
        expect(tab()).toBeNull();
    });

    it("stays busy through back-to-back passes", () => {
        beginWorkIndicator();
        settle();
        endWorkIndicator();
        vi.advanceTimersByTime(200);
        beginWorkIndicator();
        vi.advanceTimersByTime(2000);
        expect(tab()).not.toBeNull();
        expect(tab()!.hasAttribute("data-flora-tab-busy")).toBe(true);
    });

    it("shows the nothing-found state and note, then hides both after five seconds", () => {
        beginWorkIndicator();
        settle();
        reportNothingFound(42);
        endWorkIndicator();
        vi.advanceTimersByTime(600);

        expect(tab()!.querySelector("[data-flora-tab-no-results]")).not.toBeNull();
        expect(tab()!.hasAttribute("data-flora-tab-busy")).toBe(false);
        expect(note()!.textContent).toContain("Nothing found on this page");
        expect(note()!.textContent).toContain("Checked 42 papers.");

        vi.advanceTimersByTime(5000);
        vi.advanceTimersByTime(400);
        expect(note()).toBeNull();
        expect(tab()).toBeNull();
    });

    it("still says nothing was found after a pass too quick to show progress", () => {
        beginWorkIndicator();
        reportNothingFound(1);
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(note()!.textContent).toContain("Checked 1 paper.");
    });

    it("keeps the report tab disabled until the pass ends, then pulses it", () => {
        beginWorkIndicator();
        settle();
        const panelTab = renderPanel();
        expect(tab(), "the report tab takes over from the standalone one").toBeNull();
        expect(panelTab.getAttribute("aria-disabled")).toBe("true");

        panelTab.click();
        expect(panelOpen()).toBe(false);

        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(panelTab.hasAttribute("aria-disabled")).toBe(false);
        expect(panelTab.querySelector("[data-flora-tab-fill]")).toBeNull();
        expect(panelTab.style.animation).toContain("flora-tab-pulse");
        expect(panelTab.getAttribute("aria-label")).toBe("Open the FORRT ORE panel");

        panelTab.click();
        expect(panelOpen()).toBe(true);
    });

    it("holds the arrival pulse for a report that appears before progress shows", () => {
        beginWorkIndicator();
        const panelTab = renderPanel();
        expect(panelTab.style.animation).not.toContain("flora-tab-pulse");

        settle();
        expect(panelTab.getAttribute("aria-disabled")).toBe("true");
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(panelTab.style.animation).toContain("flora-tab-pulse");
    });

    it("keeps a report built early in a pass from opening before progress shows", () => {
        beginWorkIndicator();
        const panelTab = renderPanel();
        panelTab.click();
        expect(panelOpen()).toBe(false);
        expect(panelTab.getAttribute("aria-disabled")).toBe("true");
    });

    it("pulses the report tab again after a later pass greys it", () => {
        const panelTab = renderPanel();
        beginWorkIndicator();
        settle();
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(panelTab.dataset.floraTabPulsed).toBe("1");

        panelTab.style.animation = "";
        beginWorkIndicator();
        settle();
        expect(panelTab.dataset.floraTabPulsed).toBeUndefined();
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(panelTab.style.animation).toContain("flora-tab-pulse");
    });

    it("drops a pending nothing-found verdict once flags turn up", () => {
        beginWorkIndicator();
        settle();
        reportNothingFound(12);
        endWorkIndicator();
        vi.advanceTimersByTime(200);

        beginWorkIndicator();
        withdrawNothingFound();
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(note()).toBeNull();
        expect(tab()?.querySelector("[data-flora-tab-no-results]") ?? null).toBeNull();
    });

    it("lets an open report close while a later pass runs", () => {
        const panelTab = renderPanel();
        panelTab.click();
        expect(panelOpen()).toBe(true);

        beginWorkIndicator();
        settle();
        expect(panelTab.getAttribute("aria-disabled")).toBe("true");
        panelTab.click();
        expect(panelOpen()).toBe(false);
    });

    it("leaves a report tab alone when no pass is running", () => {
        const panelTab = renderPanel();
        expect(panelTab.hasAttribute("aria-disabled")).toBe(false);
        expect(panelTab.querySelector("[data-flora-tab-fill]")).toBeNull();
    });

    it("falls back to the standalone tab when the report is removed mid-pass", () => {
        beginWorkIndicator();
        settle();
        renderPanel();
        removeSidePanel();
        expect(tab()).not.toBeNull();
    });

    it("clears the tab on a page change and while FLoRA UI is hidden", () => {
        beginWorkIndicator();
        settle();
        resetWorkSummary();
        expect(tab()).toBeNull();

        reportWorkStage("scan", "Scanning the page we left…");
        settle();
        expect(tab(), "the old page's pass must not repaint the new page").toBeNull();

        beginWorkIndicator();
        settle();
        expect(tab()).not.toBeNull();

        hideWorkIndicator();
        expect(tab()).toBeNull();
    });
});
