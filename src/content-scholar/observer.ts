import {normaliseDOI} from "@shared/doi-normalise";
import {type DoiAugmentRequest} from "@shared/doi-augment";
import {augmentDOIsViaWorker} from "@shared/messages";
// injectRetractionInfo is still used for rows whose DOI failed validation:
// those get no indicator panel, so there is no badge row to carry the notice.
import {injectRetractionInfo, retractionCheck} from "@shared/doi-retraction"
import {validateDOI, validateDOIs} from "@shared/doi-validate";
import type {DoiString, DoiSource, LookupState, RetractionResponse} from "@shared/types";
import type {LookupRequest, LookupResponse} from "@shared/messages";
import {createIndicatorPanel, updateIndicatorPillBadges} from "@shared/indicator-pill";
import {fetchOpenAccess} from "@shared/openaccess";
import {
    beginWorkIndicator,
    count,
    endWorkIndicator,
    reportWorkStage,
    setWorkItems,
    updateWorkItem,
    type WorkItem,
} from "@shared/progress-toast";
import {debugError, debugLog, debugWarn} from "@shared/debug";

// One colour for every provenance — an unconfirmed DOI is marked by the
// underline inside the pill, not by a different colour.
const PILL_COLOR = "#853953";

// Replication results and retraction notices arrive from two independent async
// paths. Both accumulate here and re-render together: updating the badges from
// only one source would drop whatever the other had already resolved.
const scholarState = new Map<DoiString, LookupState>();
const scholarRedacts = new Map<DoiString, RetractionResponse>();

function refreshScholarBadges(): void {
    updateIndicatorPillBadges(document, scholarState, [...scholarRedacts.values()]);
}

// Set by the popup's hide command and by the work toast's pause control (both
// handled in index.ts). Lives here because the pass reads it to stop marking up
// rows, and index.ts already imports this module.
let scholarHidden = false;

export function setScholarHidden(hidden: boolean): void {
    scholarHidden = hidden;
}

export function isScholarHidden(): boolean {
    return scholarHidden;
}

const RESULT_CONTAINER = "#gs_res_ccl";
const RESULT_ROW = ".gs_r.gs_or.gs_scl";
const PROCESSED_ATTR = "data-flora-processed";

export function observeScholarResults(): void {
    const container = document.querySelector(RESULT_CONTAINER);
    if (!container) return;

    const observer = new MutationObserver((mutations) => {
        let hasNewRows = false;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (
                    node instanceof HTMLElement &&
                    (node.matches(RESULT_ROW) || node.querySelector(RESULT_ROW))
                ) {
                    hasNewRows = true;
                    break;
                }
            }
            if (hasNewRows) break;
        }

        if (hasNewRows) {
            void processScholarResults(document).catch((err) =>
                debugError("Scholar: pass on newly loaded rows failed —", err)
            );
        }
    });

    observer.observe(container, {childList: true, subtree: true});
}

/** Holds one work indicator across the row batch — extraction through to badges. */
export async function processScholarResults(doc: Document): Promise<void> {
    if (scholarHidden) {
        debugLog("Scholar: paused on this site — skipping the pass");
        return;
    }
    const rows = doc.querySelectorAll<HTMLElement>(
        `${RESULT_ROW}:not([${PROCESSED_ATTR}])`
    );
    debugLog(`Scholar: ${rows.length} new result row(s) to process`);
    if (rows.length === 0) return;

    beginWorkIndicator({stages: ["scan", "validate", "augment", "lookup", "report"]});
    try {
        await runScholarPass(rows);
    } finally {
        endWorkIndicator();
    }
}

