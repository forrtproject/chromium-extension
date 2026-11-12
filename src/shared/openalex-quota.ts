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
    /** Whose budget: "shared" (no key) or a fingerprint of the API key. */
    budget: string;
}

export interface OpenAlexLimit {
    resetAt: number;
    keyed: boolean;
}

const SESSION_KEY = "flora_openalex_quota";

/** Identify a budget without storing the key itself: "shared", or an FNV-1a hash of the key. */
function budgetOf(key: string): string {
    if (!key) return "shared";
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
    return `key:${(h >>> 0).toString(36)}`;
}
/** One entry per budget, so a late answer for a replaced key never touches the current one. */
let states: Record<string, QuotaState> = {};
let loaded: Promise<void> | null = null;

function load(): Promise<void> {
    loaded ??= (async () => {
        try {
            const raw = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] as Record<string, QuotaState> | undefined;
            for (const [budget, s] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
                // A response noted while loading is newer than the stored state.
                if (!states[budget] && typeof s?.remaining === "number" && typeof s.resetAt === "number") states[budget] = {...s, budget};
            }
        } catch {
            // No session storage (tests, content scripts): keep the in-memory state.
        }
    })();
    return loaded;
}

function persist(): void {
    try {
        // Merge what an earlier worker stored first, so its other budgets survive.
        void load().then(() => chrome.storage.session.set({[SESSION_KEY]: states})).catch(() => {});
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
export function noteOpenAlexResponse(response: Response, key: string): void {
    const now = Date.now();
    const budget = budgetOf(key);
    const remaining = header(response, "x-ratelimit-remaining");
    const resetSeconds = header(response, "x-ratelimit-reset");
    if (response.status === 429) {
        const retry = retryAfterMs(response);
        // A short Retry-After with credits left is the per-second burst limit, not the daily budget.
        if (retry != null && retry < 60_000 && remaining !== 0) return;
        const wait = resetSeconds != null ? resetSeconds * 1000 : retry ?? untilMidnightUtc(now);
        if (remaining == null && wait < 60_000) return;
        states[budget] = {remaining: 0, resetAt: now + wait, budget};
        debugWarn(`OpenAlex: ${key ? "the API key's" : "this network's free"} daily budget is used up until ${new Date(now + wait).toISOString()}`);
        persist();
        return;
    }
    if (remaining == null) return;
    const before = states[budget];
    const resetAt = now + (resetSeconds ?? untilMidnightUtc(now) / 1000) * 1000;
    // Answers to parallel requests can arrive out of order; within one budget
    // period the balance only falls, so an older, higher figure is ignored.
    const samePeriod = before && now < before.resetAt && Math.abs(before.resetAt - resetAt) < 10 * 60_000;
    const next: QuotaState = {remaining: samePeriod ? Math.min(before.remaining, remaining) : remaining, resetAt, budget};
    states[budget] = next;
    if (before && before.remaining >= OPENALEX_RESERVE_CREDITS + OPENALEX_TITLE_SEARCH_CREDITS && !titleSearchFits(next)) {
        debugLog(`OpenAlex: ${remaining} credits left — keeping them for openalex.org lookups; title matching continues with Crossref only`);
    }
    persist();
}

function current(key: string): QuotaState | null {
    // One budget says nothing about another: no key, or a different key.
    const s = states[budgetOf(key)];
    return s && Date.now() < s.resetAt ? s : null;
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
export async function reserveTitleSearch(key: string): Promise<boolean> {
    await load();
    const s = current(key);
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
export async function openAlexAvailable(key: string): Promise<boolean> {
    await load();
    const s = current(key);
    return !s || s.remaining > 0;
}

/** When title matching is running on Crossref alone because of the budget: until when, and whose budget. */
export async function openAlexTitleLimit(key: string): Promise<OpenAlexLimit | null> {
    await load();
    const s = current(key);
    return s && !titleSearchFits(s) ? {resetAt: s.resetAt, keyed: !!key} : null;
}

/** Add the user's OpenAlex API key, when there is one, to a request URL's query. */
export function withOpenAlexKey(url: string, key: string): string {
    if (!key) return url;
    return `${url}${url.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(key)}`;
}

/** Test-only: forget the recorded budget. */
export function _resetOpenAlexQuotaForTesting(): void {
    states = {};
    loaded = null;
    pending = 0;
}
