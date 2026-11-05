import {
  getBlockedDomains,
  saveBlockedDomains,
  isDomainBlocked,
  getSnooze,
  clearSnooze,
  snoozeDomain,
} from "../shared/domains";
import {SNOOZE_CHOICES, formatSnoozeEnd} from "../shared/snooze-durations";
import { debugError, debugWarn, isDebugEnabledAsync, isTestingBuild, setDebug, type DebugLogEntry } from "../shared/debug";
import { buildDebugReport, issueUrl, stashIssueReport } from "../shared/debug-report";
import { getSettings, saveSettings } from "../shared/settings";
import { openTourSample } from "../shared/tour-sample";

const TOUR_CHECKING_DELAY_MS = 300;

const TOUR_HELP = {
  checking: {
    title: "Still checking this page",
    text: "The tour starts as soon as ORE has finished.",
  },
  "no-pills": {
    title: "Nothing to show on this page",
    text: "The tour points out ORE's pills, and there aren't any here. Try it on a sample article instead? It opens in a new tab.",
  },
  "not-running": {
    title: "ORE isn't running on this tab",
    text: "This usually means the tab was open before ORE was installed or updated. Reload the page to start ORE, or try the tour on a sample article.",
  },
  unavailable: {
    title: "ORE can't run on this page",
    text: "Browsers keep extensions off their own pages. Try the tour on a sample article instead? It opens in a new tab.",
  },
  paused: {
    title: "ORE is off on this page",
    text: "It's hidden, snoozed or disabled here, so there are no pills to point out. Turn it back on above, or try the tour on a sample article.",
  },
} as const;

const domainEl = document.getElementById("current-domain")!;
const blockBtn = document.getElementById("block-btn")!;
const blockLabel = document.getElementById("block-btn-label")!;
const snoozeNote = document.getElementById("snooze-note")!;
const resumeBtn = document.getElementById("resume-btn")!;
const snoozeBtn = document.getElementById("snooze-btn")!;
const snoozeOptions = document.getElementById("snooze-options")!;
const hideBtn = document.getElementById("hide-btn")!;
const hideLabel = document.getElementById("hide-btn-label")!;
const pageTourBtn = document.getElementById("page-tour-btn")!;
const tourBtn = document.getElementById("tour-btn")!;
const optionsBtn = document.getElementById("options-btn")!;
const reportBtn = document.getElementById("report-btn")!;
const debugToggle = document.getElementById("debug-toggle") as HTMLInputElement;
const debugHint = document.getElementById("debug-hint")!;
const logCopyRow = document.getElementById("log-copy-row")!;
const logCopyToggle = document.getElementById("log-copy-toggle") as HTMLInputElement;
const screenshotRow = document.getElementById("screenshot-row")!;
const screenshotToggle = document.getElementById("screenshot-toggle") as HTMLInputElement;
const tourHelp = document.getElementById("tour-help")!;
const tourHelpTitle = document.getElementById("tour-help-title")!;
const tourHelpText = document.getElementById("tour-help-text")!;
const popupBody = document.querySelector<HTMLElement>(".popup-body")!;
const tourSampleBtn = document.getElementById("tour-sample-btn")!;
const tourReloadBtn = document.getElementById("tour-reload-btn")!;
const tourDismissBtn = document.getElementById("tour-dismiss-btn")!;
const statusEl = document.getElementById("popup-status")!;
const versionEl = document.getElementById("popup-version")!;

const extensionVersion = chrome.runtime.getManifest().version;
versionEl.textContent = `v${extensionVersion}`;
versionEl.title = `Extension version ${extensionVersion}`;
document.getElementById("testing-banner")!.hidden = !isTestingBuild();

let currentDomain = "";
let blocked = false;
let snoozedUntil: number | null = null;
let hidden = false;
let debugOn = false;
let activeTabId: number | undefined;
let activeWindowId: number | undefined;
let pendingTourStart: object | null = null;

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

function updateSnoozeUI(): void {
  const paused = snoozedUntil !== null;
  snoozeNote.hidden = !paused;
  resumeBtn.hidden = !paused;
  snoozeBtn.hidden = paused;
  if (paused) {
    snoozeNote.textContent = `Paused until ${formatSnoozeEnd(snoozedUntil!)}`;
    closeSnoozeOptions();
  }
}

