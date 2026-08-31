import {LocalCache, MONTH_MS} from "@shared/cache";
import {createDoiSet, lookupDOIs} from "@shared/flora-api";
import {RET_MAP_KEY, storageSync, type RetractionMaps} from "@shared/data-extract";
import type {DoiString, ReplicationResult, RetractionResponse} from "@shared/types";
import {LookupResponse, RetractionCheckResponse, SheetFetchResponse, AugmentResponse, AugmentRequest, PmcResolveResponse, OpenAlexResolveResponse, SemanticScholarResolveResponse, CreateSetResponse} from "@shared/messages";
import {isLookupRequest, isRetractionCheckRequest, isSheetFetchRequest, isAugmentRequest, isPmcResolveRequest, isOpenAlexResolveRequest, isSemanticScholarResolveRequest, isDebugEntriesRequest, isStashReportRequest, isTakeReportRequest, isCreateSetRequest, type TakeReportResponse} from "@shared/messages";
import {augmentDOIsDetailed, type AugmentSource} from "@shared/doi-augment";
import {resolvePmcIds, type NcbiIdType} from "@shared/pmc-resolve";
import {resolveOpenAlexIds} from "@shared/openalex-resolve";
import {resolveSemanticScholarIds} from "@shared/semanticscholar-resolve";
import {getSettings, isSetupComplete} from "@shared/settings";
import {appendDebugEntries, installDebugLogStore} from "@shared/debug-log";
import {debugError, debugLog, debugWarn, isDebugEnabledAsync} from "@shared/debug";

const cache = new LocalCache<ReplicationResult>("flora");

// The worker owns the debug log: its own entries are stored directly, and
// every other context ships batches here via FLORA_DEBUG_ENTRIES.
installDebugLogStore();
// A wake-up marker: with the log open, gaps between a page's request and this
// line show how long Chrome took to start the worker. Logged once the debug
// flag has been read — a top-level debugLog runs before that and is dropped.
isDebugEnabledAsync().then(() => debugLog("Worker started")).catch(() => {});

// Initialise cache quota from persisted settings (service worker may restart).
getSettings().then(({ cacheQuotaMb }) => {
    cache.setQuota(cacheQuotaMb === 0 ? 0 : cacheQuotaMb * 1024 * 1024);
}).catch((err) => debugError("Cache quota: could not read settings —", err));

// Keep quota in sync when the user changes the setting; drop the cached
// retraction source whenever a fresh map is synced into local storage.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && "flora_settings" in changes) {
        const next = (changes["flora_settings"].newValue as { cacheQuotaMb?: number } | undefined);
        if (next?.cacheQuotaMb != null) {
            cache.setQuota(next.cacheQuotaMb === 0 ? 0 : next.cacheQuotaMb * 1024 * 1024);
        }
    }
    if (area === "local" && RET_MAP_KEY in changes) {
        retractionGeneration++;
        cachedRetractionSource = null;
        retractionSourceLoad = null;
    }
});

