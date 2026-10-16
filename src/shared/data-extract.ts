import {fetchWithDeadline} from "@shared/work-cancellation";
import type {RegisteredReport, RegisteredReportMap} from "./registered-reports";
import {debugError} from "./debug";

export const RET_MAP_KEY = "RetractionLookupLocal";
export const RET_COUNT_KEY = "flora_retraction_count";
export const RET_SYNC_TIME_KEY = "synctime";

export function retractionEntryCount(map: RetractionMaps | undefined): number {
    return map ? Object.keys(map.retractions || {}).length + Object.keys(map.concerns || {}).length : 0;
}

/**
 * Prebuilt retraction data, refreshed daily by the GitHub Action
 * (`.github/workflows/update.yml` -> `retractions-updater.ts`) which parses and
 * filters the Retraction Watch CSV. The extension never parses the CSV itself;
 * it pulls this committed JSON and caches it in `chrome.storage`.
 */
const PREBUILT_JSON_URL =
    'https://raw.githubusercontent.com/forrtproject/chromium-extension/main/src/retractions.json'

/**
 * Maps from an original paper's DOI to the DOI of the notice about it.
 * Built by filtering Retraction Watch on `RetractionNature` (see
 * `retractions-updater.ts`): only papers whose latest status event is a
 * retraction or an expression of concern are kept. Corrections and reinstated
 * papers are dropped entirely.
 */
export interface RetractionMaps {
    /** originalPaperDOI -> retraction notice DOI */
    retractions: Record<string, string>;
    /** originalPaperDOI -> expression-of-concern notice DOI */
    concerns: Record<string, string>;
    lowercasedKeys?: boolean;
}

export async function fetchRetractionMap(): Promise<RetractionMaps | undefined> {
    try {
        // 3.7 MB of JSON: the deadline covers the whole body read, so it has to
        // suit a slow link. The worker owns this download, so it is never bound
        // to a page scan's signal.
        const response = await fetchWithDeadline(PREBUILT_JSON_URL, {signal: null}, 120_000);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data && typeof data === 'object' && data.retractions && data.concerns)
            return data as RetractionMaps;
        debugError("Retractions: unexpected data shape from", PREBUILT_JSON_URL);
    } catch (error) {
        debugError("Retractions: download failed —", error);
    }
}

export async function storageSync(): Promise<boolean> {
    const map = await fetchRetractionMap();
    if (!map) return false;
    await chrome.storage.local.set({[RET_MAP_KEY]: map, [RET_COUNT_KEY]: retractionEntryCount(map), [RET_SYNC_TIME_KEY]: Date.now()});
    return true;
}

export const RR_MAP_KEY = "flora_rr_map";
export const RR_SYNC_TIME_KEY = "flora_rr_synctime";

const REGISTERED_REPORTS_JSON_URL =
    'https://raw.githubusercontent.com/forrtproject/chromium-extension/main/src/registered-reports.json'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

function isRegisteredReport(value: unknown): value is RegisteredReport {
    if (!isPlainObject(value)) return false;
    const {key, stage, linked} = value;
    return typeof key === 'string' && key.length > 0
        && (stage === 1 || stage === 2 || stage === null)
        && (linked === undefined || typeof linked === 'string');
}

export function validRegisteredReportMap(data: unknown): RegisteredReportMap | undefined {
    if (!isPlainObject(data) || !isPlainObject(data.reports)) return undefined;
    const entries = Object.entries(data.reports);
    const reports = Object.fromEntries(entries.filter(([doi, report]) => doi && isRegisteredReport(report))) as Record<string, RegisteredReport>;
    if (entries.length > 0 && Object.keys(reports).length === 0) return undefined;
    return {reports};
}

export async function fetchRegisteredReportMap(): Promise<RegisteredReportMap | undefined> {
    try {
        const response = await fetchWithDeadline(REGISTERED_REPORTS_JSON_URL, {signal: null}, 60_000);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const map = validRegisteredReportMap(await response.json());
        if (map) return map;
        debugError("Registered Reports: unexpected data shape from", REGISTERED_REPORTS_JSON_URL);
    } catch (error) {
        debugError("Registered Reports: download failed —", error);
    }
}

export async function registeredReportsSync(): Promise<boolean> {
    const map = await fetchRegisteredReportMap();
    if (!map) return false;
    await chrome.storage.local.set({[RR_MAP_KEY]: map, [RR_SYNC_TIME_KEY]: Date.now()});
    return true;
}