function closeSnoozeOptions(): void {
  snoozeOptions.hidden = true;
  snoozeBtn.setAttribute("aria-expanded", "false");
}

function reportSnoozeState(until: number | null): void {
  if (activeTabId == null) return;
  try {
    chrome.runtime
      .sendMessage({type: "FLORA_ACTIVE_STATE", active: false, snoozedUntil: until, blocked, tabId: activeTabId})
      ?.catch(() => {});
  } catch {}
}

function buildSnoozeOptions(): void {
  for (const choice of SNOOZE_CHOICES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "popup-snooze-choice";
    button.textContent = choice.label;
    button.addEventListener("click", async () => {
      if (!currentDomain) return;
      snoozedUntil = await snoozeDomain(currentDomain, choice.durationMs());
      updateSnoozeUI();
      const cleared = await tearDownFloraOnPage();
      if (cleared) {
        hidden = true;
        updateHideUI();
      }
      reportSnoozeState(snoozedUntil);
      showStatus(`Snoozed until ${formatSnoozeEnd(snoozedUntil)}`, "success");
    });
    snoozeOptions.appendChild(button);
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
    ? "On. Reload the page to see ORE's progress and record a detailed log."
    : "Turn on to see ORE's progress on each page and send a detailed log with issue reports.";
  logCopyRow.hidden = !debugOn;
}

async function init(): Promise<void> {
  buildSnoozeOptions();
  debugOn = await isDebugEnabledAsync();
  const settings = await getSettings();
  logCopyToggle.checked = settings.offerLogCopyAfterPass;
  screenshotToggle.checked = settings.attachScreenshot;
  updateDebugUI();

  const requested = new URLSearchParams(location.search).get("tabId");
  const tab = requested && /^\d+$/.test(requested)
    ? await chrome.tabs.get(Number(requested)).catch(() => undefined)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.url) {
    domainEl.textContent = "No active page";
    snoozeBtn.style.display = "none";
    blockBtn.style.display = "none";
    hideBtn.style.display = "none";
    reportBtn.style.display = "none";
    return;
  }

  activeTabId = tab.id;
  activeWindowId = tab.windowId;

  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      domainEl.textContent = "Internal page";
      snoozeBtn.style.display = "none";
      blockBtn.style.display = "none";
      hideBtn.style.display = "none";
      reportBtn.style.display = "none";
      return;
    }
    currentDomain = url.hostname;
    domainEl.textContent = currentDomain;
  } catch {
    domainEl.textContent = "Internal page";
    snoozeBtn.style.display = "none";
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
  screenshotRow.hidden = false;

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
    blocked = await isDomainBlocked(currentDomain);
    reportSnoozeState(snoozedUntil);
    showStatus(blocked
        ? `${currentDomain} is still turned off by a blocked parent domain or site category — edit it in Settings`
        : `Unblocked ${currentDomain} — reload to apply`, blocked ? "error" : "success");
  } else {
    if (!domains.includes(currentDomain)) {
      domains.push(currentDomain);
      await saveBlockedDomains(domains);
    }
    blocked = true;
    reportSnoozeState(null);
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

snoozeBtn.addEventListener("click", () => {
  const open = !snoozeOptions.hidden;
  snoozeOptions.hidden = open;
  snoozeBtn.setAttribute("aria-expanded", String(!open));
});

// End a temporary pause on the current domain
resumeBtn.addEventListener("click", async () => {
  if (!currentDomain) return;

  await clearSnooze(currentDomain);
  snoozedUntil = null;
  updateSnoozeUI();
  reportSnoozeState(null);
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
    debugOn ? "Debug mode on — reload the page to see ORE's progress" : "Debug mode off",
    "success"
  );
});

screenshotToggle.addEventListener("change", () => {
  void saveSettings({ attachScreenshot: screenshotToggle.checked });
});

async function captureScreenshot(): Promise<string | undefined> {
  if (activeWindowId == null) return undefined;
  try {
    const [visible] = await chrome.tabs.query({ active: true, windowId: activeWindowId });
    if (visible?.id !== activeTabId) return undefined;
    return await chrome.tabs.captureVisibleTab(activeWindowId, { format: "png" });
  } catch (err) {
    debugWarn("Popup: screenshot capture failed —", err);
    return undefined;
  }
}

