// Reference-list DOI resolution for article pages.
//
// Surfaces an inline DOI pill on reference-list entries so the reader gets a
// consistent click-to-open/copy action on each citation. The pill colour
// signals provenance: pink = DOI found directly on the page (in text or a
// link href), gray dotted = DOI resolved via Crossref/OpenAlex augmentation
// for entries that exposed no DOI of their own.

import {findReferenceEntries, extractPrimaryDOI, type ReferenceEntry} from "@shared/doi-extractor";
import {findArticleTitle} from "@shared/article-title";
import {isInRelatedWorks} from "@shared/related-works";
import {isDocumentEditor, editorAnnotationTarget} from "@shared/document-editor";
import {augmentDOIsViaWorker, resolvePmcIdsViaWorker} from "@shared/messages";
import {validateDOIs} from "@shared/doi-validate";
import type {RetractionResponse} from "@shared/doi-retraction";
import {createIndicatorPill, INDICATOR_PILL_CLASS} from "@shared/indicator-pill";
import {FLORA_UI_SELECTOR, REFERENCE_ENTRY_ATTR} from "@shared/flora-ui";
import {PILL_ROW_CLASS, pillRow} from "@shared/pill-row";
import {LOOSE_PILL_ATTR} from "./loose-dois";
import {fetchOpenAccess} from "@shared/openaccess";
import {count, reportWorkStage} from "@shared/progress-toast";
import {debugLog, debugWarn} from "@shared/debug";
import type {DoiString, LookupState} from "@shared/types";
import {
    applyPillStyle,
    applyPlacement,
    currentSiteAdapter,
    expandReferencesSection,
    isInReferenceScope,
    type SiteAdapter,
} from "@shared/site-adapters";

const BLOCK_CHILD = /^(DIV|P|SECTION|ARTICLE|BLOCKQUOTE)$/;
const TABLE_PART = /^(TABLE|THEAD|TBODY|TFOOT|TR)$/;
const DOMINANT_SHARE = 0.85;

const textLength = (el: Element): number => (el.textContent ?? "").replace(/\s+/g, "").length;

function entryContentColumn(entry: HTMLElement): HTMLElement {
    let host = entry;
    for (;;) {
        const total = textLength(host);
        if (total === 0) return host;
        const main = Array.from(host.children).find((c): c is HTMLElement =>
            c instanceof HTMLElement && BLOCK_CHILD.test(c.tagName)
            && !c.matches(FLORA_UI_SELECTOR) && textLength(c) >= total * DOMINANT_SHARE);
        if (!main) return host;
        host = main;
    }
}

function laysChildrenSideBySide(el: Element): boolean {
    const {display, flexDirection} = getComputedStyle(el);
    return display.includes("grid") || (display.includes("flex") && !flexDirection.startsWith("column"));
}

function removeLoosePills(entry: HTMLElement, doi: DoiString): void {
    for (const loose of entry.querySelectorAll<HTMLElement>(`.${INDICATOR_PILL_CLASS}[${LOOSE_PILL_ATTR}]`)) {
        if (loose.getAttribute("data-flora-doi") !== doi) continue;
        const row = loose.parentElement?.classList.contains(PILL_ROW_CLASS) ? loose.parentElement : null;
        loose.remove();
        if (row?.childElementCount === 0) row.remove();
    }
}

function placeReferencePill(
    entry: HTMLElement,
    doi: DoiString,
    pill: HTMLElement,
    adapter: SiteAdapter | null
): void {
    const wordTarget = editorAnnotationTarget(entry);
    if (wordTarget) {
        for (const existing of wordTarget.querySelectorAll('.flora-indicator-pill')) existing.remove();
        wordTarget.prepend(pill);
        return;
    }
    removeLoosePills(entry, doi);
    if (applyPlacement(adapter?.referencePill, entry, pill, `reference pill for ${doi}`)) return;

    const row = pillRow(pill);
    let host = entryContentColumn(entry);
    if (TABLE_PART.test(host.tagName)) host = Array.from(host.querySelectorAll<HTMLElement>("td, th")).pop() ?? host;
    if (laysChildrenSideBySide(host)) host.insertAdjacentElement("afterend", row);
    else host.appendChild(row);
}


function releaseReferenceEntry(entry: ReferenceEntry): void {
    entry.element.removeAttribute(REFERENCE_ENTRY_ATTR);
}

export function releaseReferenceEntries(resolved: ResolvedReference[]): void {
    for (const r of resolved) releaseReferenceEntry(r.entry);
}

