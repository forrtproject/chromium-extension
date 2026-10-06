import {createIndicatorPill, INDICATOR_PILL_CLASS} from "@shared/indicator-pill";
import {deferredOpenAccess} from "@shared/openaccess";
import {isDocumentEditor} from "@shared/document-editor";
import {findArticleTitle} from "@shared/article-title";
import {isInRelatedWorks} from "@shared/related-works";
import {REFERENCE_ENTRY_ATTR} from "@shared/flora-ui";
import {pillRow} from "@shared/pill-row";
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

const LOOSE_ROW_ATTR = "data-flora-loose-row";

function isBlockLevel(el: Element): boolean {
    const display = getComputedStyle(el).display;
    return display !== "" && !display.startsWith("inline") && display !== "contents";
}

function mentionNode(source: HTMLElement, doi: DoiString): Node {
    for (const node of source.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && (node as Text).data.toLowerCase().includes(doi.toLowerCase())) return node;
    }
    return source;
}

function lineRunEnd(start: Node): Node {
    let node = start;
    while (node.parentElement && !isBlockLevel(node.parentElement)) node = node.parentElement;
    for (let next = node.nextSibling; next; next = next.nextSibling) {
        if (next instanceof Element && isBlockLevel(next)) break;
        node = next;
        if (next instanceof HTMLBRElement) break;
    }
    return node;
}

function newLooseRow(pill: HTMLElement): HTMLElement {
    const row = pillRow(pill);
    row.setAttribute(LOOSE_ROW_ATTR, "");
    return row;
}

function isFlexOrGrid(el: Element): boolean {
    const {display} = getComputedStyle(el);
    return display.includes("flex") || display.includes("grid");
}

function placeBelowMentionLine(start: Node, pill: HTMLElement): void {
    if (start instanceof Element && isBlockLevel(start) && start.tagName !== "A" && !isFlexOrGrid(start)) {
        const last = start.lastElementChild;
        if (last?.hasAttribute(LOOSE_ROW_ATTR)) last.appendChild(pill);
        else start.appendChild(newLooseRow(pill));
        return;
    }
    let end = lineRunEnd(start);
    const body = end.ownerDocument?.body;
    while (end.parentElement && end.parentElement !== body && isFlexOrGrid(end.parentElement)) end = end.parentElement;
    const next = end.nextSibling;
    if (next instanceof Element && next.hasAttribute(LOOSE_ROW_ATTR)) next.appendChild(pill);
    else end.parentNode!.insertBefore(newLooseRow(pill), next);
}

function loosePillDoisOnPage(): Set<string> {
    const dois = new Set<string>();
    for (const el of document.querySelectorAll(`.${INDICATOR_PILL_CLASS}[${LOOSE_PILL_ATTR}]`)) {
        const doi = el.getAttribute("data-flora-doi");
        if (doi) dois.add(doi);
    }
    return dois;
}

export interface LooseDoiInputs {
    occurrences: readonly DoiOccurrence[];
    context: ReadonlyMap<DoiString, DoiContext>;
    pageState: ReadonlyMap<DoiString, LookupState>;
    noticed: ReadonlySet<DoiString>;
    primary?: DoiString | null;
}

function isPrefixOfPrimary(doi: DoiString, primary: DoiString | null | undefined): boolean {
    return !!primary && primary.length > doi.length && primary.startsWith(doi) && /[./_-]/.test(primary[doi.length]);
}

export function injectLooseDoiPills({occurrences, context, pageState, noticed, primary}: LooseDoiInputs): number {
    if (isDocumentEditor()) return 0;
    const article = findArticleTitle(document);
    const onPage = loosePillDoisOnPage();
    let placed = 0;
    for (const occ of occurrences) {
        if (context.get(occ.doi) !== "other") continue;
        if (noticed.has(occ.doi)) continue;
        if (pilled.has(occ.doi) && onPage.has(occ.doi)) continue;
        if (!occ.source.isConnected) continue;
        if (occ.source.closest(`.${INDICATOR_PILL_CLASS}`)) continue;
        if (occ.source.closest(`[${REFERENCE_ENTRY_ATTR}]`)) continue;
        if (isEditableSurface(occ.source)) continue;
        if (isInRelatedWorks(occ.source, article)) continue;
        if (occ.doi === primary || isPrefixOfPrimary(occ.doi, primary)) continue;

        const state = pageState.get(occ.doi);
        const stats = state?.status === "matched" ? state.result.record.stats : null;
        const pill = createIndicatorPill({
            doi: occ.doi,
            oaStatus: deferredOpenAccess(occ.doi),
            replicationsCount: stats?.n_replications_total ?? null,
            reproductionsCount: stats?.n_reproductions_total ?? null,
        });
        pill.setAttribute(LOOSE_PILL_ATTR, "");

        placeBelowMentionLine(occ.kind === "text" ? mentionNode(occ.source, occ.doi) : occ.source, pill);

        pilled.add(occ.doi);
        onPage.add(occ.doi);
        placed++;
    }
    if (placed > 0) debugLog(`Loose DOIs: pilled ${placed} mention(s) outside an article or reference list`);
    return placed;
}