async function runScholarPass(rows: NodeListOf<HTMLElement>): Promise<void> {
    reportWorkStage("scan", `Reading ${count(rows.length, "Scholar result")}…`);

    const rowDois: {
        row: HTMLElement;
        doi: DoiString;
        source: DoiSource
    }[] = [];

    // Phase 1: Extract DOIs from URLs and collect all titles for augmentation
    interface RowInfo {
        row: HTMLElement;
        title: string;
        firstAuthor: string | null;
        year: number | null;
        sourceUrl: string | null;
        extractedDoi: DoiString | null;
        confident: boolean;
    }

    const rowInfos: RowInfo[] = [];

    for (const row of rows) {
        row.setAttribute(PROCESSED_ATTR, "true");

        // Skip non-article entries like [CITATION] and [BOOK]
        const typeTag = row.querySelector(".gs_rt .gs_ctu, .gs_rt .gs_ctg2, .gs_rt .gs_ct1");
        const typeText = typeTag?.textContent?.trim().toLowerCase() ?? "";
        if (typeText.includes("citation") || typeText.includes("book")) {
            continue;
        }

        const extraction = extractDoiFromScholarRow(row);
        const title = row.querySelector(".gs_rt")?.textContent?.trim() ?? "";
        const metadata = extractScholarRowMetadata(row);
        const sourceUrl = row.querySelector<HTMLAnchorElement>(".gs_rt a")?.href ?? null;

        // Confident extractions (doi.org URLs, explicit text) → green immediately
        if (extraction?.confident) {
            debugLog(`Scholar resolve [confident] "${title}" → ${extraction.doi}`);
            rowDois.push({row, doi: extraction.doi, source: "extracted"});
            void preInjectLabels(row, extraction.doi, PILL_COLOR, false);
        } else {
            // Non-confident or no extraction — collect for augmentation cross-check
            rowInfos.push({
                row,
                title,
                firstAuthor: metadata.firstAuthor,
                year: metadata.year,
                sourceUrl,
                extractedDoi: extraction?.doi ?? null,
                confident: false,
            });
        }
    }

    // Phase 2: Validate extracted DOIs via doi.org, then augment only what's still unresolved
    if (rowInfos.length > 0) {
        // Step 1: Validate extracted DOIs with doi.org (cheap HEAD-like check)
        const withExtracted = rowInfos.filter((r) => r.extractedDoi !== null);
        const doisToValidate = withExtracted.map((r) => r.extractedDoi!);

        let validated = new Map<DoiString, boolean>();
        if (doisToValidate.length > 0) {
            reportWorkStage("validate", `Checking ${count(doisToValidate.length, "DOI")} resolve…`);
            setWorkItems(withExtracted.map((r) => workItem(r.extractedDoi!, r.title, r.extractedDoi!)));
            try {
                validated = await validateDOIs(doisToValidate);
            } catch (err) {
                debugWarn(`Scholar: validation failed for ${doisToValidate.length} DOI(s) —`, err);
            }
            for (const doi of doisToValidate) {
                updateWorkItem(doi, validated.get(doi) ? "done" : "failed");
            }
        }

        // Separate rows into validated (done) vs still-pending (need augmentation)
        const pendingInfos: RowInfo[] = [];
        for (const info of rowInfos) {
            if (info.extractedDoi && validated.get(info.extractedDoi)) {
                // doi.org confirms this DOI exists → treat as confident
                debugLog(`Scholar resolve [doi.org-validated] "${info.title}" → ${info.extractedDoi}`);
                rowDois.push({
                    row: info.row,
                    doi: info.extractedDoi,
                    source: "extracted"
                });
                preInjectLabels(info.row, info.extractedDoi, PILL_COLOR, false);
            } else {
                if (info.extractedDoi) {
                    debugLog(`Scholar: "${info.title}" — extracted ${info.extractedDoi} failed doi.org validation, falling back to augmentation`);
                }
                pendingInfos.push(info);
            }
        }

        // Step 2: Augment only the remaining unresolved rows
        if (pendingInfos.length > 0) {
            const titledInfos = pendingInfos.filter((r) => r.title);
            const requestsToAugment: DoiAugmentRequest[] = titledInfos.map((r) => ({
                title: r.title,
                firstAuthor: r.firstAuthor,
                year: r.year,
                sourceUrl: r.sourceUrl,
            }));
            let augmented = new Map<string, DoiString | null>();
            try {
                if (requestsToAugment.length > 0) {
                    reportWorkStage(
                        "augment",
                        `Augmenting ${count(requestsToAugment.length, "result")} without a DOI…`
                    );
                    setWorkItems(titledInfos.map((r) => workItem(r.title, r.title, rowByline(r))));
                    augmented = await augmentDOIsViaWorker(requestsToAugment);
                }
            } catch (err) {
                debugWarn(`Scholar: augmentation failed for ${requestsToAugment.length} row(s) —`, err);
            }
            for (const info of titledInfos) {
                const doi = augmented.get(info.title) ?? null;
                updateWorkItem(info.title, doi ? "done" : "failed", doi ?? "no DOI found");
            }

            for (const info of pendingInfos) {
                const augmentedDoi = augmented.get(info.title) ?? null;

                if (info.extractedDoi && augmentedDoi === info.extractedDoi) {
                    // Cross-validated: URL extraction matches augmentation → green ✓
                    debugLog(`Scholar resolve [cross-validated] "${info.title}" → ${info.extractedDoi} (extracted = augmented)`);
                    rowDois.push({
                        row: info.row,
                        doi: info.extractedDoi,
                        source: "extracted"
                    });
                    preInjectLabels(info.row, info.extractedDoi, PILL_COLOR, false);
                } else if (info.extractedDoi && augmentedDoi && augmentedDoi !== info.extractedDoi) {
                    // Conflict: prefer the augmented DOI (rendered as unconfirmed)
                    debugLog(`Scholar resolve [conflict] "${info.title}" → using augmented ${augmentedDoi} (extracted was ${info.extractedDoi})`);
                    rowDois.push({
                        row: info.row,
                        doi: augmentedDoi,
                        source: "augmented"
                    });
                    preInjectLabels(info.row, augmentedDoi, PILL_COLOR, true);
                } else if (info.extractedDoi && !augmentedDoi) {
                    // Extracted but augmentation found nothing — last-resort doi.org check
                    let valid = false;
                    try {
                        valid = await validateDOI(info.extractedDoi);
                    } catch (err) {
                        debugWarn(`Scholar: revalidation failed for ${info.extractedDoi} —`, err);
                    }

                    if (valid) {
                        debugLog(`Scholar resolve [extracted-revalidated] "${info.title}" → ${info.extractedDoi} (doi.org confirmed on retry)`);
                        rowDois.push({
                            row: info.row,
                            doi: info.extractedDoi,
                            source: "extracted"
                        });
                        preInjectLabels(info.row, info.extractedDoi, PILL_COLOR, false);
                    } else {
                        // Invalid DOI — no DOI pill, but still check for a
                        // retraction/concern notice (the static map is keyed
                        // independently of doi.org validity). Place the pill
                        // next to the row title since there's no DOI pill to
                        // anchor against.
                        debugLog(`Scholar resolve [extracted-invalid] "${info.title}" → ${info.extractedDoi} rejected (doi.org says invalid)`);
                        try {
                            const notices = await retractionCheck([info.extractedDoi]);
                            if (notices.length > 0) {
                                const titleEl = info.row.querySelector<HTMLElement>(".gs_rt");
                                if (titleEl) injectRetractionInfo(titleEl, notices[0], { afterend: true });
                            }
                        } catch (err) {
                            debugWarn(`Scholar: notice check failed for ${info.extractedDoi} —`, err);
                        }
                    }
                } else if (!info.extractedDoi && augmentedDoi) {
                    // No extraction, only augmented → rendered as unconfirmed
                    debugLog(`Scholar resolve [augmented-only] "${info.title}" → ${augmentedDoi} (no extraction)`);
                    rowDois.push({
                        row: info.row,
                        doi: augmentedDoi,
                        source: "augmented"
                    });
                    preInjectLabels(info.row, augmentedDoi, PILL_COLOR, true);
                } else {
                    debugLog(`Scholar resolve [no-doi] "${info.title}" → no DOI from extraction or augmentation`);
                }
            }
        }
    }

    const extracted = rowDois.filter((r) => r.source === "extracted").length;
    const augmentedCount = rowDois.filter((r) => r.source === "augmented").length;
    debugLog(`${extracted} DOIs from Scholar, ${augmentedCount} augmented via Crossref/OpenAlex`);

    if (rowDois.length === 0) return;

    const uniqueDois = [...new Set(rowDois.map((rd) => rd.doi))];
    debugLog("Scholar: Sending lookup for", uniqueDois.length, "unique DOIs:", uniqueDois);
    reportWorkStage("lookup", `Found ${count(uniqueDois.length, "unique DOI")} — looking them up…`);
    const titleByDoi = new Map<DoiString, string>();
    for (const {row, doi} of rowDois) {
        if (!titleByDoi.has(doi)) titleByDoi.set(doi, rowTitle(row));
    }
    setWorkItems(uniqueDois.map((doi) => workItem(doi, titleByDoi.get(doi) ?? doi, doi)));
    const request: LookupRequest = {type: "FLORA_LOOKUP", dois: uniqueDois};

    try {
        const response: LookupResponse =
            await chrome.runtime.sendMessage(request);
        debugLog("Scholar: Lookup response:", Object.keys(response.results).length, "results,", Object.keys(response.errors).length, "errors");

        let badgedCount = 0;
        for (const {doi, source} of rowDois) {
            if (response.results[doi]) {
                scholarState.set(doi, {status: "matched", result: response.results[doi], source});
                badgedCount++;
            }
        }
        for (const doi of uniqueDois) {
            if (response.errors[doi]) updateWorkItem(doi, "failed");
            else updateWorkItem(doi, response.results[doi] ? "flagged" : "done");
        }

        // Paused while the lookup ran — the results stay in scholarState for a
        // later pass, but nothing goes on the page.
        if (scholarHidden) return;

        reportWorkStage("report", `Marking up ${count(badgedCount, "result")}…`);
        refreshScholarBadges();
        debugLog("Scholar: Rendered", badgedCount, "badge(s)");
    } catch (err) {
        debugLog("Scholar: Lookup failed:", err);
    }
}

