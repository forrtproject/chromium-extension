import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

const snooze = vi.hoisted(() => ({getSnooze: vi.fn(async () => null as number | null)}));
vi.mock("../../src/shared/domains", () => snooze);

import {
    reportActiveState,
    reportInactive,
    _resetActiveStateForTesting,
} from "../../src/shared/active-state";

type State = {type?: string; active?: boolean; snoozedUntil?: number | null};

function sent(): State[] {
    return (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls
        .map(([m]) => m as State)
        .filter((m) => m.type === "FLORA_ACTIVE_STATE");
}

describe("what the toolbar is told about this tab", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        _resetActiveStateForTesting();
        snooze.getSnooze.mockReset().mockResolvedValue(null);
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => {
        _resetActiveStateForTesting();
        vi.useRealTimers();
    });

    it("carries the snooze when a paused page goes quiet", async () => {
        const until = Date.now() + 60_000;
        snooze.getSnooze.mockResolvedValue(until);

        reportInactive();
        await vi.advanceTimersByTimeAsync(0);

        expect(sent().at(-1)).toMatchObject({active: false, snoozedUntil: until});
    });

    it("lets a show that lands first win over a slower hide", async () => {
        let release!: (v: number | null) => void;
        snooze.getSnooze.mockReturnValue(new Promise((r) => { release = r; }));

        reportInactive();
        reportActiveState(true);
        release(Date.now() + 60_000);
        await vi.advanceTimersByTimeAsync(0);

        expect(sent().at(-1), "the stale hide must not overwrite the show")
            .toMatchObject({active: true});
    });

    it("clears the badge once the pause has actually lapsed", async () => {
        const until = Date.now() + 90 * 60_000;
        snooze.getSnooze.mockResolvedValue(until);
        reportActiveState(false, until);

        snooze.getSnooze.mockResolvedValue(null);
        await vi.advanceTimersByTimeAsync(90 * 60_000 + 10);

        expect(sent().at(-1)).toMatchObject({active: false, snoozedUntil: null});
    });

    it("schedules that clear for an Until-tomorrow pause set after midnight", async () => {
        const until = Date.now() + 30 * 60 * 60_000;
        snooze.getSnooze.mockResolvedValue(until);
        reportActiveState(false, until);

        snooze.getSnooze.mockResolvedValue(null);
        await vi.advanceTimersByTimeAsync(30 * 60 * 60_000 + 10);

        expect(sent().at(-1), "a 30-hour pause still gets its timer")
            .toMatchObject({snoozedUntil: null});
    });

    it("leaves the badge alone if the pause was extended meanwhile", async () => {
        const until = Date.now() + 60_000;
        snooze.getSnooze.mockResolvedValue(until);
        reportActiveState(false, until);

        snooze.getSnooze.mockResolvedValue(Date.now() + 3_600_000);
        await vi.advanceTimersByTimeAsync(60_000 + 10);

        expect(sent().at(-1)!.snoozedUntil, "still snoozed, so still badged").toBe(until);
    });
});
