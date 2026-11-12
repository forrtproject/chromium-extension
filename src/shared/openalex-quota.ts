/**
 * OpenAlex daily budget.
 *
 * OpenAlex has required an API key since February 2026. Without one, every
 * client on the same network (IP address) shares a small free budget: 1000
 * credits a day, where a title search costs 10 and a batched id lookup 1. A
 * free key gives that user their own, larger budget. Each response reports what
 * is left (`x-ratelimit-remaining`) and seconds until the reset
 * (`x-ratelimit-reset`); an exhausted budget answers 429.
 *
 * Title matching spends OpenAlex credits only while more than
 * OPENALEX_RESERVE_CREDITS remain, so the cheap id lookups that put pills on
 * openalex.org search pages keep working; Crossref carries title matching alone
 * after that. Runs in the service worker; the state survives worker restarts in
 * session storage.
 */

import {debugLog, debugWarn} from "./debug";

/** Credits kept back for openalex.org id lookups (1 credit per batch of 50). */
export const OPENALEX_RESERVE_CREDITS = 50;
/** What one title search costs. */
export const OPENALEX_TITLE_SEARCH_CREDITS = 10;

interface QuotaState {
    remaining: number;
    /** Epoch ms when the budget refills. */
    resetAt: number;
    /** Whether the budget belongs to an API key (else the shared keyless one). */
    keyed: boolean;
}

export interface OpenAlexLimit {
    resetAt: number;
    keyed: boolean;
}

const SESSION_KEY = "flora_openalex_quota";
let state: QuotaState | null = null;
let loaded: Promise<void> | null = null;

function load(): Promise<void> {
    loaded ??= (async () => {
        try {
            const raw = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] as QuotaState | undefined;
            // A response noted while loading is newer than the stored state.
            if (!state && raw && typeof raw.remaining === "number" && typeof raw.resetAt === "number") state = raw;
        } catch {
            // No session storage (tests, content scripts): keep the in-memory state.
        }
    })();
    return loaded;
}

function persist(): void {
    try {
        void chrome.storage.session.set({[SESSION_KEY]: state}).catch(() => {});
    } catch {
        // See load().
    }
}

function header(response: Response, name: string): number | null {
    const raw = response.headers.get(name);
    if (raw == null || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

/** Retry-After as seconds or an HTTP date; null when absent. */
function retryAfterMs(response: Response): number | null {
    const raw = response.headers.get("retry-after");
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const at = Date.parse(raw);
    return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/** Milliseconds until midnight UTC, when OpenAlex refills keyless budgets. */
function untilMidnightUtc(now: number): number {
    const next = new Date(now);
    next.setUTCHours(24, 0, 0, 0);
    return next.getTime() - now;
}

/** Record the budget an OpenAlex response reports. Call for every response, including errors. */
export function noteOpenAlexResponse(response: Response, keyed: boolean): void {
    const now = Date.now();
    const remaining = header(response, "x-ratelimit-remaining");
    const resetSeconds = header(response, "x-ratelimit-reset");
    if (response.status === 429) {
        const wait = resetSeconds != null ? resetSeconds * 1000 : retryAfterMs(response) ?? untilMidnightUtc(now);
        // A short Retry-After is a per-second burst limit, not the daily budget.
        if (remaining == null && wait < 60_000) return;
        state = {remaining: 0, resetAt: now + wait, keyed};
        debugWarn(`OpenAlex: ${keyed ? "the API key's" : "this network's free"} daily budget is used up until ${new Date(state.resetAt).toISOString()}`);
        persist();
        return;
    }
    if (remaining == null) return;
    const before = state;
    state = {remaining, resetAt: now + (resetSeconds ?? untilMidnightUtc(now) / 1000) * 1000, keyed};
    if (before && before.remaining >= OPENALEX_RESERVE_CREDITS + OPENALEX_TITLE_SEARCH_CREDITS && !titleSearchFits(state)) {
        debugLog(`OpenAlex: ${remaining} credits left — keeping them for openalex.org lookups; title matching continues with Crossref only`);
    }
    persist();
}

function current(keyed: boolean): QuotaState | null {
    // A budget seen without a key says nothing about a newly added key, and vice versa.
    if (!state || state.keyed !== keyed || Date.now() >= state.resetAt) return null;
    return state;
}

function titleSearchFits(s: QuotaState): boolean {
    return s.remaining - OPENALEX_TITLE_SEARCH_CREDITS >= OPENALEX_RESERVE_CREDITS;
}

/** Title searches sent but not yet answered; their cost is not in `remaining` yet. */
let pending = 0;

/**
 * Claim one title search's credits, or return false when it would dip into the
 * reserve. While the budget is unknown only one search goes out, so the first
 * answer can report it before others spend it. Call `releaseTitleSearch` when
 * the request settles.
 */
export async function reserveTitleSearch(keyed: boolean): Promise<boolean> {
    await load();
    const s = current(keyed);
    const fits = s
        ? s.remaining - (pending + 1) * OPENALEX_TITLE_SEARCH_CREDITS >= OPENALEX_RESERVE_CREDITS
        : pending === 0;
    if (fits) pending++;
    return fits;
}

export function releaseTitleSearch(): void {
    pending = Math.max(0, pending - 1);
}

/** Whether any OpenAlex request can succeed now (the budget is not used up). */
export async function openAlexAvailable(keyed: boolean): Promise<boolean> {
    await load();
    const s = current(keyed);
    return !s || s.remaining > 0;
}

/** When title matching is running on Crossref alone because of the budget: until when, and whose budget. */
export async function openAlexTitleLimit(keyed: boolean): Promise<OpenAlexLimit | null> {
    await load();
    const s = current(keyed);
    return s && !titleSearchFits(s) ? {resetAt: s.resetAt, keyed: s.keyed} : null;
}

/** Add the user's OpenAlex API key, when there is one, to a request URL's query. */
export function withOpenAlexKey(url: string, key: string): string {
    if (!key) return url;
    return `${url}${url.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(key)}`;
}

/** Test-only: forget the recorded budget. */
export function _resetOpenAlexQuotaForTesting(): void {
    state = null;
    loaded = null;
    pending = 0;
}
