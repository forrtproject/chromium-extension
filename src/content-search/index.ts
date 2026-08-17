// Content script for search-results sites (Google Scholar, OpenAlex, …). The
// site adapter chosen by hostname supplies selectors, row reading and panel
// placement; pipeline.ts does everything else.

import {resolveSearchSite} from "./sites";
import {observeSearchResults} from "./observer";
import {processSearchResults} from "./pipeline";
import {debugError, debugLog} from "@shared/debug";
import {isSetupComplete} from "@shared/settings";
import {isDomainBlocked} from "@shared/domains";
import {renderSetupPrompt, hideAllFloraUI, showAllFloraUI} from "../content-general/injector";

const SITE_STYLE_ID = "flora-search-site-style";

// Tell the service worker whether FLoRA is active on this tab (toolbar icon).
function reportActiveState(active: boolean): void {
    try {
        chrome.runtime.sendMessage({type: "FLORA_ACTIVE_STATE", active}).catch(() => {});
    } catch {
        // extension context unavailable — ignore
    }
}

function injectSiteStyle(css: string): void {
    if (document.getElementById(SITE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = SITE_STYLE_ID;
    style.textContent = css;
    (document.head ?? document.documentElement).appendChild(style);
}

(async () => {
    try {
        if (window !== window.top) return;

        const adapter = resolveSearchSite(location.hostname);
        if (!adapter) {
            debugLog("Search content script: no adapter for", location.hostname);
            return;
        }

        if (await isDomainBlocked(location.hostname)) {
            debugLog("Domain is blocked:", location.hostname);
            reportActiveState(false);
            return;
        }
        reportActiveState(true);

        if (!(await isSetupComplete())) {
            renderSetupPrompt();
        }

        debugLog(`${adapter.label} content script loaded`);
        injectSiteStyle(adapter.css);

        // Process any results already on the page
        void processSearchResults(adapter, document).catch((err) =>
            debugError(`${adapter.label}: initial pass failed —`, err)
        );

        // Start observing for dynamically loaded results
        observeSearchResults(adapter);
    } catch (err) {
        debugError("ORE failed to start on search page —", err);
        reportActiveState(false);
    }
})();

let floraHidden = false;

// hideAllFloraUI/showAllFloraUI already sweep the indicator panels, which are
// the only per-result UI search rows carry.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return;
    const type = (message as { type?: string }).type;

    if (type === "FLORA_HIDE_UI") {
        floraHidden = true;
        hideAllFloraUI();
        reportActiveState(false);
        sendResponse({ ok: true });
    } else if (type === "FLORA_SHOW_UI") {
        floraHidden = false;
        showAllFloraUI();
        reportActiveState(true);
        sendResponse({ ok: true });
    } else if (type === "FLORA_GET_STATE") {
        sendResponse({ hidden: floraHidden });
    }
});
