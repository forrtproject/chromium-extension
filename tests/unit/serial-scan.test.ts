import { describe, it, expect, vi } from "vitest";
import { serializeWithRerun } from "../../src/content-general/serial-scan";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}

describe("serializeWithRerun", () => {
    it("does not start a second run while one is in flight", async () => {
        const gate = deferred();
        const run = vi.fn(() => gate.promise);
        const scan = serializeWithRerun(run);

        void scan();
        void scan();
        expect(run).toHaveBeenCalledTimes(1);

        gate.resolve();
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    });

    it("collapses many overlapping triggers into a single rerun", async () => {
        const gate = deferred();
        const run = vi.fn(() => gate.promise);
        const scan = serializeWithRerun(run);

        const first = scan();
        void scan();
        void scan();
        void scan();

        gate.resolve();
        await first;

        expect(run).toHaveBeenCalledTimes(2);
    });

    it("does not rerun when nothing was triggered during the run", async () => {
        const run = vi.fn(async () => {});
        const scan = serializeWithRerun(run);

        await scan();

        expect(run).toHaveBeenCalledTimes(1);
    });

    it("hands overlapping callers the in-flight run", async () => {
        const gate = deferred();
        const run = vi.fn(() => gate.promise);
        const scan = serializeWithRerun(run);

        const first = scan();
        const second = scan();
        expect(second).toBe(first);

        gate.resolve();
        await Promise.all([first, second]);
    });

    it("starts a fresh run after the previous one settled", async () => {
        const run = vi.fn(async () => {});
        const scan = serializeWithRerun(run);

        await scan();
        await scan();

        expect(run).toHaveBeenCalledTimes(2);
    });

    it("clears the in-flight slot when a run throws", async () => {
        const run = vi.fn(async () => { throw new Error("scan blew up"); });
        const scan = serializeWithRerun(run);

        await expect(scan()).rejects.toThrow("scan blew up");
        await expect(scan()).rejects.toThrow("scan blew up");

        expect(run).toHaveBeenCalledTimes(2);
    });
});
