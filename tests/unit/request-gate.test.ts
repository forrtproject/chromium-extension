import {describe, it, expect, vi, afterEach} from "vitest";
import {RequestGate} from "../../src/shared/request-gate";

// Hands the response back unread; these cases exercise scheduling, not body reads.
const passThrough = async (response: Response) => response;

function deferredFetch() {
    const pending: Array<(r: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
    vi.stubGlobal("fetch", fetchMock);
    return {fetchMock, pending};
}

describe("RequestGate", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("honours a longer cooldown returned by the final retry", async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response("", {status: 429, headers: {"retry-after": "1"}}))
            .mockResolvedValueOnce(new Response("", {status: 429, headers: {"retry-after": "60"}}))
            .mockResolvedValue(new Response("ok"));
        vi.stubGlobal("fetch", fetchMock);
        const gate = new RequestGate("Test", 1);
        const request = gate.fetch("https://x/1", undefined, passThrough);
        await vi.advanceTimersByTimeAsync(1000);
        expect((await request).status).toBe(429);
        await expect(gate.fetch("https://x/2", undefined, passThrough)).rejects.toThrow(/rate limited/);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(60000);
        expect((await gate.fetch("https://x/3", undefined, passThrough)).status).toBe(200);
    });

    it("rechecks a cooldown learned while another request waits for its start slot", async () => {
        vi.useFakeTimers();
        const {fetchMock, pending} = deferredFetch();
        const gate = new RequestGate("Test", 2, 1000);
        const first = gate.fetch("https://x/1", undefined, passThrough);
        const second = gate.fetch("https://x/2", undefined, passThrough);
        const secondOutcome = second.then(() => "sent", (err: Error) => err.message);
        await vi.advanceTimersByTimeAsync(100);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        pending.shift()!(new Response("", {status: 429, headers: {"retry-after": "60"}}));
        await first;
        await vi.advanceTimersByTimeAsync(900);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(await secondOutcome).toMatch(/rate limited/);
    });

    it("preserves start spacing when a short cooldown moves multiple waiting requests", async () => {
        vi.useFakeTimers();
        const starts: number[] = [];
        const fetchMock = vi.fn(async () => {
            starts.push(Date.now());
            return starts.length === 1
                ? new Response("", {status: 429, headers: {"retry-after": "2"}})
                : new Response("ok");
        });
        vi.stubGlobal("fetch", fetchMock);
        const gate = new RequestGate("Test", 3, 100);
        const requests = [1, 2, 3].map(i => gate.fetch(`https://x/${i}`, undefined, passThrough));
        await vi.advanceTimersByTimeAsync(2500);
        await Promise.all(requests);
        expect(starts).toHaveLength(4);
        for (let i = 1; i < starts.length; i++) {
            expect(starts[i]).toBeGreaterThanOrEqual(starts[0] + 2_000);
            expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(100);
        }
    });

    it("keeps at most the configured number of requests in flight", async () => {
        const {fetchMock, pending} = deferredFetch();
        const gate = new RequestGate("Test", 2);
        const calls = [1, 2, 3, 4].map((i) => gate.fetch(`https://x/${i}`, undefined, passThrough));
        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        pending.shift()!(new Response("", {status: 200}));
        await calls[0];
        expect(fetchMock).toHaveBeenCalledTimes(3);
        for (const resolve of pending.splice(0)) resolve(new Response("", {status: 200}));
        await Promise.all(calls.slice(1, 3));
        expect(fetchMock).toHaveBeenCalledTimes(4);
        pending.shift()!(new Response("", {status: 200}));
        await Promise.all(calls);
        vi.unstubAllGlobals();
    });

    it("waits out Retry-After on a 429 and retries once", async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response("", {status: 429, headers: {"retry-after": "2"}}))
            .mockResolvedValueOnce(new Response("ok", {status: 200}));
        vi.stubGlobal("fetch", fetchMock);
        const gate = new RequestGate("Test", 1);
        const request = gate.fetch("https://x/1", undefined, passThrough);
        await vi.advanceTimersByTimeAsync(1_999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(2);
        expect((await request).status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("hands back the start slot when the wait is cancelled", async () => {
        vi.useFakeTimers();
        const starts: number[] = [];
        const fetchMock = vi.fn(async () => { starts.push(Date.now()); return new Response("ok"); });
        vi.stubGlobal("fetch", fetchMock);
        const gate = new RequestGate("Test", 3, 1000);
        const t0 = Date.now();
        await gate.fetch("https://x/1", undefined, passThrough);
        const controller = new AbortController();
        const cancelled = gate.fetch("https://x/2", {signal: controller.signal}, passThrough);
        const outcome = expect(cancelled).rejects.toMatchObject({name: "AbortError"});
        controller.abort(new DOMException("Work cancelled", "AbortError"));
        await outcome;
        const next = gate.fetch("https://x/3", {signal: new AbortController().signal}, passThrough);
        await vi.advanceTimersByTimeAsync(1000);
        await next;
        expect(starts.map((at) => at - t0)).toEqual([0, 1000]);
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("reuses a start slot freed between two later reservations", async () => {
        vi.useFakeTimers();
        const starts: number[] = [];
        const fetchMock = vi.fn(async () => { starts.push(Date.now()); return new Response("ok"); });
        vi.stubGlobal("fetch", fetchMock);
        const gate = new RequestGate("Test", 4, 1000);
        const t0 = Date.now();

        const first = gate.fetch("https://x/1", {signal: new AbortController().signal}, passThrough);
        const controller = new AbortController();
        const cancelled = gate.fetch("https://x/2", {signal: controller.signal}, passThrough);
        const outcome = expect(cancelled).rejects.toMatchObject({name: "AbortError"});
        const third = gate.fetch("https://x/3", {signal: new AbortController().signal}, passThrough);
        await vi.advanceTimersByTimeAsync(0);

        controller.abort(new DOMException("Work cancelled", "AbortError"));
        await outcome;

        const fourth = gate.fetch("https://x/4", {signal: new AbortController().signal}, passThrough);
        await vi.advanceTimersByTimeAsync(3000);
        await Promise.all([first, third, fourth]);

        expect(starts.map((at) => at - t0)).toEqual([0, 1000, 2000]);
    });

    it("frees the slot when a request is cancelled after reserving but before sending", async () => {
        vi.useFakeTimers();
        const starts: number[] = [];
        const fetchMock = vi.fn(async () => { starts.push(Date.now()); return new Response("ok"); });
        vi.stubGlobal("fetch", fetchMock);
        const gate = new RequestGate("Test", 4, 1000);
        const t0 = Date.now();

        const controller = new AbortController();
        const cancelled = gate.fetch("https://x/1", {signal: controller.signal}, passThrough);
        const outcome = expect(cancelled).rejects.toMatchObject({name: "AbortError"});
        controller.abort(new DOMException("Work cancelled", "AbortError"));
        await outcome;
        expect(fetchMock).not.toHaveBeenCalled();

        const next = gate.fetch("https://x/2", {signal: new AbortController().signal}, passThrough);
        await vi.advanceTimersByTimeAsync(0);

        expect(starts.map((at) => at - t0)).toEqual([0]);
        await next;
    });

    it("blocks the platform on a long Retry-After instead of queueing behind it", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValue(new Response("", {status: 429, headers: {"retry-after": "39000"}}));
        vi.stubGlobal("fetch", fetchMock);
        const gate = new RequestGate("Test", 2);
        expect((await gate.fetch("https://x/1", undefined, passThrough)).status).toBe(429);
        await expect(gate.fetch("https://x/2", undefined, passThrough)).rejects.toThrow(/rate limited/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it("holds the slot until the response body has been read", async () => {
        let finishBody!: () => void;
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('{"n":1}'));
                    finishBody = () => controller.close();
                },
            })))
            .mockResolvedValue(new Response('{"n":2}'));
        vi.stubGlobal("fetch", fetchMock);
        const gate = new RequestGate("Test", 1);
        const readJson = (response: Response) => response.json();
        const first = gate.fetch("https://x/1", undefined, readJson);
        const second = gate.fetch("https://x/2", undefined, readJson);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        finishBody();
        expect(await first).toEqual({n: 1});
        expect(await second).toEqual({n: 2});
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("cancels a body the reader leaves unread, including a retried 429, before releasing the slot", async () => {
        const cancelled: string[] = [];
        const streamingResponse = (label: string, status: number, headers?: HeadersInit) =>
            new Response(new ReadableStream({cancel: () => { cancelled.push(label); }}), {status, headers});
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(streamingResponse("429", 429, {"retry-after": "0"}))
            .mockResolvedValueOnce(streamingResponse("500", 500))
            .mockResolvedValue(new Response("ok"));
        vi.stubGlobal("fetch", fetchMock);
        const gate = new RequestGate("Test", 1);
        const throwOnError = async (response: Response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
        };
        await expect(gate.fetch("https://x/1", undefined, throwOnError)).rejects.toThrow("HTTP 500");
        expect(cancelled).toEqual(["429", "500"]);
        expect(await gate.fetch("https://x/2", undefined, throwOnError)).toBe("ok");
    });
});