function rowTitle(row: HTMLElement): string {
    // The heading starts with Scholar's type tags ("[HTML]", "[PDF]") — not part of the title.
    return row.querySelector(".gs_rt a, .gs_rt")?.textContent?.replace(/^(\s*\[[A-Z]+\])+\s*/, "").trim() ?? "";
}

/** First author and year of a row, for the item's right-hand detail column. */
function rowByline(info: {firstAuthor: string | null; year: number | null}): string | undefined {
    const parts = [info.firstAuthor, info.year?.toString()].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : undefined;
}

/** One work-toast item, pending until its stage reports back on it. */
function workItem(id: string, label: string, detail?: string): WorkItem {
    return {id, label: label || id, detail, status: "pending"};
}

async function preInjectLabels(row: HTMLElement, doi: DoiString, color: string, isAugmented = false): Promise<void> {
    try {
        injectDoiLabel(row, doi, color, isAugmented);
        const notices = await retractionCheck([doi]);
        if (notices?.[0]) {
            scholarRedacts.set(doi, notices[0]);
            refreshScholarBadges();
        }
    } catch (err) {
        debugError(`Scholar: could not label ${doi} —`, err);
    }
}

/** Prefer Scholar's right-side PDF area; create one if the row has none. */
function pillTarget(row: HTMLElement): Element {
    const existing = row.querySelector(".gs_ggs");
    if (existing) return existing;
    const target = document.createElement("div");
    target.className = "gs_ggs gs_fl";
    row.insertBefore(target, row.querySelector(".gs_ri"));
    return target;
}

