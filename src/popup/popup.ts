import {
  getBlockedDomains,
  saveBlockedDomains,
  isDomainBlocked,
  getSnooze,
  clearSnooze,
} from "../shared/domains";
import { debugError, debugWarn, isDebugEnabledAsync, setDebug } from "../shared/debug";
import { buildDebugReport, issueUrl, stashIssueReport } from "../shared/debug-report";
import { getSettings, saveSettings } from "../shared/settings";

const domainEl = document.getElementById("current-domain")!;
const blockBtn = document.getElementById("block-btn")!;
const blockLabel = document.getElementById("block-btn-label")!;
const snoozeNote = document.getElementById("snooze-note")!;
const resumeBtn = document.getElementById("resume-btn")!;
const hideBtn = document.getElementById("hide-btn")!;
const hideLabel = document.getElementById("hide-btn-label")!;
const tourBtn = document.getElementById("tour-btn")!;
const optionsBtn = document.getElementById("options-btn")!;
const reportBtn = document.getElementById("report-btn")!;
const reportLabel = document.getElementById("report-btn-label")!;
const debugToggle = document.getElementById("debug-toggle") as HTMLInputElement;
const debugHint = document.getElementById("debug-hint")!;
const logCopyRow = document.getElementById("log-copy-row")!;
const logCopyToggle = document.getElementById("log-copy-toggle") as HTMLInputElement;
const statusEl = document.getElementById("popup-status")!;
const versionEl = document.getElementById("popup-version")!;

const extensionVersion = chrome.runtime.getManifest().version;
versionEl.textContent = `v${extensionVersion}`;
versionEl.title = `Extension version ${extensionVersion}`;

let currentDomain = "";
let blocked = false;
let snoozedUntil: number | null = null;
let hidden = false;
let debugOn = false;
let activeTabId: number | undefined;

reportBtn.style.display = "none";

function showStatus(msg: string, type: "success" | "error"): void {
  statusEl.textContent = msg;
  statusEl.className = `popup-status ${type}`;
  statusEl.hidden = false;
  setTimeout(() => {
    statusEl.hidden = true;
  }, 2500);
}

function updateBlockUI(): void {
  if (blocked) {
    blockLabel.textContent = "Enable on this domain";
    blockBtn.classList.add("is-blocked");
  } else {
    blockLabel.textContent = "Disable on this domain";
    blockBtn.classList.remove("is-blocked");
  }
}

/** "14:35", or "tomorrow at 09:00" when the pause runs past midnight. */
function formatUntil(until: number): string {
  const end = new Date(until);
  const time = end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return end.toDateString() === new Date().toDateString() ? time : `tomorrow at ${time}`;
}

function updateSnoozeUI(): void {
  const paused = snoozedUntil !== null;
  snoozeNote.hidden = !paused;
  resumeBtn.hidden = !paused;
  if (paused) {
    snoozeNote.textContent = `Paused until ${formatUntil(snoozedUntil!)}`;
  }
}

function updateHideUI(): void {
  if (hidden) {
    hideLabel.textContent = "Show on this page";
    hideBtn.classList.add("is-hidden");
  } else {
    hideLabel.textContent = "Hide on this page";
    hideBtn.classList.remove("is-hidden");
  }
}

function updateDebugUI(): void {
  debugToggle.checked = debugOn;
  debugHint.textContent = debugOn
    ? "Recording. Reload the page, reproduce the problem, then report the issue — the log is filled into the GitHub form for you."
    : "Turn this on, reload the page and reproduce the problem — then report the issue and the log comes with it.";
  reportLabel.textContent = debugOn
    ? "Report an issue with debug log"
    : "Report an issue on this domain";
  logCopyRow.hidden = !debugOn;
}

async function init(): Promise<void> {
  debugOn = await isDebugEnabledAsync();
  logCopyToggle.checked = (await getSettings()).offerLogCopyAfterPass;
  updateDebugUI();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    domainEl.textContent = "No active page";
    blockBtn.style.display = "none";
    hideBtn.style.display = "none";
    reportBtn.style.display = "none";
    return;
  }

  activeTabId = tab.id;

  try {
    const url = new URL(tab.url);
    currentDomain = url.hostname;
    domainEl.textContent = currentDomain;
  } catch {
    domainEl.textContent = "Internal page";
    blockBtn.style.display = "none";
    hideBtn.style.display = "none";
    reportBtn.style.display = "none";
    return;
  }

  blocked = await isDomainBlocked(currentDomain);
  updateBlockUI();
  snoozedUntil = await getSnooze(currentDomain);
  updateSnoozeUI();
  reportBtn.style.display = "";

  // Ask the content script whether UI is currently hidden
  if (activeTabId != null) {
    try {
      const response = await chrome.tabs.sendMessage(activeTabId, { type: "FLORA_GET_STATE" });
      if (response?.hidden) {
        hidden = true;
        updateHideUI();
      }
    } catch (err) {
      // Expected on pages ORE doesn't run on; only useful when chasing a report.
      debugWarn("Popup: no content script on this tab —", err);
    }
  }
}

