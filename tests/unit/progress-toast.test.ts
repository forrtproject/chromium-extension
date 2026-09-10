import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    beginWorkIndicator,
    endWorkIndicator,
    hideWorkIndicator,
    isWorkCancelled,
    reportWorkStage,
    setWorkItems,
    showWorkIndicator,
    updateWorkItem,
    WORK_TOAST_ID,
    _resetWorkIndicatorForTesting,
    resetWorkSummary,
    floatingBottom,
    SETUP_PROMPT_ID,
} from "../../src/shared/progress-toast";
import {canStartAutomaticWork, resumeAutomaticWork} from "../../src/shared/work-cancellation";
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

const settings = vi.hoisted(() => ({offerLogCopyAfterPass: false}));
vi.mock("../../src/shared/settings", () => ({
    getSettings: vi.fn(async () => settings),
}));

function toast(): HTMLElement | null {
    return document.getElementById(WORK_TOAST_ID);
}

function label(): string {
    return toast()?.querySelector("[data-flora-work-label]")?.textContent ?? "";
}

function percent(): string | null {
    return toast()?.querySelector("[data-flora-work-track]")?.getAttribute("aria-valuenow") ?? null;
}

function track(): HTMLElement {
    return toast()!.querySelector<HTMLElement>("[data-flora-work-track]")!;
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

        const frames: FrameRequestCallback[] = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        updateWorkItem("i0", "done", "10.1234/x");
        frames[0](0);
        const first = toast()!.querySelector<HTMLElement>('[data-flora-work-item="i0"]')!;
        expect(first.textContent).toContain("✓");
        expect(first.textContent).toContain("10.1234/x");

        // Items belong to the stage that reported them.
        reportWorkStage("lookup", "Looking up 14 DOIs…");
        expect(itemRows()).toHaveLength(0);
    });

    it("coalesces a synchronous burst of item updates into one render frame", () => {
        beginWorkIndicator({stages: ["lookup"]});
        reportWorkStage("lookup", "Looking up 8 DOIs…");
        settle();
        expand();
        const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
        setWorkItems(
            Array.from({length: 8}, (_, i) => ({id: `i${i}`, label: `Paper ${i}`, status: "pending" as const}))
        );
        requestFrame.mockClear();

        for (let i = 0; i < 8; i++) updateWorkItem(`i${i}`, "done");

        expect(requestFrame).toHaveBeenCalledTimes(1);
        const render = requestFrame.mock.calls[0][0];
        render(0);
        expect(itemRows().every((row) => row.textContent?.includes("✓"))).toBe(true);
    });

    it("drops a render queued just before the toast is removed", async () => {
        setDebug(true);
        settings.offerLogCopyAfterPass = true;
        beginWorkIndicator({stages: ["lookup"]});
        await vi.advanceTimersByTimeAsync(0); // the setting is read asynchronously
        reportWorkStage("lookup", "Looking up 1 DOI…");
        settle();
        setWorkItems([{id: "i0", label: "Paper 0", status: "pending"}]);
        endWorkIndicator();
        await vi.advanceTimersByTimeAsync(3000);
        settings.offerLogCopyAfterPass = false;

        const pending = new Map<number, FrameRequestCallback>();
        let nextFrame = 0;
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            pending.set(++nextFrame, callback);
            return nextFrame;
        });
        const cancelFrame = vi
            .spyOn(window, "cancelAnimationFrame")
            .mockImplementation((id) => void pending.delete(id));

        updateWorkItem("i0", "done"); // a straggler queues a render
        const queued = nextFrame;
        expect(pending.has(queued)).toBe(true);

        button("close").click();
        await vi.advanceTimersByTimeAsync(6000);
        expect(toast()).toBeNull();
        expect(cancelFrame).toHaveBeenCalledWith(queued);
        expect(pending.has(queued)).toBe(false);

        // Nothing left to rebuild the removed toast.
        for (const callback of [...pending.values()]) callback(0);
        expect(toast()).toBeNull();
    });

    it("does not bring a dismissed finished toast back for a late item update", async () => {
        setDebug(true);
        settings.offerLogCopyAfterPass = true;
        beginWorkIndicator({stages: ["lookup"]});
        await vi.advanceTimersByTimeAsync(0); // the setting is read asynchronously
        reportWorkStage("lookup", "Looking up 1 DOI…");
        settle();
        setWorkItems([{id: "i0", label: "Paper 0", status: "pending"}]);
        endWorkIndicator();
        await vi.advanceTimersByTimeAsync(3000);
        settings.offerLogCopyAfterPass = false;

        button("close").click();
        expect(toast()).toBeNull();

        updateWorkItem("i0", "done"); // a straggler arrives after the toast is gone
        vi.advanceTimersByTime(1000);
        expect(toast()).toBeNull();
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
        button("pause").click();
        const pauseRow = toast()!.querySelector<HTMLElement>("[data-flora-work-pause-row]")!;
        expect(pauseRow.style.display).toBe("flex");
        expect(pauseRow.querySelector<HTMLElement>("button")!.style.pointerEvents).toBe("auto");
    });

    it("offers the copy-log button only while debug logging is on", () => {
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
        expect(toast()!.querySelector("[data-flora-work-cancel]")).not.toBeNull();
    });

    it("keeps the finished toast up with the copy offer to hand", async () => {
        setDebug(true);
        settings.offerLogCopyAfterPass = true;
        beginWorkIndicator();
        await vi.advanceTimersByTimeAsync(0); // the setting is read asynchronously
        reportWorkStage("scan", "Scanning this page for DOIs…");
        settle();

        endWorkIndicator();
        vi.advanceTimersByTime(11_000);
        expect(toast()).not.toBeNull();
        expect(label()).toMatch(/^Done in \d+ ms$/);
        expect(track().getAttribute("aria-valuenow")).toBe("100");

        const copy = button("copy");
        copy.click();
        await vi.advanceTimersByTimeAsync(1600);
        expect(buildDebugReport).toHaveBeenCalled();
        expect(writeClipboard).toHaveBeenCalledWith("REPORT");
        expect(copy.textContent).toBe("Copied ✓");
        settings.offerLogCopyAfterPass = false;
    });

    it("holds the toast open after a pass while debug logging is on", async () => {
        setDebug(true);
        settings.offerLogCopyAfterPass = false;
        beginWorkIndicator();
        await vi.advanceTimersByTimeAsync(0);
        reportWorkStage("scan", "Scanning this page for DOIs…");
        settle();

        endWorkIndicator();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(toast(), "debug mode must keep the toast up").not.toBeNull();
        expect(label()).toMatch(/^Done in \d+ ms$/);
        expect(track().getAttribute("aria-valuenow")).toBe("100");
        expect(button("spinner").style.display, "the spinner must stop").toBe("none");
    });

    it("closes the held toast when the reader dismisses it", async () => {
        setDebug(true);
        settings.offerLogCopyAfterPass = false;
        beginWorkIndicator();
        await vi.advanceTimersByTimeAsync(0);
        reportWorkStage("scan", "Scanning this page for DOIs…");
        settle();
        endWorkIndicator();
        await vi.advanceTimersByTimeAsync(10_000);

        button("close").click();

        expect(toast()).toBeNull();
    });

    it("still fades the toast out when debug logging is off", async () => {
        setDebug(false);
        settings.offerLogCopyAfterPass = false;
        beginWorkIndicator();
        await vi.advanceTimersByTimeAsync(0);
        reportWorkStage("scan", "Scanning this page for DOIs…");
        settle();

        endWorkIndicator();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(toast()).toBeNull();
    });

    it("pins the label's colour so a page rule cannot repaint it", () => {
        beginWorkIndicator();
        reportWorkStage("scan", "Scanning this page for DOIs…");
        settle();

        const labelEl = toast()!.querySelector<HTMLElement>("[data-flora-work-label]")!;
        expect(labelEl.style.getPropertyPriority("color")).toBe("important");
        expect(labelEl.style.getPropertyValue("color")).toBe("inherit");
        expect(toast()!.style.getPropertyValue("color")).toBe("rgb(255, 255, 255)");
        expect(toast()!.style.getPropertyPriority("color")).toBe("important");
    });

    it("keeps an element's own colour rather than flattening it", () => {
        beginWorkIndicator();
        reportWorkStage("scan", "Scanning this page for DOIs…");
        settle();
        expand();

        const dimmed = [...toast()!.querySelectorAll<HTMLElement>("*")].filter(
            (el) => /^rgba\(255,\s*255,\s*255,/.test(el.style.getPropertyValue("color"))
        );
        expect(dimmed.length, "the dimmed stage text should survive").toBeGreaterThan(0);
        for (const el of dimmed) {
            expect(el.style.getPropertyPriority("color")).toBe("important");
        }
    });

    it("reports one Done for a burst of back-to-back passes", async () => {
        setDebug(true);
        const done: string[] = [];
        const record = () => {
            const text = label();
            if (text.startsWith("Done in")) done.push(text);
        };

        for (const stage of ["scan", "lookup", "notices"] as const) {
            beginWorkIndicator({stages: [stage]});
            await vi.advanceTimersByTimeAsync(0);
            reportWorkStage(stage, `Working on ${stage}…`);
            settle();
            endWorkIndicator();
            await vi.advanceTimersByTimeAsync(200);
            record();
        }
        await vi.advanceTimersByTimeAsync(3000);
        record();

        expect(done).toEqual([expect.stringMatching(/^Done in /)]);
    });

    it("times the whole burst, not just the last pass in it", async () => {
        setDebug(true);
        let clock = 0;
        const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
        try {
            beginWorkIndicator({stages: ["scan"]});
            await vi.advanceTimersByTimeAsync(0);
            reportWorkStage("scan", "Scanning…");
            settle();
            clock = 40;
            endWorkIndicator();

            clock = 340;
            await vi.advanceTimersByTimeAsync(300);
            beginWorkIndicator({stages: ["lookup"]});
            await vi.advanceTimersByTimeAsync(0);
            reportWorkStage("lookup", "Looking up…");
            settle();
            clock = 400;
            endWorkIndicator();
            await vi.advanceTimersByTimeAsync(3000);

            expect(label(), "the clock must span the whole burst").toBe("Done in 400 ms");
        } finally {
            nowSpy.mockRestore();
        }
    });

    it("reports one Done for a load held under a single lease", async () => {
        setDebug(true);
        const done: string[] = [];
        const record = () => {
            if (label().startsWith("Done in")) done.push(label());
        };

        beginWorkIndicator();
        await vi.advanceTimersByTimeAsync(0);
        for (const stage of ["scan", "lookup", "notices"] as const) {
            beginWorkIndicator({stages: [stage]});
            reportWorkStage(stage, `Working on ${stage}…`);
            settle();
            endWorkIndicator();
            await vi.advanceTimersByTimeAsync(4000);
            record();
        }
        expect(done, "nothing may report Done while the lease is held").toEqual([]);

        endWorkIndicator();
        await vi.advanceTimersByTimeAsync(11_000);
        record();

        expect(done).toEqual([expect.stringMatching(/^Done in /)]);
    });

    async function runPass(stage: "scan" | "lookup"): Promise<void> {
        beginWorkIndicator({stages: [stage]});
        await vi.advanceTimersByTimeAsync(0);
        reportWorkStage(stage, `Working on ${stage}…`);
        settle();
        endWorkIndicator();
        await vi.advanceTimersByTimeAsync(3000);
    }

    it("stays silent until the page stops working", async () => {
        setDebug(true);
        const seen: string[] = [];

        for (const stage of ["scan", "lookup", "notices"] as const) {
            beginWorkIndicator({stages: [stage]});
            await vi.advanceTimersByTimeAsync(0);
            reportWorkStage(stage, `Working on ${stage}…`);
            settle();
            endWorkIndicator();
            await vi.advanceTimersByTimeAsync(1500);
            if (label().startsWith("Done in")) seen.push(label());
        }

        expect(seen, "no summary while passes keep arriving").toEqual([]);

        await vi.advanceTimersByTimeAsync(3000);
        expect(label(), "one summary once the page is quiet").toMatch(/^Done in /);
    });

    it("does not summarise over a pass that outlasts the quiet window", async () => {
        setDebug(true);
        beginWorkIndicator({stages: ["scan"]});
        await vi.advanceTimersByTimeAsync(0);
        reportWorkStage("scan", "Scanning…");
        settle();
        endWorkIndicator();

        await vi.advanceTimersByTimeAsync(1500);
        beginWorkIndicator({stages: ["lookup"]});
        await vi.advanceTimersByTimeAsync(0);
        reportWorkStage("lookup", "Looking up 40 DOIs…");

        await vi.advanceTimersByTimeAsync(4000);
        expect(label(), "a summary must not land mid-pass").toBe("Looking up 40 DOIs…");

        endWorkIndicator();
        await vi.advanceTimersByTimeAsync(3000);
        expect(label()).toMatch(/^Done in /);
    });

    it("times the whole page, not the pass that happened to finish last", async () => {
        setDebug(true);
        let clock = 0;
        const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
        try {
            beginWorkIndicator({stages: ["scan"]});
            await vi.advanceTimersByTimeAsync(0);
            reportWorkStage("scan", "Scanning…");
            settle();
            clock = 40;
            endWorkIndicator();

            clock = 340;
            await vi.advanceTimersByTimeAsync(300);
            beginWorkIndicator({stages: ["lookup"]});
            await vi.advanceTimersByTimeAsync(0);
            reportWorkStage("lookup", "Looking up…");
            settle();
            clock = 400;
            endWorkIndicator();
            await vi.advanceTimersByTimeAsync(3000);

            expect(label()).toBe("Done in 400 ms");
        } finally {
            nowSpy.mockRestore();
        }
    });

    it("shows work that resumes later, and never counts backwards", async () => {
        setDebug(true);
        let clock = 0;
        const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
        try {
            beginWorkIndicator({stages: ["scan"]});
            await vi.advanceTimersByTimeAsync(0);
            reportWorkStage("scan", "Scanning…");
            settle();
            clock = 100;
            endWorkIndicator();
            await vi.advanceTimersByTimeAsync(3000);
            expect(label()).toBe("Done in 100 ms");

            clock = 9_000;
            beginWorkIndicator({stages: ["lookup"]});
            await vi.advanceTimersByTimeAsync(0);
            reportWorkStage("lookup", "Looking up 3 DOIs…");
            settle();
            expect(label(), "resumed work must be visible").toBe("Looking up 3 DOIs…");

            clock = 9_500;
            endWorkIndicator();
            await vi.advanceTimersByTimeAsync(3000);

            expect(label(), "the total may only grow").toBe("Done in 9.5 s");
        } finally {
            nowSpy.mockRestore();
        }
    });

    it("summarises again once the page owner declares a new page", async () => {
        setDebug(true);
        let clock = 0;
        const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
        try {
            beginWorkIndicator({stages: ["scan"]});
            await vi.advanceTimersByTimeAsync(0);
            reportWorkStage("scan", "Scanning…");
            settle();
            clock = 100;
            endWorkIndicator();
            await vi.advanceTimersByTimeAsync(3000);
            expect(label()).toBe("Done in 100 ms");

            resetWorkSummary();
            clock = 200;
            beginWorkIndicator({stages: ["lookup"]});
            await vi.advanceTimersByTimeAsync(0);
            reportWorkStage("lookup", "Looking up…");
            settle();
            clock = 500;
            endWorkIndicator();
            await vi.advanceTimersByTimeAsync(3000);

            expect(label(), "a new page earns its own summary").toBe("Done in 300 ms");
        } finally {
            nowSpy.mockRestore();
        }
    });

    it("does not restart the clock when the page rewrites its hash or query", async () => {
        setDebug(true);
        let clock = 0;
        const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
        try {
            history.pushState({}, "", "/article");
            beginWorkIndicator({stages: ["scan"]});
            await vi.advanceTimersByTimeAsync(0);
            reportWorkStage("scan", "Scanning…");
            settle();
            clock = 200;
            endWorkIndicator();
            await vi.advanceTimersByTimeAsync(3000);
            expect(label()).toBe("Done in 200 ms");

            history.pushState({}, "", "/article?utm_source=x#section-3");
            clock = 1_000;
            beginWorkIndicator({stages: ["lookup"]});
            await vi.advanceTimersByTimeAsync(0);
            reportWorkStage("lookup", "Looking up…");
            settle();
            clock = 1_200;
            endWorkIndicator();
            await vi.advanceTimersByTimeAsync(3000);

            expect(label(), "a scroll anchor is not a new page").toBe("Done in 1.2 s");
        } finally {
            nowSpy.mockRestore();
        }
    });

    it("sits clear of the setup prompt instead of on top of it", () => {
        const setup = document.createElement("div");
        setup.id = SETUP_PROMPT_ID;
        const card = document.createElement("div");
        Object.defineProperty(card, "offsetHeight", {value: 120, configurable: true});
        setup.appendChild(card);
        document.body.appendChild(setup);

        expect(floatingBottom(), "20px prompt inset + its height + a gap").toBe(150);

        setup.remove();
        expect(floatingBottom(), "back to the corner once the prompt is gone").toBe(18);
    });

    it("waits longer when a planned stage never ran", async () => {
        setDebug(true);
        beginWorkIndicator({stages: ["scan", "augment", "report"]});
        await vi.advanceTimersByTimeAsync(0);
        reportWorkStage("scan", "Found 49 DOIs on this page");
        settle();
        reportWorkStage("report", "Generating report…");
        settle();
        endWorkIndicator();

        await vi.advanceTimersByTimeAsync(4000);
        expect(label(), "augment never ran, so the page is not done").not.toMatch(/^Done in /);

        await vi.advanceTimersByTimeAsync(8000);
        expect(label(), "but it cannot wait forever").toMatch(/^Done in /);
    });

    it("lets the late stage land inside that longer wait", async () => {
        setDebug(true);
        beginWorkIndicator({stages: ["scan", "augment", "report"]});
        await vi.advanceTimersByTimeAsync(0);
        reportWorkStage("scan", "Found 49 DOIs on this page");
        settle();
        reportWorkStage("report", "Generating report…");
        settle();
        endWorkIndicator();

        await vi.advanceTimersByTimeAsync(4000);
        beginWorkIndicator({stages: ["augment"]});
        await vi.advanceTimersByTimeAsync(0);
        reportWorkStage("augment", "Augmenting 3 references without a DOI…");
        settle();
        endWorkIndicator();

        await vi.advanceTimersByTimeAsync(3000);

        expect(label(), "every stage ran, so the short wait applies").toMatch(/^Done in /);
        const rows = [...toast()!.querySelectorAll<HTMLElement>("[data-flora-work-stage]")];
        expect(rows.every((r) => r.dataset.floraWorkState !== "skipped"),
            "no stage should still read as skipped").toBe(true);
    });

    it("cancel stops the pass at the pipeline's next check and hides the toast", () => {
        beginWorkIndicator();
        reportWorkStage("scan", "Scanning this page for DOIs…");
        settle();
        expand();
        expect(isWorkCancelled()).toBe(false);
        button("cancel").click();
        expect(isWorkCancelled()).toBe(true);
        expect(toast()).toBeNull();
        endWorkIndicator();
        expect(isWorkCancelled()).toBe(true);
        beginWorkIndicator();
        expect(isWorkCancelled()).toBe(false);
    });

    it("runs again after a cancel once the reader retries or switches page", () => {
        const cancelPass = (): void => {
            beginWorkIndicator();
            reportWorkStage("scan", "Scanning this page for DOIs…");
            settle();
            button("cancel").click();
            endWorkIndicator();
        };

        cancelPass();
        expect(isWorkCancelled()).toBe(true);
        resumeAutomaticWork(); // an explicit Retry action
        expect(isWorkCancelled()).toBe(false);
        expect(canStartAutomaticWork()).toBe(true);

        cancelPass();
        history.replaceState(null, "", "#gid=2"); // a Sheets tab switch
        expect(canStartAutomaticWork()).toBe(true);
        expect(isWorkCancelled()).toBe(false);
    });

    it("pause row persists the snooze before telling the page to hide", async () => {
        let resolveWrite: (until: number) => void = () => {};
        domainWrites.snoozeDomain.mockImplementationOnce(
            () => new Promise<number>((resolve) => { resolveWrite = resolve; }),
        );
        const paused = vi.fn();
        document.addEventListener("flora-pause-site", paused);

        beginWorkIndicator();
        reportWorkStage("scan", "Scanning this page for DOIs…");
        settle();
        button("pause").click();
        const pauseRow = toast()!.querySelector<HTMLElement>("[data-flora-work-pause-row]")!;
        pauseRow.querySelector<HTMLButtonElement>("button")!.click(); // "Pause 1 hour"

        expect(domainWrites.snoozeDomain).toHaveBeenCalledWith(location.hostname, 3_600_000);
        expect(toast()).toBeNull();
        expect(paused).not.toHaveBeenCalled();

        resolveWrite(Date.now() + 3_600_000);
        await vi.advanceTimersByTimeAsync(0);
        expect(paused).toHaveBeenCalledTimes(1);
        document.removeEventListener("flora-pause-site", paused);
    });
});
