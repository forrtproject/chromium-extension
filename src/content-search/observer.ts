// Watches the page for result rows the site adds after load — Scholar's
// "show more", OpenAlex's client-side page changes — and runs the pipeline on
// each new batch. It also watches for content filling into rows the pipeline
// could not read yet (SPA skeletons), and re-opens those rows for the next
// pass. Observing the whole document (rather than a results container) keeps
// this working on single-page apps that replace the container itself.

import {debugError} from "@shared/debug";
import {currentPageEntry, isSamePage} from "@shared/page-identity";
import {isExternalMutation} from "@shared/flora-ui";
import {NOT_READY, PROCESSED_ATTR, processSearchResults} from "./pipeline";
import type {SearchSiteAdapter} from "./sites/types";

const SETTLE_MS = 150;

export function observeSearchResults(adapter: SearchSiteAdapter): void {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const queuePass = (): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            void processSearchResults(adapter, document).catch((err) =>
                debugError(`${adapter.label}: pass on changed search results failed —`, err)
            );
        }, SETTLE_MS);
    };
    // Same-document navigation may reuse every result node, so no added-row
    // mutation will arrive. Coalesce rapid history changes and read the final DOM.
    const navigation = (window as Window & {navigation?: EventTarget}).navigation;
    let observed = currentPageEntry();
    navigation?.addEventListener("currententrychange", () => {
        const previous = observed;
        observed = currentPageEntry();
        if (!isSamePage(previous, observed)) queuePass();
    });



    const observer = new MutationObserver((mutations) => {
        let changed = false;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (
                    node instanceof HTMLElement &&
                    (node.matches(adapter.resultRow) || node.querySelector(adapter.resultRow))
                ) {
                    changed = true;
                    break;
                }
            }
            // Content added inside a row not read yet re-opens it for the next
            // pass. A row that never becomes readable (an ad) is re-read only
            // when its own content changes.
            const row = (mutation.target as Element).closest?.<HTMLElement>(adapter.resultRow);
            if (row && row.getAttribute(PROCESSED_ATTR) !== "true" && isExternalMutation(mutation)) {
                if (row.getAttribute(PROCESSED_ATTR) === NOT_READY) row.removeAttribute(PROCESSED_ATTR);
                changed = true;
            }
        }
        if (!changed) return;

        // Frameworks add rows one node at a time; wait for the batch to settle
        // so the pipeline sees them together (one toast, one lookup).
        queuePass();
    });

    observer.observe(document.documentElement, {childList: true, subtree: true});
}