async function tearDownFloraOnPage(): Promise<boolean> {
  if (activeTabId == null) return false;
  try {
    await chrome.tabs.sendMessage(activeTabId, { type: "FLORA_HIDE_UI" });
    return true;
  } catch (err) {
    debugWarn("Popup: could not clear ORE from the page —", err);
    return false;
  }
}

// Block / unblock the current domain
blockBtn.addEventListener("click", async () => {
  if (!currentDomain) return;

  const domains = await getBlockedDomains();

  if (blocked) {
    const updated = domains.filter((d) => d !== currentDomain);
    await saveBlockedDomains(updated);
    blocked = false;
    showStatus(`Unblocked ${currentDomain} — reload to apply`, "success");
  } else {
    if (!domains.includes(currentDomain)) {
      domains.push(currentDomain);
      await saveBlockedDomains(domains);
    }
    blocked = true;
    const cleared = await tearDownFloraOnPage();
    if (cleared) {
      hidden = true;
      updateHideUI();
    }
    showStatus(
      cleared ? `Blocked ${currentDomain}` : `Blocked ${currentDomain} — reload to apply`,
      "success"
    );
  }

  updateBlockUI();
});

// End a temporary pause on the current domain
resumeBtn.addEventListener("click", async () => {
  if (!currentDomain) return;

  await clearSnooze(currentDomain);
  snoozedUntil = null;
  updateSnoozeUI();
  showStatus(`Resumed on ${currentDomain} — reload to apply`, "success");
});

// Toggle FLoRA UI visibility on the current page (session only)
hideBtn.addEventListener("click", async () => {
  if (activeTabId == null) return;

  const messageType = hidden ? "FLORA_SHOW_UI" : "FLORA_HIDE_UI";

  try {
    await chrome.tabs.sendMessage(activeTabId, { type: messageType });
    hidden = !hidden;
    updateHideUI();
    showStatus(hidden ? "Hidden until page refresh" : "ORE restored", "success");
  } catch (err) {
    debugWarn("Popup: hide/show message failed —", err);
    showStatus("Nothing from ORE on this page", "error");
  }
});

// Toggle debug logging
debugToggle.addEventListener("change", () => {
  debugOn = debugToggle.checked;
  setDebug(debugOn);
  updateDebugUI();
  showStatus(
    debugOn ? "Debug mode on — reload the page to record it" : "Debug mode off",
    "success"
  );
});

// Keep a one-line "Copy log" toast up after each pass (debug mode only)
logCopyToggle.addEventListener("change", () => {
  void saveSettings({ offerLogCopyAfterPass: logCopyToggle.checked });
});

// Report an issue on the current domain. With debug mode on the report is
// parked in the service worker, and the content script on the issue form fills
// it into the body — the log can't ride in the URL, GitHub rejects issue links
// that long. It also goes to the clipboard so a failed autofill is still one
// paste away rather than a dead end.
reportBtn.addEventListener("click", async () => {
  if (!currentDomain) return;

  let attached = false;
  let link = issueUrl({ domain: currentDomain });

  if (debugOn) {
    try {
      const { text, data } = await buildDebugReport({ pageUrl: currentDomain });
      link = issueUrl({ domain: currentDomain, report: data });
      // Park the full log even when the URL already carries a trimmed one: the
      // issue form upgrades it in place if it can.
      const stashed = await stashIssueReport(text);
      attached = link.embedded || stashed;
      await navigator.clipboard.writeText(text).catch(() => {});
    } catch (err) {
      debugError("Popup: building the debug report failed —", err);
    }
  }

  chrome.tabs.create({ url: link.url });

  if (debugOn && !attached) {
    showStatus("Couldn't attach the log — grab it from Settings", "error");
    return;
  }
  window.close();
});

// Open walkthrough
tourBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dist/walkthrough.html") });
  window.close();
});

// Open settings page
optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

init().catch((err) => {
  debugError("Popup: init failed —", err);
  domainEl.textContent = "Couldn't read this tab";
  showStatus("ORE couldn't start — see Settings to report it", "error");
});
