import {abortableDelay, fetchWithDeadline, activeWorkSignal} from "./work-cancellation";
import {debugWarn} from "./debug";

/** Run `worker` over `items` with at most `limit` in flight. */
export async function mapWithLimit<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    let next = 0;
    const runners = Array.from({length: Math.min(limit, items.length)}, async () => {
        while (next < items.length) {
            await worker(items[next++]);
        }
    });
    await Promise.all(runners);
}

const DEFAULT_BACKOFF_MS = 1_000;
/** Longest pause a request will sit out; a longer Retry-After blocks the platform instead. */
const MAX_WAIT_MS = 5_000;

function parseRetryAfter(header: string | null): number | null {
    if (!header) return null;
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const at = Date.parse(header);
    return Number.isNaN(at) ? null : at - Date.now();
}


/**
 * Per-platform fetch gate: caps concurrent requests, spaces their starts by
 * `minIntervalMs`, and on HTTP 429 pauses the platform for `Retry-After`
 * (default 1 s). A short pause is waited out and the request retried once; a
 * long one (an exhausted daily budget) blocks the platform until it lapses,
 * and requests arriving meanwhile fail at once instead of queueing.
 */
export class RequestGate {
    private active = 0;
    private readonly waiting: Array<() => void> = [];
    private blockedUntil = 0;
    /** Start times reserved by requests that are still spacing-relevant. */
    private reservedStarts: number[] = [];

    constructor(
        private readonly name: string,
        private readonly maxConcurrent: number,
        private readonly minIntervalMs = 0,
    ) {}

    async fetch(url: string, init?: RequestInit): Promise<Response> {
        const signal = (init?.signal === undefined ? activeWorkSignal() : init.signal) ?? new AbortController().signal;
        signal.throwIfAborted();
        await this.acquire(signal);
        let reserved: number | undefined;
        try {
            for (let attempt = 0; ; attempt++) {
                // Reserve a start slot again if another in-flight request
                // extended the cooldown while we slept. Re-reserving also
                // preserves spacing when several sleepers wake together.
                do {
                    if (reserved !== undefined) reserved = this.releaseReservation(reserved);
                    const now = Date.now();
                    this.reservedStarts = this.reservedStarts.filter(start => start + this.minIntervalMs > now);
                    const startAt = this.earliestStart(now);
                    if (startAt - now > MAX_WAIT_MS) {
                        throw new Error(`${this.name} rate limited (paused for another ${Math.round((startAt - now) / 1000)} s)`);
                    }
                    reserved = startAt;
                    this.reservedStarts.push(startAt);
                    if (startAt > now) {
                        try {
                            await abortableDelay(startAt - now, signal);
                        } catch (err) {
                            // Hand back this start slot so a retry is not spaced
                            // behind one nobody uses. Every cancelled sleeper
                            // returns its own, so several cancelled together
                            // free every slot they held.
                            reserved = this.releaseReservation(startAt);
                            throw err;
                        }
                    }
                } while (this.blockedUntil > Date.now());

                if (signal.aborted) reserved = this.releaseReservation(reserved);
                signal.throwIfAborted();
                const response = await fetchWithDeadline(url, {...init, signal});
                if (response.status !== 429) return response;

                const backoff = parseRetryAfter(response.headers.get("retry-after")) ?? DEFAULT_BACKOFF_MS;
                this.blockedUntil = Math.max(this.blockedUntil, Date.now() + backoff);
                if (attempt > 0) return response;
                if (backoff > MAX_WAIT_MS) {
                    debugWarn(`${this.name}: HTTP 429 with Retry-After ${Math.round(backoff / 1000)} s — pausing this platform until then`);
                    return response;
                }
                debugWarn(`${this.name}: HTTP 429 — pausing ${backoff} ms, then retrying once`);
            }
        } finally {
            this.release();
        }
    }

    private releaseReservation(startAt: number): undefined {
        const index = this.reservedStarts.indexOf(startAt);
        if (index >= 0) this.reservedStarts.splice(index, 1);
        return undefined;
    }

    private earliestStart(now: number): number {
        let candidate = Math.max(now, this.blockedUntil);
        for (const start of [...this.reservedStarts].sort((a, b) => a - b)) {
            if (Math.abs(candidate - start) < this.minIntervalMs) candidate = start + this.minIntervalMs;
        }
        return candidate;
    }

    private acquire(signal: AbortSignal): Promise<void> {
        if (this.active < this.maxConcurrent) {
            this.active++;
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const start = () => {
                signal.removeEventListener("abort", abort);
                this.active++;
                resolve();
            };
            const abort = () => {
                const index = this.waiting.indexOf(start);
                if (index >= 0) this.waiting.splice(index, 1);
                reject(signal.reason);
            };
            signal.addEventListener("abort", abort, {once: true});
            this.waiting.push(start);
        });
    }

    private release(): void {
        this.active--;
        this.waiting.shift()?.();
    }
}
