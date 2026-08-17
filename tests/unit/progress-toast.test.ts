import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    beginWorkIndicator,
    endWorkIndicator,
    hideWorkIndicator,
    reportWorkStage,
    showWorkIndicator,
    WORK_TOAST_ID,
    _resetWorkIndicatorForTesting,
} from "../../src/shared/progress-toast";

function toast(): HTMLElement | null {
    return document.getElementById(WORK_TOAST_ID);
}

function label(): string {
    return toast()?.querySelector("[data-flora-work-label]")?.textContent ?? "";
}

function percent(): string | null {
    return toast()?.querySelector("[data-flora-work-track]")?.getAttribute("aria-valuenow") ?? null;
}

/** Past the delay that holds the toast back on a fast pass. */
function settle(): void {
    vi.advanceTimersByTime(300);
}

describe("progress toast", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        _resetWorkIndicatorForTesting();
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    it("shows nothing until work begins", () => {
        settle();
        expect(toast()).toBeNull();
    });

    it("stays silent through a pass that finishes quickly", () => {
        beginWorkIndicator();
        reportWorkStage("scan", "Scanning this page for DOIs…");
        endWorkIndicator();
        settle();
        expect(toast()).toBeNull();
    });

    it("opens indeterminate — no stage has reported yet", () => {
        beginWorkIndicator();
        settle();
        expect(toast()).not.toBeNull();
        expect(label()).toContain("ORE is looking up");
        expect(percent()).toBeNull();
    });

    it("reports the running stage and fills the bar", () => {
        beginWorkIndicator();
        reportWorkStage("lookup", "Looking up 10 DOIs in FLoRA…");
        settle();
        expect(label()).toBe("Looking up 10 DOIs in FLoRA…");
        expect(Number(percent())).toBeGreaterThan(0);
    });

    it("never rewinds the bar when a parallel stage reports late", () => {
        beginWorkIndicator();
        reportWorkStage("lookup", "Looking up 10 DOIs in FLoRA…");
        settle();
        const atLookup = Number(percent());
        // References resolve alongside validation — stages report out of order.
        reportWorkStage("augment", "Augmenting 3 references without a DOI…");
        expect(Number(percent())).toBe(atLookup);
        expect(label()).toBe("Augmenting 3 references without a DOI…");
    });

    it("ignores a stage reported with no pass in flight", () => {
        reportWorkStage("lookup", "Looking up 10 DOIs in FLoRA…");
        settle();
        expect(toast()).toBeNull();
    });

    it("stays up until every nested pass has ended", () => {
        beginWorkIndicator();
        beginWorkIndicator();
        settle();
        endWorkIndicator();
        vi.advanceTimersByTime(1000);
        expect(toast()).not.toBeNull();

        endWorkIndicator();
        expect(percent()).toBe("100");
        vi.advanceTimersByTime(1000);
        expect(toast()).toBeNull();
    });

    it("starts the bar over for a pass that begins while the last one fades", () => {
        beginWorkIndicator();
        reportWorkStage("report", "Generating report…");
        settle();
        endWorkIndicator();
        expect(percent()).toBe("100");

        // Inside the fade-out delay — the toast element is still on the page.
        beginWorkIndicator();
        expect(percent()).toBeNull();
        reportWorkStage("scan", "Scanning this page for DOIs…");
        expect(Number(percent())).toBeLessThan(100);
    });

    it("drops the toast while FLoRA UI is hidden and restores it on show", () => {
        beginWorkIndicator();
        reportWorkStage("scan", "Scanning this page for DOIs…");
        settle();

        hideWorkIndicator();
        expect(toast()).toBeNull();
        reportWorkStage("lookup", "Looking up 10 DOIs in FLoRA…");
        settle();
        expect(toast()).toBeNull();

        showWorkIndicator();
        // The pass kept running while hidden — the bar resumes where it got to.
        expect(toast()).not.toBeNull();
        expect(label()).toBe("Looking up 10 DOIs in FLoRA…");
        expect(Number(percent())).toBeGreaterThan(0);
    });

    it("does not resurrect the toast on show when no work is running", () => {
        hideWorkIndicator();
        showWorkIndicator();
        settle();
        expect(toast()).toBeNull();
    });
});
