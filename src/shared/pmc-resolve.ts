// PubMed Central id → DOI via NCBI's ID Converter. NCBI sends no CORS headers,
// so this only runs in the service worker (see resolvePmcIdsViaWorker).

import type {DoiString} from "./types";
import {normaliseDOI} from "./doi-normalise";
import {getSettings} from "./settings";
import {BlobCache} from "./blob-cache";
import {debugLog, debugWarn} from "./debug";

const IDCONV_BASE = "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/";
// NCBI caps one request at 200 ids.
const MAX_IDS_PER_REQUEST = 200;

const PMC_CACHE = new BlobCache<{doi: string | null}>({
    storageKey: "flora_pmc_blob",
    ttlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
});

interface IdConvRecord {
    doi?: string;
    pmcid?: string;
    "requested-id"?: string;
    status?: string;
    errmsg?: string;
}

/** Canonical `PMC…` form, or null when the input isn't a PMC id. */
export function normalisePmcId(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const match = /^\s*pmc(\d{3,9})\s*$/i.exec(raw);
    return match ? `PMC${match[1]}` : null;
}

async function fetchIdConv(pmcids: string[]): Promise<IdConvRecord[]> {
    const {email} = await getSettings();
    const params = new URLSearchParams({
        ids: pmcids.join(","),
        idtype: "pmcid",
        format: "json",
        versions: "no",
        tool: "flora",
    });
    if (email) params.set("email", email);

    const response = await fetch(`${IDCONV_BASE}?${params.toString()}`);
    if (!response.ok) throw new Error(`ID converter HTTP ${response.status}`);
    const data = (await response.json()) as {records?: IdConvRecord[]};
    return data.records ?? [];
}

/**
 * Resolve PMC ids to DOIs, keyed by canonical `PMC…` form. An id NCBI has no
 * DOI for maps to null; an id absent from the map failed to resolve and is
 * worth retrying.
 */
export async function resolvePmcIds(rawIds: string[]): Promise<Map<string, DoiString | null>> {
    const results = new Map<string, DoiString | null>();
    const ids = [...new Set(rawIds.map(normalisePmcId).filter((id): id is string => id !== null))];
    if (ids.length === 0) return results;

    const cached = await PMC_CACHE.getMany(ids);
    const uncached: string[] = [];
    for (const id of ids) {
        const entry = cached.get(id);
        if (entry) results.set(id, entry.doi ? normaliseDOI(entry.doi) : null);
        else uncached.push(id);
    }
    if (uncached.length === 0) {
        debugLog(`PMC resolve: ${ids.length} id(s) all cached`);
        return results;
    }

    const updates: Array<[string, {doi: string | null}]> = [];
    for (let i = 0; i < uncached.length; i += MAX_IDS_PER_REQUEST) {
        const batch = uncached.slice(i, i + MAX_IDS_PER_REQUEST);
        let records: IdConvRecord[];
        try {
            records = await fetchIdConv(batch);
        } catch (err) {
            debugWarn(`PMC resolve: batch of ${batch.length} failed, retrying next pass —`, err);
            continue;
        }
        for (const record of records) {
            const id = normalisePmcId(record["requested-id"]) ?? normalisePmcId(record.pmcid);
            if (!id) continue;
            const doi = record.status === "error" ? null : normaliseDOI(record.doi);
            results.set(id, doi);
            updates.push([id, {doi}]);
        }
    }

    if (updates.length > 0) await PMC_CACHE.setMany(updates);
    debugLog(`PMC resolve: ${[...results.values()].filter(Boolean).length}/${ids.length} id(s) mapped to a DOI`);
    return results;
}

/** Test-only: drop in-memory cache state so each case starts fresh. */
export function _resetPmcCacheForTesting(): void {
    PMC_CACHE.resetForTesting();
}