export function resetReferenceMarkers(root: ParentNode = document): void {
    for (const el of root.querySelectorAll(`[${REFERENCE_ENTRY_ATTR}]`)) {
        el.removeAttribute(REFERENCE_ENTRY_ATTR);
    }
}

// One colour for every provenance — an unconfirmed DOI is marked by the
// underline inside the pill, not by a different colour.
const PILL_COLOR = "#853953";
// Cap API usage on reference lists with many DOI-less entries.
const MAX_REFERENCE_AUGMENTATIONS = 30;
// Skip entries too short to be a real citation (avoids junk augmentation queries).
const MIN_CITATION_LENGTH = 16;
// Real citations always have a publication year. Without one, the entry is
// almost certainly a navigation stub (pagination, source-tab label, "Show more")
// inside a reference container — sending those to Crossref/OpenAlex would
// hallucinate a DOI and surface a stray pill on the section header.
const YEAR_RE = /\b(?:18|19|20)\d{2}\b/;

function citationYear(text: string): number | null {
    const match = YEAR_RE.exec(text);
    return match ? Number(match[0]) : null;
}

/** Provenance of a resolved DOI; only "augment" (fuzzy title match) is unconfirmed. */
export type ReferenceMode = "augment" | "page" | "pmc";

type PendingEntry =
  | { entry: ReferenceEntry; mode: "augment"; doi: null }
  | { entry: ReferenceEntry; mode: "pmc"; doi: null; pmcid: string }
  | { entry: ReferenceEntry; mode: "page"; doi: DoiString };

export interface ResolvedReference {
    entry: ReferenceEntry;
    doi: DoiString;
    mode: ReferenceMode;
}

/**
 * Resolve a DOI for every reference entry — read off the page where the
 * citation carries one, mapped from a PMC id, or matched by title via
 * Crossref/OpenAlex — and validate the matched ones. Returns the resolved list
 * without writing anything to the DOM.
 *
 * Idempotent: each entry is marked processed inside this function, so repeated
 * calls (e.g. from the mutation observer) skip entries already handled.
 */
