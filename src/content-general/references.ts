// Reference-list DOI resolution for article pages.
//
// Surfaces an inline DOI pill on reference-list entries so the reader gets a
// consistent click-to-open/copy action on each citation. The pill colour
// signals provenance: pink = DOI found directly on the page (in text or a
// link href), gray dotted = DOI resolved via Crossref/OpenAlex augmentation
// for entries that exposed no DOI of their own.

import {findReferenceEntries, extractDoiFromHref, type ReferenceEntry} from "@shared/doi-extractor";
import {augmentDOIsViaWorker, resolvePmcIdsViaWorker} from "@shared/messages";
import {validateDOIs} from "@shared/doi-validate";
import {alignNoticePillWith, type RetractionResponse} from "@shared/doi-retraction";
import {createIndicatorPill} from "@shared/indicator-pill";
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

/**
 * Place a DOI pill inline. For a DOI the page itself carries, the pill goes
 * right after the link or text that holds it, so it reads as part of the
 * citation.
 *
 * An augmented DOI has no element on the page to anchor to. Appending it to
 * the entry root drops it onto its own line below the publisher action row
 * ("View PDF | View article | … | Google Scholar"); instead we insert it
 * right after the entry's last link so it sits inline with that row. Falls
 * back to the entry end only when the entry has no links at all.
 */
function findSmallestTextContainer(root: HTMLElement, needle: string): HTMLElement | null {
    let best: HTMLElement | null = null;
    let bestLen = Infinity;
    for (const el of root.querySelectorAll<HTMLElement>("*")) {
        const t = el.textContent ?? "";
        if (!t.includes(needle)) continue;
        if (t.length < bestLen) {
            best = el;
            bestLen = t.length;
        }
    }
    return best;
}

// Descendant with ≥50% but <100% of the entry's text — the citation body,
// excluding trailing action-link rows ("Article | Google Scholar").
function findCitationBody(entry: HTMLElement): HTMLElement | null {
    const entryText = (entry.textContent ?? "").trim();
    if (entryText.length < 40) return null;
    const floor = Math.floor(entryText.length * 0.5);
    let best: HTMLElement | null = null;
    let bestLen = 0;
    for (const el of entry.querySelectorAll<HTMLElement>("*")) {
        const t = (el.textContent ?? "").trim();
        if (t.length >= floor && t.length < entryText.length && t.length > bestLen) {
            best = el;
            bestLen = t.length;
        }
    }
    return best;
}

function placeReferencePill(
    entry: HTMLElement,
    doi: DoiString,
    mode: ReferenceMode,
    pill: HTMLElement,
    adapter: SiteAdapter | null
): void {
    // A stale adapter selector falls through to the heuristics below.
    if (applyPlacement(adapter?.referencePill, entry, pill, `reference pill for ${doi}`)) return;

    if (mode === "page") {
        for (const link of entry.querySelectorAll<HTMLAnchorElement>("a[href]")) {
            if (extractDoiFromHref(link.href) === doi) {
                link.insertAdjacentElement("afterend", pill);
                return;
            }
        }
        const textHost = findSmallestTextContainer(entry, doi);
        if (textHost) {
            textHost.appendChild(pill);
            return;
        }
    } else {
        const body = findCitationBody(entry);
        if (body) {
            body.appendChild(pill);
            return;
        }
    }
    const links = entry.querySelectorAll<HTMLAnchorElement>("a[href]");
    const lastLink = links[links.length - 1];
    if (lastLink) {
        lastLink.insertAdjacentElement("afterend", pill);
    } else {
        entry.appendChild(pill);
    }
}

const PROCESSED_ATTR = "data-flora-ref-processed";

function releaseReferenceEntry(entry: ReferenceEntry): void {
    entry.element.removeAttribute(PROCESSED_ATTR);
}

export function releaseReferenceEntries(resolved: ResolvedReference[]): void {
    for (const r of resolved) releaseReferenceEntry(r.entry);
}

export function resetReferenceMarkers(root: ParentNode = document): void {
    for (const el of root.querySelectorAll(`[${PROCESSED_ATTR}]`)) {
        el.removeAttribute(PROCESSED_ATTR);
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

    const pending: PendingEntry[] = [];
    for (const entry of entries) {
        if (entry.element.hasAttribute(PROCESSED_ATTR)) continue;
        if (entry.text.length < MIN_CITATION_LENGTH) continue;
        // Filter before augmenting: an out-of-scope block that reaches
        // Crossref/OpenAlex can come back with a confident-looking wrong DOI.
        if (!isInReferenceScope(entry.element, adapter)) continue;

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

    for (const p of queued) p.entry.element.setAttribute(PROCESSED_ATTR, "true");

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
            doi,
            color: PILL_COLOR,
            isAugmented,
            provenanceLabel: mode === "pmc" ? "Matched by PMC ID" : undefined,
            oaStatus: fetchOpenAccess(doi),
            retraction: retractionByDoi.get(doi) ?? null,
            replicationsCount: stats?.n_replications_total ?? null,
            reproductionsCount: stats?.n_reproductions_total ?? null,
        });
        applyPillStyle(pill, adapter, "reference");
        placeReferencePill(entry.element, doi, mode, pill, adapter);
        alignNoticePillWith(pill, doi, entry.element);
        debugLog(`References: surfaced "${entry.text.slice(0, 60)}" → ${doi} (${mode})`);
    }
    debugLog(`References: rendered ${resolved.length} inline indicator pill(s)`);
}


