import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../../src/shared/domains", () => ({
    getSnooze: vi.fn(async () => null),
    isDomainBlocked: vi.fn(async () => false),
    blockDomain: vi.fn(async () => undefined),
    snoozeDomain: vi.fn(async () => Date.now() + 3_600_000),
}));

import {
    noteScanEnded,
    noteScanError,
    noteScanUpdated,
    setScanSummarySource,
    _resetToolbarScanForTesting,
    type ScanSummary,
} from "../../src/shared/toolbar-scan";
import {
    beginWorkIndicator,
    endWorkIndicator,
    hideWorkIndicator,
    showWorkIndicator,
    reportWorkStage,
    resetWorkSummary,
    _resetWorkIndicatorForTesting,
} from "../../src/shared/progress-toast";
import {_resetActiveStateForTesting, reportActiveState} from "../../src/shared/active-state";

type Sent = {type?: string; active?: boolean; state?: {phase: string; [key: string]: unknown}};

function sent(): Sent[] {
    return (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls
        .map(([msg]) => msg as Sent)
        .filter((msg) => msg.type === "FLORA_SCAN_STATE" || msg.type === "FLORA_ACTIVE_STATE");
}

function states(): NonNullable<Sent["state"]>[] {
    return sent().filter((msg) => msg.type === "FLORA_SCAN_STATE").map((msg) => msg.state!);
}

let summary: ScanSummary | null;

function useSource(): void {
    setScanSummarySource(() => summary);
}

function pass(): void {
    beginWorkIndicator({stages: ["scan", "lookup", "report"]});
    endWorkIndicator();
}

describe("what the content script tells the toolbar about a scan", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);
        _resetToolbarScanForTesting();
        _resetWorkIndicatorForTesting();
        _resetActiveStateForTesting();
        summary = {papers: 2, flagged: 1, incomplete: false};
    });

    afterEach(() => {
        _resetWorkIndicatorForTesting();
        _resetToolbarScanForTesting();
        vi.useRealTimers();
    });

    it("stays silent without a summary source", () => {
        pass();

        expect(sent()).toEqual([]);
    });

    it("reports scanning at once, then the result when the work settles", () => {
        useSource();

        beginWorkIndicator({stages: ["scan", "lookup", "report"]});
        expect(states()).toEqual([{phase: "scanning", papers: 2}]);

        endWorkIndicator();
        expect(states().at(-1)).toEqual({phase: "done", papers: 2, flagged: 1, incomplete: false});
    });

    it("does not repeat an identical result", () => {
        useSource();
        pass();
        const before = states().length;

        pass();

        expect(states()).toHaveLength(before);
    });

    it("shows a re-scan only if it is still running after the delay", () => {
        useSource();
        pass();
        const before = states().length;

        beginWorkIndicator({stages: ["scan"]});
        vi.advanceTimersByTime(399);
        expect(states()).toHaveLength(before);
        vi.advanceTimersByTime(1);
        expect(states().at(-1)!.phase).toBe("scanning");
        endWorkIndicator();
    });

    it("sends no scanning state for a quick re-scan", () => {
        useSource();
        pass();
        const before = states().length;

        beginWorkIndicator({stages: ["scan"]});
        vi.advanceTimersByTime(100);
        endWorkIndicator();
        vi.advanceTimersByTime(1000);

        expect(states()).toHaveLength(before);
    });

    it("refreshes the paper count when the lookup stage starts", async () => {
        useSource();
        beginWorkIndicator({stages: ["scan", "lookup", "report"]});
        summary = {papers: 5, flagged: 0, incomplete: false};

        reportWorkStage("lookup", "Looking up");
        await Promise.resolve();

        expect(states().at(-1)).toEqual({phase: "scanning", papers: 5});
        endWorkIndicator();
    });

    it("returns to the plain active state when the user cancels", () => {
        useSource();
        beginWorkIndicator({stages: ["scan"]});

        noteScanEnded(true, false);

        expect(sent().at(-1)).toMatchObject({type: "FLORA_ACTIVE_STATE", active: true});
    });

    it("returns to the plain active state when no papers were found", () => {
        useSource();
        summary = {papers: 0, flagged: 0, incomplete: false};

        pass();

        expect(states().map((s) => s.phase)).toEqual(["scanning"]);
        expect(sent().at(-1)).toMatchObject({type: "FLORA_ACTIVE_STATE", active: true});
    });

    it("reports nothing at the end when the page is hidden", () => {
        useSource();
        summary = null;

        pass();

        expect(sent()).toEqual([]);
    });

    it("re-reports a finished page when its results change", () => {
        useSource();
        pass();
        summary = {papers: 2, flagged: 2, incomplete: false};

        noteScanUpdated();

        expect(states().at(-1)).toEqual({phase: "done", papers: 2, flagged: 2, incomplete: false});
    });

    it("ignores late updates while a scan is running", () => {
        useSource();
        pass();
        beginWorkIndicator({stages: ["scan"]});
        const before = sent().length;
        summary = {papers: 9, flagged: 9, incomplete: false};

        noteScanUpdated();

        expect(sent()).toHaveLength(before);
        endWorkIndicator();
    });

    describe("an error", () => {
        it("is reported with the page and the log tail", () => {
            useSource();

            noteScanError({message: "TypeError: x", where: "scan"});

            expect(states()).toEqual([expect.objectContaining({
                phase: "error",
                pageUrl: location.href,
                error: {message: "TypeError: x", stack: undefined, where: "scan"},
                entries: expect.any(Array),
            })]);
        });

        it("sticks through later passes", () => {
            useSource();
            noteScanError({message: "TypeError: x"});
            const before = sent().length;

            pass();

            expect(sent()).toHaveLength(before);
        });

        it("clears when the page is reset", () => {
            useSource();
            noteScanError({message: "TypeError: x"});

            resetWorkSummary();

            expect(sent().at(-1)).toMatchObject({type: "FLORA_ACTIVE_STATE", active: true});
        });

        it.each([
            "Extension context invalidated.",
            "Could not establish connection. Receiving end does not exist.",
            "The message port closed before a response was received.",
            "AbortError: The operation was aborted",
        ])("ignores %s", (message) => {
            noteScanError({message});

            expect(sent()).toEqual([]);
        });

        it("redacts contact details from the message, stack and page", () => {
            window.history.replaceState({}, "", "/?mailto=reader%40example.org");

            noteScanError({
                message: "Error: failed for reader@example.org",
                stack: "at fetch (https://api.example/?mailto=reader%40example.org)",
            });

            const payload = JSON.stringify(states());
            expect(payload).not.toContain("example.org");
            expect(payload).toContain("[redacted");
            window.history.replaceState({}, "", "/");
        });

        it("truncates a very long message", () => {
            noteScanError({message: "E".repeat(900)});

            expect((states()[0] as unknown as {error: {message: string}}).error.message).toHaveLength(500);
        });
    });

    it("stays quiet after the popup hides the page's UI", () => {
        useSource();
        pass();
        const before = sent().length;

        hideWorkIndicator();
        resetWorkSummary();

        expect(sent()).toHaveLength(before);
    });

    it("tells the toolbar the finished result again when the UI is shown after a hide", async () => {
        useSource();
        pass();
        hideWorkIndicator();
        const before = states().length;

        showWorkIndicator();
        await Promise.resolve();

        expect(states()).toHaveLength(before + 1);
        expect(states().at(-1)).toEqual({phase: "done", papers: 2, flagged: 1, incomplete: false});
    });

    it("replays the last toolbar report when the page returns from the back-forward cache", () => {
        reportActiveState(true);
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear();

        window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: true}));

        expect(sent()).toEqual([expect.objectContaining({type: "FLORA_ACTIVE_STATE", active: true})]);
    });

    it("replays a scan result after a back-forward cache restore", () => {
        useSource();
        pass();
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear();

        window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: true}));

        expect(states()).toEqual([{phase: "done", papers: 2, flagged: 1, incomplete: false}]);
    });

    it("does not replay on an ordinary page show", () => {
        reportActiveState(true);
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear();

        window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: false}));

        expect(sent()).toEqual([]);
    });
});
