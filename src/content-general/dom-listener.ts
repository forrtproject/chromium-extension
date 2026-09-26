import {containsDoiCandidate, touchesReferenceSection} from "@shared/doi-extractor";
import {isExternalMutation, isFloraOwnedNode, owningElement} from "@shared/flora-ui";
import {debugLog} from "@shared/debug";
import {isWordOnline} from "@shared/word-online";
import {editorContentSnapshot} from "@shared/document-editor";
import {currentPageEntry, isSamePage, pageUrl} from "@shared/page-identity";

const MAX_INCREMENTAL_NODES = 50;

const DEBOUNCE_MS = 300;
const WORD_QUIET_MS = 1500;

/** True when any added subtree introduces DOI-like content or reference entries. */
export function scanAddedNodes(nodes: Element[]): boolean {
    for (const el of nodes) {
        if (!el.isConnected) continue;
        if (containsDoiCandidate(el)) return true;
        if (touchesReferenceSection(el)) return true;
    }
    return false;
}

export interface DomListenerOptions {
    scanWholePage: () => void;
    /** Current URL as of the last full scan — a change in its `pageUrl` means SPA navigation. */
    getLastUrl: () => string;
}
export function startDomListener({scanWholePage, getLastUrl}: DomListenerOptions): MutationObserver {
    let debounceTimer: ReturnType<typeof setTimeout>;
    let pendingNodes: Element[] = [];
    let pendingFullScan = false;
    let missedWhileHidden = false;
    let lastWordScan = -Infinity;
    let lastWordText: string | number | null = null;
    let navigated = false;

    const flush = (): void => {
        const samePage = pageUrl(location.href) === pageUrl(getLastUrl());
        if (isWordOnline() && samePage && Date.now() - lastWordScan < 1000) {
            debounceTimer = setTimeout(flush, 1000 - (Date.now() - lastWordScan));
            return;
        }
        const nodes = pendingNodes;
        const full = pendingFullScan;
        const wasNavigation = navigated;
        pendingNodes = [];
        pendingFullScan = false;
        navigated = false;
        if (isWordOnline() && samePage && !wasNavigation) {
            const text = editorContentSnapshot();
            if (text === lastWordText && !scanAddedNodes(nodes.filter((node) => !node.closest("#WACViewPanel")))) {
                debugLog("General: Word re-rendered without changing the text — skipped full scan");
                return;
            }
            lastWordText = text;
        }
        if (full || !samePage || scanAddedNodes(nodes)) {
            if (isWordOnline()) lastWordScan = Date.now();
            scanWholePage();
        } else {
            debugLog("General: mutation carried no DOI candidates — skipped full scan");
        }
    };

    const navigation = (window as Window & {navigation?: EventTarget}).navigation;
    let observed = currentPageEntry();
    navigation?.addEventListener("currententrychange", () => {
        const previous = observed;
        observed = currentPageEntry();
        if (isSamePage(previous, observed)) return;
        lastWordScan = -Infinity;
        lastWordText = null;
        navigated = true;
        pendingFullScan = true;
        if (document.hidden) { missedWhileHidden = true; return; }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flush, DEBOUNCE_MS);
    });

    const observer = new MutationObserver((mutations) => {
        // Do no work while this tab is in the background. The records go
        // uninspected, so the catch-up on resume can only be a full scan.
        if (document.hidden) {
            missedWhileHidden = true;
            pendingFullScan = true;
            return;
        }
        let hasExternalChange = false;
        for (const m of mutations) {
            // Word edits existing text nodes and removes/replaces paragraph
            // renderings while typing. These records have no added elements.
            if (isWordOnline() && owningElement(m.target)?.closest("#WACViewPanel")) {
                hasExternalChange = true;
                pendingFullScan = true;
            }
            if (!isExternalMutation(m)) continue;
            hasExternalChange = true;
            if (m.target === document.body || m.target === document.documentElement) {
                pendingFullScan = true;
            }
            for (const node of m.addedNodes) {
                if (isFloraOwnedNode(node)) continue;
                const el = owningElement(node);
                if (el) pendingNodes.push(el);
            }
        }
        if (!hasExternalChange) return;
        if (pendingNodes.length > MAX_INCREMENTAL_NODES) pendingFullScan = true;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flush, isWordOnline() ? WORD_QUIET_MS : DEBOUNCE_MS);
    });
    observer.observe(document.body, {childList: true, subtree: true, characterData: isWordOnline()});
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            // A debounce armed while visible would otherwise fire in the
            // background and scan the page a second time on the catch-up.
            if (pendingFullScan || pendingNodes.length > 0) missedWhileHidden = true;
            clearTimeout(debounceTimer);
            return;
        }
        if (!missedWhileHidden) return;
        missedWhileHidden = false;
        clearTimeout(debounceTimer);
        // Run the work the debounce was holding: a full scan when one is
        // pending, and otherwise only the nodes that arrived, which skip the
        // scan when they carry no DOI candidates.
        flush();
    });
    return observer;
}
