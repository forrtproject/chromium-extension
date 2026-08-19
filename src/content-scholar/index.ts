import { isScholarHidden, observeScholarResults, processScholarResults, setScholarHidden } from "./observer";
import { debugError, debugLog } from "@shared/debug";
import { isSetupComplete } from "@shared/settings";
import { isDomainBlocked, isDomainSnoozed } from "@shared/domains";
import { renderSetupPrompt, hideAllFloraUI, showAllFloraUI } from "../content-general/injector";

// Tell the service worker whether FLoRA is active on this tab (toolbar icon).
function reportActiveState(active: boolean): void {
  try {
    chrome.runtime.sendMessage({ type: "FLORA_ACTIVE_STATE", active }).catch(() => {});
  } catch {
    // extension context unavailable — ignore
  }
}

(async () => {
  try {
    if (window !== window.top) return;

    if (await isDomainBlocked(location.hostname)) {
      debugLog("Domain is blocked:", location.hostname);
      reportActiveState(false);
      return;
    }

    if (await isDomainSnoozed(location.hostname)) {
      debugLog("Domain is snoozed:", location.hostname);
      reportActiveState(false);
      return;
    }
    reportActiveState(true);

    if (!(await isSetupComplete())) {
      renderSetupPrompt();
    }

    debugLog("Scholar content script loaded");

    // Process any results already on the page
    void processScholarResults(document).catch((err) =>
      debugError("Scholar: initial pass failed —", err)
    );

    // Start observing for dynamically loaded results
    observeScholarResults();
  } catch (err) {
    debugError("ORE failed to start on Scholar —", err);
    reportActiveState(false);
  }
})();

// hideAllFloraUI/showAllFloraUI already sweep the merged indicator pills, which
// is the only per-result UI Scholar rows carry.
function hideScholarUI(): void {
  hideAllFloraUI();
}

function showScholarUI(): void {
  showAllFloraUI();
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message !== "object" || message === null) return;
  const type = (message as { type?: string }).type;

  if (type === "FLORA_HIDE_UI") {
    setScholarHidden(true);
    hideScholarUI();
    reportActiveState(false);
    sendResponse({ ok: true });
  } else if (type === "FLORA_SHOW_UI") {
    setScholarHidden(false);
    showScholarUI();
    reportActiveState(true);
    sendResponse({ ok: true });
  } else if (type === "FLORA_GET_STATE") {
    sendResponse({ hidden: isScholarHidden() });
  }
});

// The pause control on the work toast writes the snooze (or block) to storage
// itself, then announces it here so this page clears immediately instead of
// waiting for a reload.
document.addEventListener("flora-pause-site", () => {
  setScholarHidden(true);
  hideScholarUI();
  reportActiveState(false);
});
