// Result-row pipeline shared by every search site: read rows → resolve each
// row's DOI → look the DOIs up → place one indicator panel per row.
//
// DOI resolution, in order of trust:
//   1. a DOI the row prints or links confidently (doi.org URL, DOI field)
//   2. the site's own record id, resolved through the site's API (adapter.resolveSiteIds)
//   3. a DOI embedded elsewhere in the row, confirmed by doi.org
//   4. a title/author/year search via Crossref/OpenAlex (rendered as unconfirmed)

import type {DoiAugmentRequest} from "@shared/doi-augment";
import {augmentDOIsViaWorker} from "@shared/messages";
// injectRetractionInfo is still used for rows whose DOI failed validation:
// those get no indicator panel, so there is no badge row to carry the notice.
import {injectRetractionInfo, retractionCheck} from "@shared/doi-retraction";
import {validateDOI, validateDOIs} from "@shared/doi-validate";
import type {DoiString, DoiSource, LookupState, RetractionResponse} from "@shared/types";
import type {LookupRequest, LookupResponse} from "@shared/messages";
import {createIndicatorPanel, updateIndicatorPillBadges} from "@shared/indicator-pill";
import {applyPlacement} from "@shared/site-adapters";
import {fetchOpenAccess} from "@shared/openaccess";
import {beginWorkIndicator, count, endWorkIndicator, reportWorkStage} from "@shared/progress-toast";
import {debugError, debugLog, debugWarn} from "@shared/debug";
import type {RowExtraction, SearchSiteAdapter} from "./sites/types";

// One colour for every provenance — an unconfirmed DOI is marked by the
// underline inside the panel, not by a different colour.
const PILL_COLOR = "#853953";

export const PROCESSED_ATTR = "data-flora-processed";

// Replication results and retraction notices arrive from two independent async
// paths. Both accumulate here and re-render together: updating the badges from
// only one source would drop whatever the other had already resolved.
const lookupState = new Map<DoiString, LookupState>();
const retractions = new Map<DoiString, RetractionResponse>();

function refreshBadges(): void {
    updateIndicatorPillBadges(document, lookupState, [...retractions.values()]);
}

/** Process every not-yet-processed row under `root`, holding one work
 *  indicator across the batch — extraction through to badges. */
export async function processSearchResults(adapter: SearchSiteAdapter, root: ParentNode): Promise<void> {
    const rows = root.querySelectorAll<HTMLElement>(`${adapter.resultRow}:not([${PROCESSED_ATTR}])`);
    debugLog(`${adapter.label}: ${rows.length} new result row(s) to process`);
    if (rows.length === 0) return;

    beginWorkIndicator();
    try {
        await runPass(adapter, rows);
    } finally {
        endWorkIndicator();
    }
}

interface RowInfo extends RowExtraction {
    row: HTMLElement;
}

interface ResolvedRow {
    row: HTMLElement;
    doi: DoiString;
    source: DoiSource;
}