export async function resolveReferenceDois(): Promise<ResolvedReference[]> {
    const adapter = currentSiteAdapter();
    // Reveal a collapsed reference accordion (Wiley) before scanning, so
    // pills don't render into a section the reader never opens.
    expandReferencesSection(adapter);
    const entries = findReferenceEntries(document);
    const primary = extractPrimaryDOI(document);
    const article = findArticleTitle(document);

    const pending: PendingEntry[] = [];
    for (const entry of entries) {
        if (entry.element.hasAttribute(REFERENCE_ENTRY_ATTR) || entry.element.querySelector(`[${REFERENCE_ENTRY_ATTR}]`)) continue;
        if (primary && entry.doi === primary) continue;
        if (entry.text.length < MIN_CITATION_LENGTH) continue;
        // Filter before augmenting: an out-of-scope block that reaches
        // Crossref/OpenAlex can come back with a confident-looking wrong DOI.
        if (!isInReferenceScope(entry.element, adapter)) continue;
        if (isInRelatedWorks(entry.element, article)) continue;

        if (entry.doi === null) {
            // Exact id mapping — skips the year gate and augmentation budget.
            if (entry.pmcid) {
                pending.push({entry, mode: "pmc", doi: null, pmcid: entry.pmcid});
                continue;
            }
            if (!YEAR_RE.test(entry.text)) continue;
            pending.push({entry, mode: "augment", doi: null});
        } else {
            pending.push({entry, mode: "page", doi: entry.doi});
        }
    }
    if (pending.length === 0) return [];

    const augmentTargets = pending
        .filter((p): p is Extract<PendingEntry, {mode: "augment"}> => p.mode === "augment")
        .slice(0, MAX_REFERENCE_AUGMENTATIONS);
    const pmcTargets = pending.filter(
        (p): p is Extract<PendingEntry, {mode: "pmc"}> => p.mode === "pmc"
    );
    const augmentSet = new Set(augmentTargets.map((p) => p.entry));
    const queued = pending.filter((p) => p.mode !== "augment" || augmentSet.has(p.entry));

    for (const p of queued) p.entry.element.setAttribute(REFERENCE_ENTRY_ATTR, "true");

    const onPageCount = queued.length - augmentTargets.length - pmcTargets.length;
    debugLog(
        `References: surfacing ${onPageCount} on-page DOI(s), resolving ${pmcTargets.length} PMC id(s),`
        + ` augmenting ${augmentTargets.length}`
    );

    if (augmentTargets.length > 0 || pmcTargets.length > 0) {
        const pending = augmentTargets.length + pmcTargets.length;
        reportWorkStage("augment", `Augmenting ${count(pending, "reference")} without a DOI…`);
    }

    const empty = new Map<string, DoiString | null>();
    const [augmentSettled, pmcSettled] = await Promise.allSettled([
        augmentTargets.length > 0
            ? augmentDOIsViaWorker(augmentTargets.map((p) => ({
                title: p.entry.text,
                titleIsFullCitation: true,
                year: citationYear(p.entry.text),
            })))
            : Promise.resolve(empty),
        pmcTargets.length > 0
            ? resolvePmcIdsViaWorker(pmcTargets.map((p) => p.pmcid))
            : Promise.resolve(empty),
    ]);
    if (augmentSettled.status === "rejected") {
        debugWarn(`References: augmentation failed for ${augmentTargets.length} entr(ies) —`, augmentSettled.reason);
    }
    if (pmcSettled.status === "rejected") {
        debugWarn(`References: PMC resolution failed for ${pmcTargets.length} entr(ies) —`, pmcSettled.reason);
    }
    const augmented = augmentSettled.status === "fulfilled" ? augmentSettled.value : empty;
    const byPmcId = pmcSettled.status === "fulfilled" ? pmcSettled.value : empty;

    const resolved: ResolvedReference[] = [];
    for (const p of queued) {
        if (p.mode === "page") {
            resolved.push({entry: p.entry, doi: p.doi, mode: "page"});
        } else if (p.mode === "pmc") {
            if (!byPmcId.has(p.pmcid)) releaseReferenceEntry(p.entry);
            const doi = byPmcId.get(p.pmcid) ?? null;
            if (doi) resolved.push({entry: p.entry, doi, mode: "pmc"});
        } else {
            if (!augmented.has(p.entry.text)) releaseReferenceEntry(p.entry);
            const doi = augmented.get(p.entry.text) ?? null;
            if (doi) resolved.push({entry: p.entry, doi, mode: "augment"});
        }
    }
    if (resolved.length === 0) {
        debugLog("References: nothing resolved");
        return [];
    }

    // Augmented DOIs are fuzzy title matches — validate them against doi.org.
    // On-page DOIs were read off the page and PMC-mapped ones came from NCBI's
    // exact id record; trust both and skip validation so doi.org doesn't
    // rate-limit the whole batch.
    const augmentResolved = resolved.filter((r) => r.mode === "augment");
    let validated = new Map<DoiString, boolean>();
    if (augmentResolved.length > 0) {
        reportWorkStage("validate", `Checking ${count(augmentResolved.length, "augmented DOI")} resolve…`);
        try {
            validated = await validateDOIs(augmentResolved.map((r) => r.doi));
        } catch (err) {
            debugWarn(`References: validation unavailable for ${augmentResolved.length} augmented DOI(s) —`, err);
        }
    }
    const confirmed = resolved.filter(
        (r) => r.mode === "page" || validated.get(r.doi) !== false
    );
    if (confirmed.length === 0) {
        debugLog("References: resolved DOIs all failed doi.org validation");
        return [];
    }
    return confirmed;
}

/**
 * Render one merged indicator pill (DOI + Open Access + PubPeer + retraction/
 * replication badge) on each resolved reference. Idempotent at the pill
 * level — repeated calls on the same entry skip via existing per-element
 * markers.
 */
export function renderResolvedReferences(
    resolved: ResolvedReference[],
    retractionByDoi: Map<DoiString, RetractionResponse>,
    pageState: ReadonlyMap<DoiString, LookupState>,
): void {
    const adapter = currentSiteAdapter();
    for (const {entry, doi, mode} of resolved) {
        const isAugmented = mode === "augment";
        const state = pageState.get(doi);
        const stats = state?.status === "matched" ? state.result.record.stats : null;
        const pill = createIndicatorPill({
            presentation: isDocumentEditor() ? "marker" : "pill",
            doi,
            color: PILL_COLOR,
            isAugmented,
            provenanceLabel: mode === "pmc" ? "Matched by PMC ID" : undefined,
            oaStatus: fetchOpenAccess(doi),
            retraction: retractionByDoi.get(doi) ?? null,
            replicationsCount: stats?.n_replications_total ?? null,
            reproductionsCount: stats?.n_reproductions_total ?? null,
        });
        placeReferencePill(entry.element, doi, pill, adapter);
        applyPillStyle(pill, adapter, "reference");
        debugLog(`References: surfaced "${entry.text.slice(0, 60)}" → ${doi} (${mode})`);
    }
    debugLog(`References: rendered ${resolved.length} inline indicator pill(s)`);
}