async function pageEntries(): Promise<DebugLogEntry[]> {
  if (activeTabId == null) return [];
  try {
    const reply = await chrome.tabs.sendMessage(activeTabId, { type: "FLORA_GET_RECENT_LOG" }) as { entries?: DebugLogEntry[] } | undefined;
    return Array.isArray(reply?.entries) ? reply.entries : [];
  } catch {
    return [];
  }
}

// Keep a one-line "Copy log" toast up after each pass (debug mode only)
logCopyToggle.addEventListener("change", () => {
  void saveSettings({ offerLogCopyAfterPass: logCopyToggle.checked });
});

// Report an issue on the current domain. The report is parked in the service
// worker, and the content script on the issue form fills it into the body — the
// log can't ride in the URL, GitHub rejects issue links that long. It also goes
// to the clipboard so a failed autofill is still one paste away.
reportBtn.addEventListener("click", async () => {
  if (!currentDomain) return;

  let attached = false;
  let link = issueUrl({ domain: currentDomain });

  try {
    const screenshot = screenshotToggle.checked ? await captureScreenshot() : undefined;
    const { text, data } = await buildDebugReport({ pageUrl: currentDomain, pageEntries: await pageEntries() });
    link = issueUrl({ domain: currentDomain, report: data });
    // Park the full log even when the URL already carries a trimmed one: the
    // issue form upgrades it in place if it can.
    const stashed = await stashIssueReport(text, screenshot);
    attached = link.embedded || stashed;
    await navigator.clipboard.writeText(text).catch(() => {});
  } catch (err) {
    debugError("Popup: building the debug report failed —", err);
  }

  chrome.tabs.create({ url: link.url });

  if (!attached) {
    showStatus("Couldn't attach the log — grab it from Settings", "error");
    return;
  }
  window.close();
});

function showTourHelp(kind: keyof typeof TOUR_HELP): void {
  tourHelpTitle.textContent = TOUR_HELP[kind].title;
  tourHelpText.textContent = TOUR_HELP[kind].text;
  tourSampleBtn.hidden = kind === "checking";
  tourReloadBtn.hidden = kind !== "not-running";
  tourHelp.hidden = false;
  popupBody.inert = true;
  (tourSampleBtn.hidden ? tourDismissBtn : tourSampleBtn).focus();
}

function closeTourHelp(): void {
  tourHelp.hidden = true;
  popupBody.inert = false;
  pageTourBtn.focus();
  if (pendingTourStart && activeTabId != null) {
    pendingTourStart = null;
    chrome.tabs.sendMessage(activeTabId, { type: "FLORA_CANCEL_PAGE_TOUR_START" }).catch(() => {});
  }
}

pageTourBtn.addEventListener("click", async () => {
  await ready;
  if (activeTabId == null || !currentDomain) {
    showTourHelp("unavailable");
    return;
  }
  const request = {};
  pendingTourStart = request;
  const checking = setTimeout(() => {
    if (pendingTourStart === request) showTourHelp("checking");
  }, TOUR_CHECKING_DELAY_MS);
  try {
    const response = await chrome.tabs.sendMessage(activeTabId, { type: "FLORA_START_PAGE_TOUR" }) as { started?: boolean } | undefined;
    if (pendingTourStart !== request) return;
    pendingTourStart = null;
    if (response?.started) {
      window.close();
      return;
    }
    showTourHelp(blocked || snoozedUntil !== null || hidden ? "paused" : "no-pills");
  } catch (err) {
    debugWarn("Popup: page tour message failed —", err);
    if (pendingTourStart !== request) return;
    pendingTourStart = null;
    showTourHelp("not-running");
  } finally {
    clearTimeout(checking);
  }
});

tourSampleBtn.addEventListener("click", async () => {
  try {
    await openTourSample();
    window.close();
  } catch (err) {
    debugError("Popup: could not open the sample article —", err);
    closeTourHelp();
    showStatus("Couldn't open the sample article", "error");
  }
});

tourReloadBtn.addEventListener("click", async () => {
  if (activeTabId != null) await chrome.tabs.reload(activeTabId);
  window.close();
});

tourDismissBtn.addEventListener("click", closeTourHelp);

tourHelp.addEventListener("click", (event) => {
  if (event.target === tourHelp) closeTourHelp();
});

tourHelp.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeTourHelp();
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

const ready = init().catch((err) => {
  debugError("Popup: init failed —", err);
  domainEl.textContent = "Couldn't read this tab";
  showStatus("ORE couldn't start — see Settings to report it", "error");
});