function injectDoiLabel(row: HTMLElement, doi: string, color: string, isAugmented = false): void {
    pillTarget(row).appendChild(createIndicatorPanel({
        doi: doi as DoiString,
        color,
        isAugmented,
        oaStatus: fetchOpenAccess(doi),
        retraction: scholarRedacts.get(doi as DoiString) ?? null,
    }));
}

interface ExtractionResult {
    doi: DoiString;
    /** true when the DOI comes from a doi.org URL (inherently trustworthy) */
    confident: boolean;
}

export interface ScholarRowMetadata {
    firstAuthor: string | null;
    year: number | null;
}

/**
 * Pull a row's first-author surname and year from its `.gs_a` byline
 * (e.g. "MD Wilkinson, M Dumontier… - Scientific data, 2016 - nature.com")
 * so augmentDOIs can disambiguate between similarly-titled works.
 */
export function extractScholarRowMetadata(row: HTMLElement): ScholarRowMetadata {
    const authorLine = row.querySelector(".gs_a")?.textContent ?? "";
    const beforeSource = authorLine.split(" - ")[0] ?? "";
    const firstAuthorText = beforeSource.split(",")[0]?.replace(/…/g, "").trim() ?? "";
    const authorTokens = firstAuthorText
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .filter((token) => token && !/^[A-Z]\.?$/i.test(token));
    const firstAuthor = authorTokens[authorTokens.length - 1] ?? null;
    const yearMatch = authorLine.match(/\b((?:19|20)\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    return {firstAuthor, year};
}

function extractDoiFromScholarRow(row: HTMLElement): ExtractionResult | null {
    const title = row.querySelector(".gs_rt")?.textContent?.trim() ?? "(untitled)";

    // 1. Title link href — doi.org URL is inherently trustworthy
    const titleLink = row.querySelector<HTMLAnchorElement>(".gs_rt a");
    if (titleLink?.href) {
        const doi = normaliseDOI(titleLink.href);
        if (doi) {
            debugLog(`Scholar DOI [title-link doi.org] "${title}" → ${doi} (confident) from ${titleLink.href}`);
            return {doi, confident: true};
        }
        // DOI explicitly named in query params (e.g. ?doi=10.xxx/yyy, ?identifierName=doi&identifierValue=10.xxx)
        const doiFromParams = extractDoiFromQueryParams(titleLink.href);
        if (doiFromParams) {
            debugLog(`Scholar DOI [title-link query-param] "${title}" → ${doiFromParams} (confident) from ${titleLink.href}`);
            return {doi: doiFromParams, confident: true};
        }
        // DOI may be embedded in path (e.g. /edit/10.xxx/yyy/slug)
        try {
            const decoded = decodeURIComponent(titleLink.href);
            const m = decoded.match(/\b(10\.\d{4,}(?:\.\d+)*\/[^\s&"'#?/]+)/);
            if (m) {
                const embeddedDoi = normaliseDOI(m[1]);
                if (embeddedDoi) {
                    debugLog(`Scholar DOI [title-link embedded-path] "${title}" → ${embeddedDoi} (not confident) from ${titleLink.href}`);
                    return {doi: embeddedDoi, confident: false};
                }
            }
        } catch { /* invalid encoding — skip */
        }
    }

    // 2. Author/source line text
    const authorLine = row.querySelector(".gs_a");
    if (authorLine?.textContent) {
        const match = authorLine.textContent.match(
            /\b(10\.\d{4,}(?:\.\d+)*\/\S+)\b/
        );
        if (match) {
            const doi = normaliseDOI(match[1]);
            if (doi) {
                debugLog(`Scholar DOI [author-line text] "${title}" → ${doi} (confident) from "${authorLine.textContent.trim()}"`);
                return {doi, confident: true};
            }
        }
    }

    // 3. Any link containing doi.org — inherently trustworthy
    const links = row.querySelectorAll<HTMLAnchorElement>("a[href]");
    for (const link of links) {
        if (link.href.includes("doi.org/")) {
            const doi = normaliseDOI(link.href);
            if (doi) {
                debugLog(`Scholar DOI [doi.org link] "${title}" → ${doi} (confident) from ${link.href}`);
                return {doi, confident: true};
            }
        }
    }

    // 4. DOI in query params of any link (explicitly labelled → confident)
    for (const link of links) {
        const paramDoi = extractDoiFromQueryParams(link.href);
        if (paramDoi) {
            debugLog(`Scholar DOI [link query-param] "${title}" → ${paramDoi} (confident) from ${link.href}`);
            return {doi: paramDoi, confident: true};
        }
    }

    // 5. DOI embedded in any link URL path (e.g. /edit/10.xxx/yyy/slug)
    const doiInUrlRe = /\b(10\.\d{4,}(?:\.\d+)*\/[^\s&"'#?/]+)/;
    for (const link of links) {
        try {
            const decoded = decodeURIComponent(link.href);
            const m = decoded.match(doiInUrlRe);
            if (m) {
                const doi = normaliseDOI(m[1]);
                if (doi) {
                    debugLog(`Scholar DOI [link embedded-path] "${title}" → ${doi} (not confident) from ${link.href}`);
                    return {doi, confident: false};
                }
            }
        } catch { /* invalid encoding */
        }
    }

    debugLog(`Scholar DOI [none] "${title}" → no DOI extracted`);
    return null;
}

/** Extract a DOI from URL query params where the param name explicitly indicates a DOI. */
function extractDoiFromQueryParams(href: string): DoiString | null {
    try {
        const url = new URL(href);
        const params = url.searchParams;

        // Direct param: ?doi=10.xxx/yyy
        for (const key of params.keys()) {
            if (key.toLowerCase() === "doi") {
                const doi = normaliseDOI(params.get(key) ?? "");
                if (doi) return doi;
            }
        }

        // Indirect pattern: ?identifierName=doi&identifierValue=10.xxx/yyy
        const idName = params.get("identifierName") ?? params.get("identifier_name") ?? "";
        if (idName.toLowerCase() === "doi") {
            const val = params.get("identifierValue") ?? params.get("identifier_value") ?? "";
            const doi = normaliseDOI(val);
            if (doi) return doi;
        }
    } catch { /* invalid URL */
    }
    return null;
}