// ── Toolbar icon: maroon "F" when FLoRA is active on a tab, gray when not.
// Drawn on an OffscreenCanvas so no separate icon assets are needed.
function drawFloraIcon(size: number, active: boolean): ImageData {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const r = size * 0.22;
    ctx.fillStyle = active ? "#853953" : "#9aa0a6";
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, size - 1, size - 1, r);
    ctx.fill();
    ctx.fillStyle = active ? "#ffffff" : "#eceff1";
    ctx.font = `bold ${Math.round(size * 0.68)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("F", size / 2, size * 0.56);
    return ctx.getImageData(0, 0, size, size);
}

function setActionIcon(active: boolean, tabId?: number): void {
    let imageData: Record<number, ImageData>;
    try {
        imageData = { 16: drawFloraIcon(16, active), 32: drawFloraIcon(32, active) };
    } catch (err) {
        debugWarn("Toolbar icon: draw failed, keeping the default icon —", err);
        return;
    }
    const details = tabId != null ? { tabId, imageData } : { imageData };
    chrome.action.setIcon(details).catch(() => {});

    const title = active
        ? "FORRT ORE — active on this page"
        : "FORRT ORE — inactive on this page";
    chrome.action.setTitle(tabId != null ? { tabId, title } : { title }).catch(() => {});
}

// Default to inactive; an applicable page's content script flips it to active
// per tab. Chrome clears a tab-specific icon on navigation, so leaving a site
// falls back to this default without the worker having to watch tab updates.
setActionIcon(false);

// Open the walkthrough on first install and seed retraction data immediately.
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        chrome.tabs.create({ url: chrome.runtime.getURL("dist/walkthrough.html") });
    }
    syncRetractionsInfo().catch((err) => debugError("Retractions: sync failed —", err));
});

// Refresh retraction data once per browser session (weekly interval enforced inside).
chrome.runtime.onStartup.addListener(() => {
    syncRetractionsInfo().catch((err) => debugError("Retractions: sync failed —", err));
});

const RETRACTION_SYNC_ALARM = "flora-retraction-sync";

async function ensureRetractionSyncAlarm(): Promise<void> {
    const existing = await chrome.alarms.get(RETRACTION_SYNC_ALARM);
    if (!existing) chrome.alarms.create(RETRACTION_SYNC_ALARM, {periodInMinutes: 60 * 24});
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RETRACTION_SYNC_ALARM) {
        syncRetractionsInfo().catch((err) => debugError("Retractions: scheduled sync failed —", err));
    }
});

ensureRetractionSyncAlarm().catch((err) => {
    debugWarn("Retractions: could not schedule the daily refresh alarm —", err);
});


/** In-flight dedup: prevents duplicate API calls for the same DOI */
const inflight = new Map<DoiString, Promise<ReplicationResult | null>>();

chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
        if (
            typeof message === "object" &&
            message !== null &&
            (message as { type?: string }).type === "FLORA_ACTIVE_STATE"
        ) {
            const active = (message as { active?: boolean }).active === true;
            const tabId = sender.tab?.id;
            if (tabId != null) setActionIcon(active, tabId);
            return false;
        }

        if (isDebugEntriesRequest(message)) {
            void appendDebugEntries(message.entries);
            return false;
        }

        if (isStashReportRequest(message)) {
            stashReport(message.report).then(() => sendResponse({ok: true}));
            return true;
        }

        if (isTakeReportRequest(message)) {
            takeReport(message.type === "FLORA_TAKE_REPORT")
                .then((report) =>
                    sendResponse({type: "FLORA_TAKE_REPORT_RESULT", report} satisfies TakeReportResponse)
                )
                .catch(() =>
                    sendResponse({type: "FLORA_TAKE_REPORT_RESULT", report: null} satisfies TakeReportResponse)
                );
            return true;
        }

        if (isLookupRequest(message)) {
            const dois = message.dois;
            handleLookup(dois)
                .then(sendResponse)
                .catch(() =>
                    sendResponse({
                        type: "FLORA_LOOKUP_RESULT",
                        results: {},
                        errors: Object.fromEntries(
                            dois.map((d) => [d, "Service worker error"])
                        ),
                    } satisfies LookupResponse)
                );
            return true;
        }

        if (isCreateSetRequest(message)) {
            createDoiSet(message.dois)
                .then((setId) =>
                    sendResponse({type: "FLORA_CREATE_SET_RESULT", setId} satisfies CreateSetResponse)
                )
                .catch(() =>
                    sendResponse({type: "FLORA_CREATE_SET_RESULT", setId: null} satisfies CreateSetResponse)
                );
            return true;
        }

        if (isRetractionCheckRequest(message)) {
            handleRetractionCheck(message.dois)
                .then(sendResponse)
                .catch(() =>
                    sendResponse({
                        type: "FLORA_RET_CHECK_RESULT",
                        results: [],
                        error: "Service worker error",
                    } satisfies RetractionCheckResponse)
                );
            return true;
        }

        if (
            typeof message === "object" &&
            message !== null &&
            (message as { type?: string }).type === "FLORA_OPEN_OPTIONS"
        ) {
            chrome.runtime.openOptionsPage();
            return false;
        }

        if (
            typeof message === "object" &&
            message !== null &&
            (message as { type?: string }).type === "FLORA_DISMISS_SETUP"
        ) {
            chrome.storage.session.set({flora_setup_dismissed: true})
                .then(() => sendResponse({ok: true}))
                .catch((err) => {
                    debugError("Setup dismiss failed —", err);
                    sendResponse({ok: false});
                });
            return true;
        }

        if (
            typeof message === "object" &&
            message !== null &&
            (message as { type?: string }).type === "FLORA_IS_SETUP_DISMISSED"
        ) {
            chrome.storage.session.get("flora_setup_dismissed")
                .then((result) => sendResponse({dismissed: !!result.flora_setup_dismissed}))
                .catch((err) => {
                    debugError("Setup dismiss read failed —", err);
                    sendResponse({dismissed: false});
                });
            return true;
        }
        if (isSheetFetchRequest(message)) {
            handleSheetFetch(message.spreadsheetId, message.gid)
                .then(sendResponse)
                .catch(() =>
                    sendResponse({
                        type: "FLORA_SHEET_FETCH_RESULT",
                        csv: null,
                        error: "Failed to fetch spreadsheet data",
                    } satisfies SheetFetchResponse)
                );
            return true;
        }

        if (isAugmentRequest(message)) {
            handleAugment(message.requests)
                .then(sendResponse)
                .catch(() =>
                    sendResponse({
                        type: "FLORA_AUGMENT_RESULT",
                        results: {},
                    } satisfies AugmentResponse)
                );
            return true;
        }

        if (isPmcResolveRequest(message)) {
            handlePmcResolve(message.pmcids, message.idtype)
                .then(sendResponse)
                .catch(() =>
                    sendResponse({
                        type: "FLORA_PMC_RESOLVE_RESULT",
                        results: {},
                    } satisfies PmcResolveResponse)
                );
            return true;
        }

        if (isOpenAlexResolveRequest(message)) {
            handleOpenAlexResolve(message.ids)
                .then(sendResponse)
                .catch(() =>
                    sendResponse({
                        type: "FLORA_OPENALEX_RESOLVE_RESULT",
                        results: {},
                    } satisfies OpenAlexResolveResponse)
                );
            return true;
        }

        if (isSemanticScholarResolveRequest(message)) {
            handleSemanticScholarResolve(message.ids)
                .then(sendResponse)
                .catch(() =>
                    sendResponse({
                        type: "FLORA_S2_RESOLVE_RESULT",
                        results: {},
                    } satisfies SemanticScholarResolveResponse)
                );
            return true;
        }

        return false;
    }
);

// ── Pending issue report ────────────────────────────────────────────────────
// A report waits here between "Report an issue" being clicked and the GitHub
// issue form loading. It lives in session storage — never written to disk, gone
// when the browser closes — and only the worker can read it, so the content
// script has to ask for it by message.

const PENDING_REPORT_KEY = "flora_pending_report";

/**
 * How long a parked report stays claimable. Long enough to survive a detour
 * through GitHub's sign-in flow, short enough that an abandoned report doesn't
 * turn up in an unrelated issue days later.
 */
const PENDING_REPORT_TTL_MS = 15 * 60 * 1000;

async function stashReport(report: string): Promise<void> {
    try {
        await chrome.storage.session.set({
            [PENDING_REPORT_KEY]: {report, createdAt: Date.now()},
        });
    } catch (err) {
        // The report is still on the clipboard; only the autofill handoff is lost.
        debugError("Debug report: could not park the report for the issue form —", err);
    }
}

/**
 * Read the parked report, consuming it unless this is only a peek — a peek
 * asks "is one waiting?" so a failed autofill can say so without throwing the
 * report away.
 */
async function takeReport(consume: boolean): Promise<string | null> {
    const raw = await chrome.storage.session.get(PENDING_REPORT_KEY);
    const pending = raw?.[PENDING_REPORT_KEY] as
        | {report?: string; createdAt?: number}
        | undefined;
    if (!pending?.report) return null;

    const expired = Date.now() - (pending.createdAt ?? 0) > PENDING_REPORT_TTL_MS;
    if (consume || expired) await chrome.storage.session.remove(PENDING_REPORT_KEY);
    return expired ? null : pending.report;
}

async function handleLookup(dois: DoiString[]): Promise<LookupResponse> {
    const results: Record<string, ReplicationResult> = {};
    const errors: Record<string, string> = {};
    const toFetch: DoiString[] = [];

    // Check cache and in-flight requests. We only persist matched results, so a
    // truthy cache hit is a real result. A null entry (legacy negative cache) or
    // a miss both fall through to re-query, so newly added FORRT data surfaces.
    const cached = await cache.getMany(dois);
    for (const doi of dois) {
        const hit = cached.get(doi);
        if (hit) {
            results[doi] = hit;
        } else if (inflight.has(doi)) {
            const r = await inflight.get(doi)!;
            if (r) results[doi] = r;
        } else {
            toFetch.push(doi);
        }
    }

    if (toFetch.length === 0) {
        return {type: "FLORA_LOOKUP_RESULT", results, errors};
    }

    // Batch API call for uncached DOIs
    const batchPromise = lookupDOIs(toFetch);

    // Register each DOI as in-flight (catch to prevent unhandled rejection —
    // the main try/catch below handles the actual error reporting)
    for (const doi of toFetch) {
        inflight.set(
            doi,
            batchPromise.then((map) => map.get(doi) ?? null).catch(() => null)
        );
    }

    try {
        const apiResults = await batchPromise;

        const writes: Array<[string, ReplicationResult]> = [];
        for (const doi of toFetch) {
            const r = apiResults.get(doi);
            if (r) {
                results[doi] = r;
                writes.push([doi, r]);
            }
            // No result (no record yet, or a transient batch failure): do NOT
            // cache. We re-query every time so newly added FORRT data surfaces
            // instead of being suppressed by a stale negative cache entry.
        }
        try {
            await cache.setMany(writes, MONTH_MS);
        } catch (err) {
            debugWarn(`Lookup: cache write failed for ${writes.length} DOI(s) —`, err);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        debugError(`Lookup: FORRT API failed for ${toFetch.length} DOI(s) — ${msg}`, err);
        for (const doi of toFetch) {
            errors[doi] = msg;
        }
    } finally {
        for (const doi of toFetch) {
            inflight.delete(doi);
        }
    }

    return {type: "FLORA_LOOKUP_RESULT", results, errors};
}

async function handleAugment(
    requests: AugmentRequest["requests"]
): Promise<AugmentResponse> {
    const resultMap = await augmentDOIsDetailed(requests);
    const results: Record<string, string | null> = {};
    const sources: Record<string, AugmentSource | null> = {};
    const unanswered: string[] = [];
    for (const [title, outcome] of resultMap) {
        results[title] = outcome.doi ?? null;
        sources[title] = outcome.source;
        if (!outcome.answered) unanswered.push(title);
    }
    return { type: "FLORA_AUGMENT_RESULT", results, sources, unanswered };
}

async function handleOpenAlexResolve(ids: string[]): Promise<OpenAlexResolveResponse> {
    const results: Record<string, string | null> = {};
    for (const [id, doi] of await resolveOpenAlexIds(ids)) results[id] = doi;
    return {type: "FLORA_OPENALEX_RESOLVE_RESULT", results};
}

async function handleSemanticScholarResolve(ids: string[]): Promise<SemanticScholarResolveResponse> {
    const results: Record<string, string | null> = {};
    for (const [id, doi] of await resolveSemanticScholarIds(ids)) results[id] = doi;
    return {type: "FLORA_S2_RESOLVE_RESULT", results};
}

async function handlePmcResolve(pmcids: string[], idtype: NcbiIdType = "pmcid"): Promise<PmcResolveResponse> {
    const resultMap = await resolvePmcIds(pmcids, idtype);
    const results: Record<string, string | null> = {};
    for (const [pmcid, doi] of resultMap) results[pmcid] = doi ?? null;
    return {type: "FLORA_PMC_RESOLVE_RESULT", results};
}

async function handleSheetFetch(
    spreadsheetId: string,
    gid: string
): Promise<SheetFetchResponse> {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
    try {
        const resp = await fetch(url, {credentials: "include"});
        if (!resp.ok) {
            return {
                type: "FLORA_SHEET_FETCH_RESULT",
                csv: null,
                error: `HTTP ${resp.status}`
            };
        }
        const csv = await resp.text();
        return {type: "FLORA_SHEET_FETCH_RESULT", csv, error: null};
    } catch (err) {
        debugError("Sheets: CSV export fetch failed —", err);
        return {
            type: "FLORA_SHEET_FETCH_RESULT",
            csv: null,
            error: err instanceof Error ? err.message : "Fetch failed",
        };
    }
}

// ── Retraction lookups ──────────────────────────────────────────────────────
// Retraction data lives in the service worker so the multi-megabyte
// `retractions.json` never ships inside content bundles. Content scripts ask
// for a verdict via FLORA_RET_CHECK; the worker reads the synced map (falling
// back to the bundled JSON), tags each hit as a retraction or concern, and
// returns the notice DOIs.

/**
 * Retraction Watch publishes DOIs in their original publisher case (SICI-style
 * Elsevier identifiers, NEJM, ASCE, etc. carry uppercase letters), but every
 * DOI we look up has been through normaliseDOI() which lowercases it. Without
 * normalising the source keys too, ~12.7k of the ~58.6k retractions would
 * never match.
 */
function lowercaseKeys(obj: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!obj) return out;
    for (const k in obj) out[k.toLowerCase()] = obj[k];
    return out;
}

function normaliseRetractionMaps(map: RetractionMaps): RetractionMaps {
    if (map.lowercasedKeys) return map;
    return {
        retractions: lowercaseKeys(map.retractions),
        concerns: lowercaseKeys(map.concerns),
        lowercasedKeys: true,
    };
}

// Normalised retraction source, cached so lowercaseKeys runs once per sync
// rather than once per lookup. Invalidated by the storage.onChanged listener
// above whenever a fresh map is written.
let cachedRetractionSource: RetractionMaps | null = null;

let retractionGeneration = 0;

// The bundled fallback is fetched lazily (not statically imported) so it stays
// out of the worker bundle until the very first install before any sync.
let bundledRetractionMapPromise: Promise<RetractionMaps> | null = null;

async function loadBundledRetractionMap(): Promise<RetractionMaps> {
    if (!bundledRetractionMapPromise) {
        bundledRetractionMapPromise = (async () => {
            const response = await fetch(chrome.runtime.getURL("dist/retractions.json"));
            if (!response.ok) {
                throw new Error(`Failed to load bundled retractions: ${response.status}`);
            }
            const data = await response.json() as RetractionMaps;
            return normaliseRetractionMaps(data);
        })();
    }
    try {
        return await bundledRetractionMapPromise;
    } catch (error) {
        debugError("Retractions: bundled fallback map failed to load —", error);
        bundledRetractionMapPromise = null; // allow a retry on the next call
        throw error;
    }
}

// Shared across checks that arrive while the first load is still running. The
// worker is killed after ~30s idle, so every wake reloads: reading the 3.5MB
// blob and rebuilding both maps per concurrent check cost seconds on a page
// that asks about its DOIs one at a time.
let retractionSourceLoad: Promise<RetractionMaps> | null = null;

function getRetractionSource(): Promise<RetractionMaps> {
    if (cachedRetractionSource) return Promise.resolve(cachedRetractionSource);
    if (!retractionSourceLoad) {
        const load: Promise<RetractionMaps> = loadRetractionSource().finally(() => {
            if (retractionSourceLoad === load) retractionSourceLoad = null;
        });
        retractionSourceLoad = load;
    }
    return retractionSourceLoad;
}

async function loadRetractionSource(): Promise<RetractionMaps> {
    const generation = retractionGeneration;
    const started = performance.now();
    const storageResult = await chrome.storage.local.get([RET_MAP_KEY]);
    const stored = storageResult[RET_MAP_KEY] as RetractionMaps | undefined;
    const hasStoredData = !!stored && (
        Object.keys(stored.retractions || {}).length > 0 ||
        Object.keys(stored.concerns || {}).length > 0
    );

    if (hasStoredData) {
        const source = normaliseRetractionMaps(stored!);
        if (generation === retractionGeneration) cachedRetractionSource = source;
        debugLog(`Retractions: source loaded from storage in ${Math.round(performance.now() - started)} ms`);
        return source;
    }

    // Nothing synced yet: kick off a sync for next time and answer from the
    // bundled JSON now. Don't cache the fallback — onChanged will pick up the
    // synced map, but until then we re-read so an in-flight sync is noticed.
    debugLog("Retractions: nothing synced yet — answering from the bundled map and starting a sync");
    syncRetractionsInfo().catch((err) => debugError("Retractions: sync failed —", err));
    return loadBundledRetractionMap();
}

async function handleRetractionCheck(dois: DoiString[]): Promise<RetractionCheckResponse> {
    const started = performance.now();
    let source: RetractionMaps;
    try {
        source = await getRetractionSource();
    } catch (err) {
        debugError(`Retractions: no source available, ${dois.length} DOI(s) unchecked —`, err);
        return {type: "FLORA_RET_CHECK_RESULT", results: [], error: "Retraction data unavailable"};
    }
    debugLog(`Retractions: checking ${dois.length} DOI(s), source ready after ${Math.round(performance.now() - started)} ms`);

    const results: RetractionResponse[] = [];
    for (const doi of dois) {
        const retractionDoi = source.retractions[doi];
        if (retractionDoi) {
            results.push({originDoi: doi, doi: retractionDoi, kind: "retraction"});
            continue;
        }
        const concernDoi = source.concerns?.[doi];
        if (concernDoi) {
            results.push({originDoi: doi, doi: concernDoi, kind: "concern"});
        }
    }
    return {type: "FLORA_RET_CHECK_RESULT", results};
}

// Every uncached check kicks off a sync; without this guard a page's worth of
// them each download the full 3.5MB map and write it back.
let syncInFlight: Promise<void> | null = null;

export function syncRetractionsInfo(): Promise<void> {
    syncInFlight ??= runRetractionSync().finally(() => {
        syncInFlight = null;
    });
    return syncInFlight;
}

async function runRetractionSync(): Promise<void> {
    const minInterval = 1000 * 60 * 60 * 24 * 7; // weekly
    const currentTime = Date.now();
    const previous = await chrome.storage.local.get(["synctime"]) ?? 0;
    const lastSync = previous.synctime || 0;
    const nextUpdate = lastSync + minInterval;
    const storageResult = await chrome.storage.local.get(RET_MAP_KEY);
    const map = storageResult[RET_MAP_KEY] as RetractionMaps | undefined;
    const isEmpty = !map || (
        Object.keys(map.retractions || {}).length === 0 &&
        Object.keys(map.concerns || {}).length === 0
    );
    if (isEmpty || currentTime > nextUpdate) {
        const synced = await storageSync();
        if (synced) await chrome.storage.local.set({synctime: currentTime});
    }
}
