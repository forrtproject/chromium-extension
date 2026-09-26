// Content script for search-results sites (Google Scholar, OpenAlex, …). The
// site adapter chosen by hostname supplies selectors, row reading and panel
// placement; pipeline.ts does everything else.

import {resolveSearchSite} from "./sites";
import {observeSearchResults, processIfResultsPage} from "./observer";
import {isSearchHidden, retryUnansweredSearchResults, setSearchHidden} from "./pipeline";
import {debugError, debugLog} from "@shared/debug";
import {installErrorReporting, reportCodeError} from "@shared/error-report";
import {isSetupComplete} from "@shared/settings";
import {getDomainPause, onDomainPauseChange} from "@shared/domains";
import {cancelWork, resumeAutomaticWork} from "@shared/work-cancellation";
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

type SearchAdapter = NonNullable<ReturnType<typeof resolveSearchSite>>;

async function startSearch(adapter: SearchAdapter): Promise<void> {
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
}

function startWhenResumed(adapter: SearchAdapter, snoozedUntil: number | null): void {
    let started = false;
    onDomainPauseChange(() => [location.hostname], (pause) => {
        if (started) return;
        if (pause.blocked) { reportBlocked(); return; }
        if (pause.snoozedUntil !== null) { reportActiveState(false, pause.snoozedUntil); return; }
        started = true;
        debugLog("Search: domain re-enabled — starting ORE on this page");
        void startSearch(adapter).catch((err) => reportCodeError("ORE failed to start on search page", err));
    }, snoozedUntil);
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

        const pause = await getDomainPause([location.hostname]);
        if (pause.blocked || pause.snoozedUntil !== null) {
            debugLog(`Domain is ${pause.blocked ? "blocked" : "snoozed"}:`, location.hostname);
            if (pause.blocked) reportBlocked();
            else reportActiveState(false, pause.snoozedUntil);
            startWhenResumed(adapter, pause.snoozedUntil);
            return;
        }
        await startSearch(adapter);
    } catch (err) {
        reportCodeError("ORE failed to start on search page", err);
        reportActiveState(false);
    }
})();

let pausedBySettings = false;

function followDomainPause(adapter: SearchAdapter): void {
    onDomainPauseChange(() => [location.hostname], ({blocked, snoozedUntil}) => {
        if (blocked || snoozedUntil !== null) {
            if (!isSearchHidden()) pausedBySettings = true;
            setSearchHidden(true);
            cancelWork();
            hideAllFloraUI();
            if (blocked) reportBlocked();
            else reportActiveState(false, snoozedUntil);
            return;
        }
        if (!pausedBySettings) return;
        pausedBySettings = false;
        setSearchHidden(false);
        resumeAutomaticWork();
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
