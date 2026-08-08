import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {writeClipboard, writeRichClipboard} from "../../src/shared/clipboard";

function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
    const exec = vi.fn().mockReturnValue(result);
    (document as unknown as {execCommand: unknown}).execCommand = exec;
    return exec;
}

/** A promise that never settles — Chrome's behaviour on an unfocused document. */
const forever = () => new Promise<never>(() => {});

describe("writeClipboard", () => {
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = "";
    });

    it("uses the async clipboard when it works", async () => {
        stubExecCommand(true);
        await expect(writeClipboard("hello")).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith("hello");
    });

    it("settles rather than hanging when the async write never resolves", async () => {
        // Chrome leaves writeText pending forever while the document lacks
        // focus; without a deadline the caller's "copied" toast never fires.
        vi.useFakeTimers();
        writeText.mockImplementation(forever);
        const exec = stubExecCommand(true);

        const pending = writeClipboard("hello");
        await vi.advanceTimersByTimeAsync(2000);

        await expect(pending).resolves.toBe(true);
        expect(exec).toHaveBeenCalledWith("copy");
    });

    it("falls back to the textarea when the async write rejects", async () => {
        writeText.mockRejectedValue(new Error("blocked"));
        const exec = stubExecCommand(true);
        await expect(writeClipboard("hello")).resolves.toBe(true);
        expect(exec).toHaveBeenCalled();
    });

    it("reports a genuine failure rather than confirming a copy that never landed", async () => {
        writeText.mockRejectedValue(new Error("blocked"));
        stubExecCommand(false);
        await expect(writeClipboard("hello")).resolves.toBe(false);
    });

    it("leaves no textarea behind", async () => {
        writeText.mockRejectedValue(new Error("blocked"));
        stubExecCommand(true);
        await writeClipboard("hello");
        expect(document.querySelector("textarea")).toBeNull();
    });
});

describe("writeRichClipboard", () => {
    beforeEach(() => {
        vi.stubGlobal("ClipboardItem", class {
            constructor(public readonly items: Record<string, Blob>) {}
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = "";
    });

    it("writes both flavours when the rich API works", async () => {
        const write = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {value: {write, writeText: vi.fn()}, configurable: true});

        await expect(writeRichClipboard("<i>x</i>", "x")).resolves.toBe(true);
        expect(Object.keys(write.mock.calls[0][0][0].items)).toEqual(["text/html", "text/plain"]);
    });

    it("drops to plain text rather than hanging when the rich write stalls", async () => {
        vi.useFakeTimers();
        const write = vi.fn().mockImplementation(forever);
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {value: {write, writeText}, configurable: true});

        const pending = writeRichClipboard("<i>x</i>", "x");
        await vi.advanceTimersByTimeAsync(2000);

        await expect(pending).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith("x");
    });
});
