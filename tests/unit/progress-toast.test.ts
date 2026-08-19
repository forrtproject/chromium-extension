import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    beginWorkIndicator,
    endWorkIndicator,
    hideWorkIndicator,
    reportWorkStage,
    setWorkItems,
    showWorkIndicator,
    updateWorkItem,
    WORK_TOAST_ID,
    _resetWorkIndicatorForTesting,
} from "../../src/shared/progress-toast";
import {setDebug, _resetDebugForTesting} from "../../src/shared/debug";
import {buildDebugReport} from "../../src/shared/debug-report";
import {writeClipboard} from "../../src/shared/clipboard";

vi.mock("../../src/shared/debug-report", () => ({
    buildDebugReport: vi.fn(async () => ({text: "REPORT", entryCount: 1, data: {}})),
}));

vi.mock("../../src/shared/clipboard", () => ({
    writeClipboard: vi.fn(async () => true),
}));

const domainWrites = vi.hoisted(() => ({
    snoozeDomain: vi.fn(async () => Date.now() + 3_600_000),
    blockDomain: vi.fn(async () => undefined),
}));
vi.mock("../../src/shared/domains", () => domainWrites);

function toast(): HTMLElement | null {
    return document.getElementById(WORK_TOAST_ID);
}

function label(): string {
    return toast()?.querySelector("[data-flora-work-label]")?.textContent ?? "";
}

function percent(): string | null {
    return toast()?.querySelector("[data-flora-work-track]")?.getAttribute("aria-valuenow") ?? null;
}

function button(name: string): HTMLButtonElement {
    return toast()!.querySelector<HTMLButtonElement>(`[data-flora-work-${name}]`)!;
}

function expand(): void {
    button("chevron").click();
}

function stageStates(): Record<string, string> {
    const rows = toast()!.querySelectorAll<HTMLElement>("[data-flora-work-stage]");
    return Object.fromEntries(
        [...rows].map((row) => [row.dataset.floraWorkStage ?? "", row.dataset.floraWorkState ?? ""])
    );
}

function itemRows(): HTMLElement[] {
    return [...(toast()?.querySelectorAll<HTMLElement>("[data-flora-work-item]") ?? [])];
}

/** Past the delay that holds the toast back on a fast pass. */
function settle(): void {
    vi.advanceTimersByTime(300);
}

