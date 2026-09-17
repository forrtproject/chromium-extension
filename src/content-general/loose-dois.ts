import {createIndicatorPill, INDICATOR_PILL_CLASS} from "@shared/indicator-pill";
import {fetchOpenAccess} from "@shared/openaccess";
import {isDocumentEditor} from "@shared/document-editor";
import {debugLog} from "@shared/debug";
import type {DoiOccurrence} from "@shared/doi-extractor";
import type {DoiContext, DoiString, LookupState} from "@shared/types";

export const LOOSE_PILL_ATTR = "data-flora-loose-pill";

const pilled = new Set<DoiString>();

export function resetLooseDoiPills(): void {
    pilled.clear();
}

function isEditableSurface(el: HTMLElement): boolean {
    return el.isContentEditable || el.closest("textarea, input, [contenteditable]") !== null;
}

function placeAfterMention(source: HTMLElement, doi: DoiString, pill: HTMLElement): void {
    try {
        for (const node of source.childNodes) {
            if (node.nodeType !== Node.TEXT_NODE) continue;
            const text = node as Text;
            const at = text.data.toLowerCase().indexOf(doi.toLowerCase());
            if (at < 0) continue;
            const tail = text.splitText(at + doi.length);
            source.insertBefore(pill, tail);
            return;
        }
    } catch { }
    source.appendChild(pill);
}

function stillOnPage(doi: DoiString): boolean {
    for (const el of document.querySelectorAll(`.${INDICATOR_PILL_CLASS}[${LOOSE_PILL_ATTR}]`)) {
        if (el.getAttribute("data-flora-doi") === doi) return true;
    }
    return false;
}

export interface LooseDoiInputs {
    occurrences: readonly DoiOccurrence[];
    context: ReadonlyMap<DoiString, DoiContext>;
    pageState: ReadonlyMap<DoiString, LookupState>;
    noticed: ReadonlySet<DoiString>;
}

export function injectLooseDoiPills({occurrences, context, pageState, noticed}: LooseDoiInputs): number {
    if (isDocumentEditor()) return 0;
    let placed = 0;
    for (const occ of occurrences) {
        if (context.get(occ.doi) !== "other") continue;
        if (noticed.has(occ.doi)) continue;
        if (pilled.has(occ.doi) && stillOnPage(occ.doi)) continue;
        if (!occ.source.isConnected) continue;
        if (occ.source.closest(`.${INDICATOR_PILL_CLASS}`)) continue;
        if (isEditableSurface(occ.source)) continue;

        const state = pageState.get(occ.doi);
        const stats = state?.status === "matched" ? state.result.record.stats : null;
        const pill = createIndicatorPill({
            doi: occ.doi,
            oaStatus: fetchOpenAccess(occ.doi),
            replicationsCount: stats?.n_replications_total ?? null,
            reproductionsCount: stats?.n_reproductions_total ?? null,
        });
        pill.setAttribute(LOOSE_PILL_ATTR, "");

        if (occ.kind === "text") placeAfterMention(occ.source, occ.doi, pill);
        else occ.source.insertAdjacentElement("afterend", pill);

        pilled.add(occ.doi);
        placed++;
    }
    if (placed > 0) debugLog(`Loose DOIs: pilled ${placed} mention(s) outside an article or reference list`);
    return placed;
}
