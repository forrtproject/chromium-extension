import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

// safeSendMessage retries when Chrome reports the worker unreachable (a
// message that arrived while the idle worker was shutting down); other
// failures surface immediately and a dead context resolves to undefined.
describe("safeSendMessage retry", () => {
    const send = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        send.mockReset();
    });
    afterEach(() => vi.useRealTimers());

    it("retries after 'Receiving end does not exist' and returns the later answer", async () => {
        send
            .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
            .mockResolvedValueOnce({type: "FLORA_RET_CHECK_RESULT", results: []});
        const {safeSendMessage} = await import("../../src/shared/messages");

        const pending = safeSendMessage({type: "FLORA_RET_CHECK", dois: []});
        await vi.advanceTimersByTimeAsync(300);
        await expect(pending).resolves.toEqual({type: "FLORA_RET_CHECK_RESULT", results: []});
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("gives up after the back-off schedule and rethrows", async () => {
        send.mockRejectedValue(new Error("Could not establish connection. Receiving end does not exist."));
        const {safeSendMessage, SEND_RETRY_DELAYS_MS} = await import("../../src/shared/messages");

        const pending = safeSendMessage({type: "FLORA_LOOKUP", dois: []});
        const failure = expect(pending).rejects.toThrow(/Receiving end/);
        for (const delay of SEND_RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
        await failure;
        expect(send).toHaveBeenCalledTimes(SEND_RETRY_DELAYS_MS.length + 1);
    });

    it("does not retry other errors", async () => {
        send.mockRejectedValue(new Error("Something else"));
        const {safeSendMessage} = await import("../../src/shared/messages");
        await expect(safeSendMessage({type: "FLORA_LOOKUP", dois: []})).rejects.toThrow("Something else");
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("resolves undefined when the extension context is gone", async () => {
        send.mockRejectedValue(new Error("Extension context invalidated."));
        const {safeSendMessage} = await import("../../src/shared/messages");
        await expect(safeSendMessage({type: "FLORA_LOOKUP", dois: []})).resolves.toBeUndefined();
        expect(send).toHaveBeenCalledTimes(1);
    });
});
