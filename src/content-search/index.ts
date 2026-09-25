// Content script for search-results sites (Google Scholar, OpenAlex, …). The
// site adapter chosen by hostname supplies selectors, row reading and panel
// placement; pipeline.ts does everything else.

import {resolveSearchSite} from "./sites";
import {observeSearchResults, processIfResultsPage} from "./observer";
import {isSearchHidden, retryUnansweredSearchResults, setSearchHidden} from "./pipeline";
import {debugError, debugLog} from "@shared/debug";
import {installErrorReporting, reportCodeError} from "@shared/error-report";
import {isSetupComplete} from "@shared/settings";
import {getSnooze, isDomainBlocked, onDomainPauseChange} from "@shared/domains";
import {reportActiveState, reportBlocked, reportInactive} from "@shared/active-state";
import {renderSetupPrompt, hideAllFloraUI, showAllFloraUI} from "../content-general/injector";

const SITE_STYLE_ID = "flora-search-site-style";

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
        installErrorReporting();

        const adapter = resolveSearchSite(location.hostname);
        if (!adapter) {
            debugLog("Search content script: no adapter for", location.hostname);
            return;
        }

        if (await isDomainBlocked(location.hostname)) {
            debugLog("Domain is blocked:", location.hostname);
            reportBlocked();
            return;
        }

        const snoozedUntil = await getSnooze(location.hostname);
        if (snoozedUntil !== null) {
            debugLog("Domain is snoozed:", location.hostname);
            reportActiveState(false, snoozedUntil);
            return;
        }
        reportActiveState(true);
        followDomainPause(adapter);

        if (!(await isSetupComplete())) {
            renderSetupPrompt();
        }

        debugLog(`${adapter.label} content script loaded`);
        injectSiteStyle(adapter.css);

        // Process any results already on the page
        processIfResultsPage(adapter, "initial pass");

        // Start observing for dynamically loaded results
        observeSearchResults(adapter);

        chrome.storage.onChanged.addListener((changes, area) => {
            const settings = changes.flora_settings;
            if (area !== "sync" || !settings?.newValue?.email?.trim()
                || settings.newValue.email === settings.oldValue?.email) return;
            void retryUnansweredSearchResults(adapter, document).catch(err =>
                debugError(`${adapter.label}: DOI matching after settings change failed —`, err));
        });
    } catch (err) {
        reportCodeError("ORE failed to start on search page", err);
        reportActiveState(false);
    }
})();

let pausedBySettings = false;

function followDomainPause(adapter: NonNullable<ReturnType<typeof resolveSearchSite>>): void {
    onDomainPauseChange(() => [location.hostname], ({blocked, snoozedUntil}) => {
        if (blocked || snoozedUntil !== null) {
            if (!isSearchHidden()) pausedBySettings = true;
            setSearchHidden(true);
            hideAllFloraUI();
            if (blocked) reportBlocked();
            else reportActiveState(false, snoozedUntil);
            return;
        }
        if (!pausedBySettings) return;
        pausedBySettings = false;
        setSearchHidden(false);
        showAllFloraUI();
        reportActiveState(true);
        processIfResultsPage(adapter, "pass after re-enabling");
    });
}

// hideAllFloraUI/showAllFloraUI already sweep the indicator panels, which are
// the only per-result UI search rows carry.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return;
    const type = (message as { type?: string }).type;

    if (type === "FLORA_HIDE_UI") {
        pausedBySettings = false;
        setSearchHidden(true);
        hideAllFloraUI();
        reportInactive();
        sendResponse({ ok: true });
    } else if (type === "FLORA_SHOW_UI") {
        pausedBySettings = false;
        setSearchHidden(false);
        showAllFloraUI();
        reportActiveState(true);
        // Rows that loaded while the site was paused were left unprocessed, so
        // showing the UI again has nothing to show for them until a pass runs.
        const adapter = resolveSearchSite(location.hostname);
        if (adapter) processIfResultsPage(adapter, "pass after unhide");
        sendResponse({ ok: true });
    } else if (type === "FLORA_GET_STATE") {
        sendResponse({ hidden: isSearchHidden() });
    }
});

// The pause control on the work toast writes the snooze (or block) to storage
// itself, then announces it here so this page clears immediately instead of
// waiting for a reload.
document.addEventListener("flora-pause-site", () => {
    if (!isSearchHidden()) pausedBySettings = true;
    setSearchHidden(true);
    hideAllFloraUI();
    reportInactive();
});
