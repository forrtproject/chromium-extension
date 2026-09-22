import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

// safeSendMessage retries when no listener received the message, and when the
// worker stopped before answering, except for requests that must not run twice.
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

    // Observed in Chrome 152 when the worker is stopped while FLORA_RET_CHECK is pending.
    const CHANNEL_CLOSED = "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received";

    it.each([
        CHANNEL_CLOSED,
        "The message port closed before a response was received.",
    ])("retries a read after the worker stopped before answering: %s", async (message) => {
        send
            .mockRejectedValueOnce(new Error(message))
            .mockResolvedValueOnce({type: "FLORA_RET_CHECK_RESULT", results: []});
        const {safeSendMessage} = await import("../../src/shared/messages");

        const pending = safeSendMessage({type: "FLORA_RET_CHECK", dois: []});
        await vi.advanceTimersByTimeAsync(300);
        await expect(pending).resolves.toEqual({type: "FLORA_RET_CHECK_RESULT", results: []});
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("stops retrying a closed channel at the caller's deadline", async () => {
        send.mockRejectedValue(new Error(CHANNEL_CLOSED));
        const {safeSendMessage} = await import("../../src/shared/messages");
        const deadline = new AbortController();

        const pending = safeSendMessage({type: "FLORA_RET_CHECK", dois: []}, deadline.signal);
        const failure = expect(pending).rejects.toThrow("deadline");
        await vi.advanceTimersByTimeAsync(300);
        deadline.abort(new Error("deadline"));
        await failure;
        await vi.advanceTimersByTimeAsync(5000);
        const checks = send.mock.calls.filter(([m]) => m.type === "FLORA_RET_CHECK");
        expect(checks).toHaveLength(2);
    });

    it.each(["FLORA_CREATE_SET", "FLORA_OPEN_OPTIONS"])("does not resend %s after a closed channel", async (type) => {
        send.mockRejectedValue(new Error(CHANNEL_CLOSED));
        const {safeSendMessage} = await import("../../src/shared/messages");
        await expect(safeSendMessage({type, dois: []})).rejects.toThrow(CHANNEL_CLOSED);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("resolves undefined when the extension context is gone", async () => {
        send.mockRejectedValue(new Error("Extension context invalidated."));
        const {safeSendMessage} = await import("../../src/shared/messages");
        await expect(safeSendMessage({type: "FLORA_LOOKUP", dois: []})).resolves.toBeUndefined();
        expect(send).toHaveBeenCalledTimes(1);
    });
});