describe("progress toast", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        _resetWorkIndicatorForTesting();
        _resetDebugForTesting();
        vi.useRealTimers();
        vi.restoreAllMocks();
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

    it("lists the planned stages and skips the ones that never reported", () => {
        beginWorkIndicator({stages: ["scan", "validate", "augment", "lookup"]});
        settle();
        expand();
        expect(stageStates()).toEqual({
            scan: "pending",
            validate: "pending",
            augment: "pending",
            lookup: "pending",
        });

        let clock = 0;
        vi.spyOn(performance, "now").mockImplementation(() => clock);
        reportWorkStage("scan", "Read 20 results");
        clock = 2300;
        reportWorkStage("lookup", "Looking up 14 DOIs…");
        expect(stageStates()).toEqual({
            scan: "done",
            validate: "skipped",
            augment: "skipped",
            lookup: "current",
        });

        const done = toast()!.querySelector<HTMLElement>('[data-flora-work-stage="scan"]')!;
        expect(done.textContent).toContain("Read 20 results");
        expect(done.querySelector("[data-flora-work-duration]")?.textContent).toBe("2.3 s");
        // A stage that never ran shows its generic planned label.
        expect(toast()!.querySelector('[data-flora-work-stage="validate"]')?.textContent).toContain(
            "Check DOIs resolve"
        );
    });

    it("shows items under the current stage, capped at six rows", () => {
        beginWorkIndicator({stages: ["augment", "lookup"]});
        reportWorkStage("augment", "Searching OpenAlex for 8 results…");
        settle();
        expand();
        setWorkItems(
            Array.from({length: 8}, (_, i) => ({id: `i${i}`, label: `Paper ${i}`, status: "pending" as const}))
        );
        expect(itemRows()).toHaveLength(6);
        expect(toast()!.querySelector("[data-flora-work-more]")?.textContent).toBe("2 more…");

        updateWorkItem("i0", "done", "10.1234/x");
        const first = toast()!.querySelector<HTMLElement>('[data-flora-work-item="i0"]')!;
        expect(first.textContent).toContain("✓");
        expect(first.textContent).toContain("10.1234/x");

        // Items belong to the stage that reported them.
        reportWorkStage("lookup", "Looking up 14 DOIs…");
        expect(itemRows()).toHaveLength(0);
    });

    it("dismisses the toast for the pass and shows it again on the next one", () => {
        beginWorkIndicator();
        reportWorkStage("scan", "Scanning this page for DOIs…");
        settle();
        button("close").click();
        expect(toast()).toBeNull();

        reportWorkStage("lookup", "Looking up 10 DOIs in FLoRA…");
        settle();
        expect(toast()).toBeNull();

        endWorkIndicator();
        beginWorkIndicator();
        settle();
        expect(toast()).not.toBeNull();
    });

    it("forgets the expanded panel between passes", () => {
        beginWorkIndicator();
        settle();
        expand();
        expect(button("chevron").getAttribute("aria-expanded")).toBe("true");

        endWorkIndicator();
        vi.advanceTimersByTime(1000);
        beginWorkIndicator();
        settle();
        expect(button("chevron").getAttribute("aria-expanded")).toBe("false");
    });

    it("keeps the host click-through and the buttons clickable", () => {
        beginWorkIndicator();
        settle();
        expect(toast()!.style.pointerEvents).toBe("none");
        expect(button("chevron").style.pointerEvents).toBe("auto");
        expect(button("close").style.pointerEvents).toBe("auto");
        expand();
        expect(toast()!.querySelector<HTMLElement>("[data-flora-work-pause] button")!.style.pointerEvents).toBe(
            "auto"
        );
    });

    it("offers the copy-log buttons only while debug logging is on", () => {
        beginWorkIndicator();
        settle();
        expand();
        expect(toast()!.querySelector("[data-flora-work-copy]")).toBeNull();

        endWorkIndicator();
        vi.advanceTimersByTime(1000);
        setDebug(true);
        beginWorkIndicator();
        settle();
        expand();
        expect(toast()!.querySelector("[data-flora-work-copy]")).not.toBeNull();
        expect(toast()!.querySelector("[data-flora-work-arm]")).not.toBeNull();
    });

    it("holds the toast open when the copy is armed and copies on click", async () => {
        setDebug(true);
        beginWorkIndicator();
        reportWorkStage("scan", "Scanning this page for DOIs…");
        settle();
        expand();
        button("arm").click();
        expect(button("arm").textContent).toBe("Will copy when finished ✓");

        endWorkIndicator();
        vi.advanceTimersByTime(2000);
        expect(toast()).not.toBeNull();
        expect(label()).toBe("Pass finished — log ready");

        const copy = button("final-copy");
        copy.click();
        await vi.advanceTimersByTimeAsync(1600);
        expect(buildDebugReport).toHaveBeenCalled();
        expect(writeClipboard).toHaveBeenCalledWith("REPORT");
        expect(copy.textContent).toBe("Copied ✓");
    });
    it("pause menu persists the snooze before telling the page to hide", async () => {
        let resolveWrite: (until: number) => void = () => {};
        domainWrites.snoozeDomain.mockImplementationOnce(
            () => new Promise<number>((resolve) => { resolveWrite = resolve; }),
        );
        const paused = vi.fn();
        document.addEventListener("flora-pause-site", paused);

        beginWorkIndicator();
        reportWorkStage("scan", "Scanning this page for DOIs…");
        settle();
        expand();
        const menu = toast()!.querySelector<HTMLElement>("[data-flora-work-pause-menu]")!;
        menu.querySelector<HTMLButtonElement>("button")!.click(); // "Pause here for 1 hour"

        expect(domainWrites.snoozeDomain).toHaveBeenCalledWith(location.hostname, 3_600_000);
        expect(toast()).toBeNull();
        expect(paused).not.toHaveBeenCalled();

        resolveWrite(Date.now() + 3_600_000);
        await vi.advanceTimersByTimeAsync(0);
        expect(paused).toHaveBeenCalledTimes(1);
        document.removeEventListener("flora-pause-site", paused);
    });
});
