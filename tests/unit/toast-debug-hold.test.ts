import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {showToast, dismissToast} from "../../src/shared/toast";
import {setDebug, _resetDebugForTesting} from "../../src/shared/debug";

function alertToast(): HTMLElement | null {
    return document.querySelector<HTMLElement>("[data-flora-tone]");
}

describe("toast timing", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = "";
        _resetDebugForTesting();
    });

    afterEach(() => {
        dismissToast();
        setDebug(false);
        _resetDebugForTesting();
        vi.useRealTimers();
    });

    it("fades an ordinary toast out on its own timer", () => {
        setDebug(false);
        showToast("Checked 3 papers");

        vi.advanceTimersByTime(10_000);

        expect(alertToast()).toBeNull();
    });

    it("still fades an ordinary toast while debug mode is on", () => {
        setDebug(true);
        showToast("Checked 3 papers");

        vi.advanceTimersByTime(10_000);

        expect(alertToast(), "only the progress toast is held in debug mode").toBeNull();
    });

    it("gives a toast without a timeout a close button that dismisses it", () => {
        showToast("Checked 3 papers", {duration: 0});
        vi.advanceTimersByTime(10_000);

        const close = alertToast()!.querySelector<HTMLElement>("[data-flora-toast-close]");
        expect(close, "a toast that never times out needs a way out").not.toBeNull();
        close!.click();
        vi.advanceTimersByTime(400);

        expect(alertToast()).toBeNull();
    });

    it("makes a held toast clickable, not pointer-events:none", () => {
        showToast("Checked 3 papers", {duration: 0});

        expect(alertToast()!.style.pointerEvents).toBe("auto");
    });
});

describe("two toasts at once", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = "";
        _resetDebugForTesting();
    });

    afterEach(() => {
        dismissToast();
        setDebug(false);
        _resetDebugForTesting();
        vi.useRealTimers();
    });

    it("closing the action toast leaves the timed one on its own timer", () => {
        setDebug(false);
        showToast("Checked 3 papers");
        showToast("ORE hit an error on this page.", {
            tone: "error",
            action: {label: "Report it", onClick: () => undefined},
        });

        document.getElementById("flora-alert-toast")!
            .querySelector<HTMLElement>("[data-flora-toast-close]")!.click();
        expect(document.getElementById("flora-alert-toast")).toBeNull();
        expect(document.getElementById("flora-action-toast"), "the routine toast survives").not.toBeNull();

        vi.advanceTimersByTime(10_000);

        expect(document.getElementById("flora-action-toast"), "and still times out").toBeNull();
    });
});
