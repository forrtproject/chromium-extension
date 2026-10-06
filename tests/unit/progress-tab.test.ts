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
import {PROGRESS_TAB_ID, resetTabProgress, withdrawNothingFound} from "../../src/shared/progress-tab";
import {_recordPubPeerVerdictsForTesting, _resetPubPeerCacheForTesting} from "../../src/shared/pubpeer-api";
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

function fillHeight(el: HTMLElement): string {
    return el.querySelector<HTMLElement>("[data-flora-tab-fill]")!.style.height;
}

function papers(n: number): string[] {
    return Array.from({length: n}, (_, i) => `10.1000/paper.${i}`);
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
        _resetPubPeerCacheForTesting();
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

    it("shows the clear state on the tab with the summary as its tooltip, and keeps it", () => {
        beginWorkIndicator();
        settle();
        reportNothingFound(papers(42));
        _recordPubPeerVerdictsForTesting(papers(42).map((doi) => [doi, "clear"]));
        endWorkIndicator();
        vi.advanceTimersByTime(600);

        expect(tab()!.querySelector("[data-flora-tab-clear-icon]")).not.toBeNull();
        expect(tab()!.hasAttribute("data-flora-tab-busy")).toBe(false);
        expect(tab()!.title).toContain("No flags on this page");
        expect(tab()!.title).toContain("Checked 42 papers: no retractions, concerns, replications, reproductions or PubPeer comments.");
        expect(tab()!.getAttribute("aria-label")).toMatch(/^FORRT ORE: No flags/);
        expect(document.getElementById("flora-nothing-found")).toBeNull();

        vi.advanceTimersByTime(10_000);
        expect(tab()).not.toBeNull();
    });

    it("keeps the clear state through a later pass that shows nothing", () => {
        beginWorkIndicator();
        settle();
        reportNothingFound(papers(2));
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(tab()!.hasAttribute("data-flora-tab-clear")).toBe(true);

        beginWorkIndicator();
        settle();
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(tab()!.hasAttribute("data-flora-tab-clear")).toBe(true);
        expect(tab()!.title).toContain("No flags on this page");
    });

    it("marks the report tab with the summary without changing its label", () => {
        beginWorkIndicator();
        settle();
        const panelTab = renderPanel();
        reportNothingFound(papers(3));
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(panelTab.title).toContain("No flags");
        expect(panelTab.getAttribute("aria-label")).toBe("Open the FORRT ORE panel");
        expect(panelTab.querySelector("[data-flora-tab-clear-icon]")).not.toBeNull();
        expect(panelTab.style.background).toContain("#0b7a5a");
        expect(panelTab.style.cursor).not.toBe("default");
        expect(panelTab.hasAttribute("role")).toBe(false);

        withdrawNothingFound();
        expect(panelTab.querySelector("[data-flora-tab-clear-icon]")).toBeNull();
        expect(panelTab.style.background).toContain("#853953");
        expect(panelTab.hasAttribute("data-flora-tab-clear")).toBe(false);
    });

    it("restores the report tab look when a later pass starts or resets", () => {
        const panelTab = renderPanel();
        beginWorkIndicator();
        reportNothingFound(papers(3));
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(panelTab.style.background).toContain("#0b7a5a");

        beginWorkIndicator();
        settle();
        expect(panelTab.querySelector("[data-flora-tab-clear-icon]")).toBeNull();
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(panelTab.querySelectorAll("[data-flora-tab-clear-icon]")).toHaveLength(1);

        resetTabProgress();
        expect(panelTab.querySelector("[data-flora-tab-clear-icon]")).toBeNull();
        expect(panelTab.style.background).toContain("#853953");
    });

    it("claims no PubPeer comments only once every paper on the note has a clear PubPeer check", () => {
        const [a, b, c] = papers(3);
        _recordPubPeerVerdictsForTesting([["10.1000/other-page", "clear"], [a, "clear"]]);
        beginWorkIndicator();
        settle();
        reportNothingFound([a, b, c]);
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(tab()!.title).toContain("Checked 3 papers: no retractions, concerns, replications or reproductions.");
        expect(tab()!.title).not.toContain("PubPeer");

        _recordPubPeerVerdictsForTesting([[b, "clear"], [c, "unavailable"]]);
        expect(tab()!.title, "an unavailable PubPeer check earns no claim").not.toContain("PubPeer");

        _recordPubPeerVerdictsForTesting([[c, "clear"]]);
        expect(tab()!.title).toContain("reproductions or PubPeer comments.");
    });

    it("still says nothing was found after a pass too quick to show progress", () => {
        beginWorkIndicator();
        reportNothingFound(papers(1));
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(tab()!.title).toContain("No flags for this paper");
        expect(tab()!.title).toContain("Checked 1 paper: no retractions");
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

    it("opens a settled report while a later rescan runs", () => {
        const panelTab = renderPanel();
        beginWorkIndicator();
        settle();
        expect(panelTab.hasAttribute("data-flora-tab-busy")).toBe(true);
        expect(panelTab.hasAttribute("aria-disabled")).toBe(false);

        panelTab.click();
        expect(panelOpen()).toBe(true);
    });

    it("does not pulse the report tab again for a rescan that leaves the report as it was", () => {
        const panelTab = renderPanel();
        beginWorkIndicator();
        settle();
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        panelTab.style.animation = "";

        beginWorkIndicator();
        settle();
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(panelTab.style.animation).not.toContain("flora-tab-pulse");
    });

    it("keeps the fill from rewinding when a pass starts while the tab is still busy", () => {
        beginWorkIndicator();
        reportWorkStage("lookup", "Looking up 10 DOIs…");
        settle();
        expect(fillHeight(tab()!)).toBe("72%");
        endWorkIndicator();
        vi.advanceTimersByTime(200);

        beginWorkIndicator();
        reportWorkStage("validate", "Checking 10 DOIs resolve…");
        settle();
        expect(fillHeight(tab()!)).toBe("100%");
        endWorkIndicator();
        vi.advanceTimersByTime(900);

        beginWorkIndicator();
        reportWorkStage("scan", "Scanning…");
        settle();
        expect(fillHeight(tab()!), "a new round of work starts from the bottom").toBe("8%");
    });

    it("drops a pending nothing-found verdict once flags turn up", () => {
        beginWorkIndicator();
        settle();
        reportNothingFound(papers(12));
        endWorkIndicator();
        vi.advanceTimersByTime(200);

        beginWorkIndicator();
        withdrawNothingFound();
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(tab()?.querySelector("[data-flora-tab-clear-icon]") ?? null).toBeNull();
    });

    it("takes down a clear state already on screen once flags turn up", () => {
        beginWorkIndicator();
        settle();
        reportNothingFound(papers(12));
        endWorkIndicator();
        vi.advanceTimersByTime(600);
        expect(tab()!.hasAttribute("data-flora-tab-clear")).toBe(true);
        expect(tab()!.hasAttribute("data-flora-tab-done")).toBe(true);

        withdrawNothingFound();
        expect(tab()).toBeNull();
    });

    it("lets an open report close while a later pass runs", () => {
        const panelTab = renderPanel();
        panelTab.click();
        expect(panelOpen()).toBe(true);

        beginWorkIndicator();
        settle();
        expect(panelTab.hasAttribute("aria-disabled")).toBe(false);
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