async function runPass(adapter: SearchSiteAdapter, rows: NodeListOf<HTMLElement>): Promise<void> {
    const {label} = adapter;
    reportWorkStage("scan", `Reading ${count(rows.length, `${label} result`)}…`);

    const resolved: ResolvedRow[] = [];
    const place = (info: RowInfo, doi: DoiString, source: DoiSource, isAugmented: boolean, provenanceLabel?: string): void => {
        resolved.push({row: info.row, doi, source});
        void placePanel(adapter, info.row, doi, isAugmented, provenanceLabel);
    };

    // Phase 1: read every row. Confident DOIs are placed immediately; the rest
    // queue for site-id resolution, validation and augmentation.
    let pending: RowInfo[] = [];
    for (const row of rows) {
        row.setAttribute(PROCESSED_ATTR, "true");
        const extraction = adapter.extractRow(row);
        if (!extraction) continue;
        const info: RowInfo = {...extraction, row};
        if (info.doi && info.confident) {
            debugLog(`${label} resolve [confident] "${info.title}" → ${info.doi}`);
            place(info, info.doi, "extracted", false);
        } else {
            pending.push(info);
        }
    }

    // Phase 2: the site's own ids → DOIs, one batched call.
    const withSiteId = pending.filter((r) => r.siteId);
    if (withSiteId.length > 0 && adapter.resolveSiteIds) {
        reportWorkStage("validate", `Resolving ${count(withSiteId.length, `${label} record`)} to DOIs…`);
        let bySiteId = new Map<string, DoiString | null>();
        try {
            bySiteId = await adapter.resolveSiteIds(withSiteId.map((r) => r.siteId!));
        } catch (err) {
            debugWarn(`${label}: id resolution failed for ${withSiteId.length} row(s) —`, err);
        }
        pending = pending.filter((info) => {
            const doi = info.siteId ? bySiteId.get(info.siteId) : undefined;
            if (!doi) return true;
            debugLog(`${label} resolve [site-id] "${info.title}" → ${doi} (${info.siteId})`);
            place(info, doi, "extracted", false, `Taken from ${label}'s own record of this work`);
            return false;
        });
    }

    // Phase 3: DOIs found in the row but not confidently — confirm with doi.org.
    const doisToValidate = pending.filter((r) => r.doi).map((r) => r.doi!);
    let validated = new Map<DoiString, boolean>();
    if (doisToValidate.length > 0) {
        reportWorkStage("validate", `Checking ${count(doisToValidate.length, "DOI")} resolve…`);
        try {
            validated = await validateDOIs(doisToValidate);
        } catch (err) {
            debugWarn(`${label}: validation failed for ${doisToValidate.length} DOI(s) —`, err);
        }
    }
    pending = pending.filter((info) => {
        if (!(info.doi && validated.get(info.doi))) return true;
        debugLog(`${label} resolve [doi.org-validated] "${info.title}" → ${info.doi}`);
        place(info, info.doi, "extracted", false);
        return false;
    });

    // Phase 4: title search for whatever is still unresolved.
    if (pending.length > 0) {
        const requests: DoiAugmentRequest[] = pending
            .filter((r) => r.title)
            .map((r) => ({title: r.title, firstAuthor: r.firstAuthor, year: r.year, sourceUrl: r.sourceUrl}));
        let augmented = new Map<string, DoiString | null>();
        if (requests.length > 0) {
            reportWorkStage("augment", `Augmenting ${count(requests.length, "result")} without a DOI…`);
            try {
                augmented = await augmentDOIsViaWorker(requests);
            } catch (err) {
                debugWarn(`${label}: augmentation failed for ${requests.length} row(s) —`, err);
            }
        }

        for (const info of pending) {
            const augmentedDoi = augmented.get(info.title) ?? null;
            const extractedDoi = info.doi;

            if (extractedDoi && augmentedDoi === extractedDoi) {
                // Cross-validated: row extraction matches the title search
                debugLog(`${label} resolve [cross-validated] "${info.title}" → ${extractedDoi} (extracted = augmented)`);
                place(info, extractedDoi, "extracted", false);
            } else if (extractedDoi && augmentedDoi) {
                // Conflict: prefer the augmented DOI (rendered as unconfirmed)
                debugLog(`${label} resolve [conflict] "${info.title}" → using augmented ${augmentedDoi} (extracted was ${extractedDoi})`);
                place(info, augmentedDoi, "augmented", true);
            } else if (extractedDoi) {
                // Extracted but the title search found nothing — last-resort doi.org check
                let valid = false;
                try {
                    valid = await validateDOI(extractedDoi);
                } catch (err) {
                    debugWarn(`${label}: revalidation failed for ${extractedDoi} —`, err);
                }
                if (valid) {
                    debugLog(`${label} resolve [extracted-revalidated] "${info.title}" → ${extractedDoi} (doi.org confirmed on retry)`);
                    place(info, extractedDoi, "extracted", false);
                } else {
                    // Invalid DOI — no panel, but still surface a retraction/concern
                    // notice (the static map is keyed independently of doi.org validity).
                    debugLog(`${label} resolve [extracted-invalid] "${info.title}" → ${extractedDoi} rejected (doi.org says invalid)`);
                    await placeNoticeOnly(adapter, info.row, extractedDoi);
                }
            } else if (augmentedDoi) {
                debugLog(`${label} resolve [augmented-only] "${info.title}" → ${augmentedDoi} (no extraction)`);
                place(info, augmentedDoi, "augmented", true);
            } else {
                debugLog(`${label} resolve [no-doi] "${info.title}" → no DOI from extraction or augmentation`);
            }
        }
    }

    const extractedCount = resolved.filter((r) => r.source === "extracted").length;
    debugLog(`${extractedCount} DOIs from ${label}, ${resolved.length - extractedCount} augmented via Crossref/OpenAlex`);
    if (resolved.length === 0) return;

    const uniqueDois = [...new Set(resolved.map((r) => r.doi))];
    debugLog(`${label}: Sending lookup for`, uniqueDois.length, "unique DOIs:", uniqueDois);
    reportWorkStage("lookup", `Found ${count(uniqueDois.length, "unique DOI")} — looking them up…`);
    const request: LookupRequest = {type: "FLORA_LOOKUP", dois: uniqueDois};

    try {
        const response: LookupResponse = await chrome.runtime.sendMessage(request);
        debugLog(`${label}: Lookup response:`, Object.keys(response.results).length, "results,", Object.keys(response.errors).length, "errors");

        let badgedCount = 0;
        for (const {doi, source} of resolved) {
            if (response.results[doi]) {
                lookupState.set(doi, {status: "matched", result: response.results[doi], source});
                badgedCount++;
            }
        }
        reportWorkStage("report", `Marking up ${count(badgedCount, "result")}…`);
        refreshBadges();
        debugLog(`${label}: Rendered`, badgedCount, "badge(s)");
    } catch (err) {
        debugLog(`${label}: Lookup failed:`, err);
    }
}

async function placeNoticeOnly(adapter: SearchSiteAdapter, row: HTMLElement, doi: DoiString): Promise<void> {
    try {
        const notices = await retractionCheck([doi]);
        if (notices.length === 0) return;
        const target = adapter.noticeTarget(row);
        if (target) injectRetractionInfo(target, notices[0], {afterend: true});
    } catch (err) {
        debugWarn(`${adapter.label}: notice check failed for ${doi} —`, err);
    }
}

/** Build the row's panel, place it per the adapter, then fetch its retraction status. */
async function placePanel(
    adapter: SearchSiteAdapter,
    row: HTMLElement,
    doi: DoiString,
    isAugmented: boolean,
    provenanceLabel?: string
): Promise<void> {
    try {
        const panel = createIndicatorPanel({
            doi,
            color: PILL_COLOR,
            isAugmented,
            provenanceLabel,
            oaStatus: fetchOpenAccess(doi),
            retraction: retractions.get(doi) ?? null,
        });
        adapter.preparePanelTarget?.(row);
        if (!applyPlacement(adapter.panelPlacement, row, panel, `${adapter.label} panel`)) {
            row.appendChild(panel);
        }
        const notices = await retractionCheck([doi]);
        if (notices?.[0]) {
            retractions.set(doi, notices[0]);
            refreshBadges();
        }
    } catch (err) {
        debugError(`${adapter.label}: could not label ${doi} —`, err);
    }
}
