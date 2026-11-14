import { effectiveCacheQuotaMb, getSettings, MIN_CACHE_QUOTA_MB, saveSettings } from "../shared/settings";
import { getBlockedDomains, saveBlockedDomains } from "../shared/domains";
import { mountSiteCategoryPicker } from "../shared/site-category-picker";
import { safeSendMessage, type ReferenceDataResponse, type ReferenceDataSetStatus, type ReferenceDataStatus } from "../shared/messages";
import { CITATION_FORMATS, citationFormat, fetchCitation } from "../shared/citation";
import {
  getHiddenCommenters,
  isHiddenCommenter,
  saveHiddenCommenters,
} from "../shared/pubpeer-filter";
import { debugError, isDebugEnabledAsync, isTestingBuild, setDebug } from "../shared/debug";
import { clearDebugLog } from "../shared/debug-log";
import {
  buildDebugReport,
  debugReportFilename,
  issueUrl,
  stashIssueReport,
  type DebugReportData,
} from "../shared/debug-report";
import {
  initI18n,
  localizeDocument,
  LOCALE_NAMES,
  resolveLocale,
  SUPPORTED_LOCALES,
  t,
  uiLocale,
  type LanguagePreference,
} from "../shared/i18n";

void main();

async function main(): Promise<void> {
  await initI18n();
  localizeDocument();

  document.getElementById("testing-banner")!.hidden = !isTestingBuild();

  // ── Email form ──────────────────────────────────────────────────────

  const form = document.getElementById("settings-form") as HTMLFormElement;
  const emailInput = document.getElementById("email-input") as HTMLInputElement;
  const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
  const statusMsg = document.getElementById("status-msg") as HTMLParagraphElement;

  getSettings().then(({ email }) => {
    emailInput.value = email;
    if (email) saveBtn.textContent = t("settings.email.saveShort", "Save");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();

    saveBtn.disabled = true;
    try {
      await saveSettings({ email });
      statusMsg.textContent =
        email
          ? t("settings.email.saved", "Email saved. Reload open tabs to use it for lookups.")
          : t("settings.email.removed", "Email removed. Reload open tabs. Title matching and open-access lookups need an email; other checks still work.");
      statusMsg.className = "status success";
      statusMsg.hidden = false;
      saveBtn.textContent = email ? t("settings.email.saveShort", "Save") : t("settings.email.save", "Save contact email");
    } catch (err) {
      debugError("Settings: save failed —", err);
      statusMsg.textContent = t("settings.saveFailed", "Failed to save — please try again.");
      statusMsg.className = "status error";
      statusMsg.hidden = false;
    } finally {
      saveBtn.disabled = false;
    }
  });

  // ── Language ────────────────────────────────────────────────────────

  const languageSelect = document.getElementById("language-select") as HTMLSelectElement;

  function browserUiLanguage(): string {
    try {
      return chrome.i18n.getUILanguage();
    } catch {
      return navigator.language;
    }
  }

  languageSelect.add(new Option(
    // i18n: {name} is the language the browser setting resolves to, in its own name (e.g. "Deutsch").
    t("settings.language.auto", "Browser default ({name})", { name: LOCALE_NAMES[resolveLocale("auto", browserUiLanguage())] }),
    "auto"
  ));
  for (const locale of SUPPORTED_LOCALES) languageSelect.add(new Option(LOCALE_NAMES[locale], locale));

  getSettings().then(({ language }) => {
    languageSelect.value = language;
  });

  languageSelect.addEventListener("change", async () => {
    const language = languageSelect.value as LanguagePreference;
    try {
      await saveSettings({ language });
    } catch (err) {
      debugError("Settings: language save failed —", err);
      languageSelect.value = (await getSettings()).language;
      alert(t("settings.language.saveFailed", "Couldn't save the language. Try again."));
      return;
    }
    // Re-render the whole page in the new language.
    location.reload();
  });

  // ── Citation style ──────────────────────────────────────────────────

  const citationStyleSelect = document.getElementById("citation-style-select") as HTMLSelectElement;
  const citationPreview = document.getElementById("citation-style-preview") as HTMLParagraphElement;

  // Ioannidis (2005) — a stable, widely-known record to render the sample from.
  const SAMPLE_DOI = "10.1371/journal.pmed.0020124";

  for (const format of CITATION_FORMATS) {
    const option = document.createElement("option");
    option.value = format.id;
    option.textContent = format.label;
    citationStyleSelect.appendChild(option);
  }

  let sampleToken = 0;

  async function showCitationSample(formatId: string): Promise<void> {
    const token = ++sampleToken;
    citationPreview.className = "citation-sample";
    citationPreview.textContent = t("settings.citation.rendering", "Rendering a sample…");
    citationPreview.hidden = false;
    const sample = await fetchCitation(SAMPLE_DOI, formatId);
    if (token !== sampleToken) return;
    if (!sample) {
      citationPreview.textContent = t("settings.citation.unavailable", "Sample unavailable — Crossref could not be reached.");
      citationPreview.className = "citation-sample error";
      return;
    }
    // tidyCitationHtml allows only bare <i>/<em>/<b>/<strong>/<sub>/<sup>.
    if (sample.html) citationPreview.innerHTML = sample.html;
    else citationPreview.textContent = sample.text;
  }

  getSettings().then(({ citationStyle }) => {
    citationStyleSelect.value = citationFormat(citationStyle).id;
    void showCitationSample(citationStyleSelect.value);
  });

  citationStyleSelect.addEventListener("change", async () => {
    const citationStyle = citationFormat(citationStyleSelect.value).id;
    await saveSettings({ citationStyle });
    void showCitationSample(citationStyle);
  });

  // ── Cache storage quota ─────────────────────────────────────────────

  const cacheQuotaInput = document.getElementById("cache-quota-input") as HTMLInputElement;
  const cacheQuotaSaveBtn = document.getElementById("cache-quota-save-btn") as HTMLButtonElement;
  const cacheQuotaStatus = document.getElementById("cache-quota-status") as HTMLParagraphElement;

  getSettings().then(({ cacheQuotaMb }) => {
    // Show the floored value, so the displayed limit matches the enforced one.
    cacheQuotaInput.value = String(effectiveCacheQuotaMb(cacheQuotaMb));
  });

  cacheQuotaSaveBtn.addEventListener("click", async () => {
    const raw = parseInt(cacheQuotaInput.value, 10);
    const cacheQuotaMb = effectiveCacheQuotaMb(isNaN(raw) || raw < 0 ? 50 : raw);
    cacheQuotaInput.value = String(cacheQuotaMb);
    cacheQuotaSaveBtn.disabled = true;
    try {
      await saveSettings({ cacheQuotaMb });
      cacheQuotaStatus.textContent = cacheQuotaMb === 0
        ? t("settings.cache.unlimited", "Storage limit removed — cache is unlimited.")
        : cacheQuotaMb === MIN_CACHE_QUOTA_MB
          ? t("settings.cache.setMinimum", "Storage limit set to {mb} MB (the minimum).", { mb: MIN_CACHE_QUOTA_MB })
          : t("settings.cache.set", "Storage limit set to {mb} MB.", { mb: cacheQuotaMb });
      cacheQuotaStatus.className = "status domain-status success";
      cacheQuotaStatus.hidden = false;
      setTimeout(() => { cacheQuotaStatus.hidden = true; }, 3000);
    } catch (err) {
      debugError("Settings: cache quota save failed —", err);
      cacheQuotaStatus.textContent = t("settings.saveFailed", "Failed to save — please try again.");
      cacheQuotaStatus.className = "status domain-status error";
      cacheQuotaStatus.hidden = false;
    } finally {
      cacheQuotaSaveBtn.disabled = false;
    }
  });

  // ── Reference data ──────────────────────────────────────────────────

  const dataRetractions = document.getElementById("data-retractions")!;
  const dataRegisteredReports = document.getElementById("data-registered-reports")!;
  const dataRefreshBtn = document.getElementById("data-refresh-btn") as HTMLButtonElement;
  const dataRefreshLabel = document.getElementById("data-refresh-label")!;
  const dataStartupToggle = document.getElementById("data-startup-toggle") as HTMLInputElement;
  const dataStatusMsg = document.getElementById("data-status-msg") as HTMLParagraphElement;

  function describeDataSet(set: ReferenceDataSetStatus): string {
    // i18n: number of records in a reference list (retractions or Registered Reports).
    const entries = t("settings.data.entries", "{count, plural, one {# entry} other {# entries}}", { count: set.count });
    // i18n: shown after the entry count; the list shipped with the extension and has not been refreshed.
    if (set.updatedAt === null) return `${entries} · ${t("settings.data.bundled", "bundled with ORE")}`;
    const date = new Date(set.updatedAt).toLocaleString(uiLocale(), { dateStyle: "medium", timeStyle: "short" });
    // i18n: shown after the entry count; {date} is when the list was last downloaded.
    return `${entries} · ${t("settings.data.updated", "updated {date}", { date })}`;
  }

  function showReferenceData(status: ReferenceDataStatus): void {
    dataRetractions.textContent = describeDataSet(status.retractions);
    dataRegisteredReports.textContent = describeDataSet(status.registeredReports);
  }

  function showDataStatus(msg: string, type: "success" | "error"): void {
    dataStatusMsg.textContent = msg;
    dataStatusMsg.className = `status domain-status ${type}`;
    dataStatusMsg.hidden = false;
    setTimeout(() => {
      dataStatusMsg.hidden = true;
    }, 5000);
  }

  function refreshFailedMessage(failed: (keyof ReferenceDataStatus)[]): string {
    if (failed.length > 1) {
      return t("settings.data.failedBoth", "Couldn't download retractions or Registered Reports — the previous copy is still in use.");
    }
    return failed[0] === "retractions"
      ? t("settings.data.failedRetractions", "Couldn't download retractions — the previous copy is still in use.")
      : t("settings.data.failedRegisteredReports", "Couldn't download Registered Reports — the previous copy is still in use.");
  }

  safeSendMessage<ReferenceDataResponse>({ type: "FLORA_DATA_STATUS" }).catch(() => undefined).then((response) => {
    if (response?.status) showReferenceData(response.status);
    else dataRetractions.textContent = dataRegisteredReports.textContent = t("settings.data.unavailable", "Unavailable");
  });

  getSettings().then(({ refreshDataOnStartup }) => {
    dataStartupToggle.checked = refreshDataOnStartup;
  });

  dataStartupToggle.addEventListener("change", async () => {
    const refreshDataOnStartup = dataStartupToggle.checked;
    try {
      await saveSettings({ refreshDataOnStartup });
    } catch (err) {
      debugError("Settings: startup refresh save failed —", err);
      dataStartupToggle.checked = !refreshDataOnStartup;
      showDataStatus(t("settings.saveFailed", "Failed to save — please try again."), "error");
      return;
    }
    showDataStatus(
      refreshDataOnStartup
        ? t("settings.data.startupOn", "Both lists will be downloaded each time the browser starts.")
        : t("settings.data.startupOff", "Both lists will be refreshed weekly."),
      "success"
    );
  });

  dataRefreshBtn.addEventListener("click", async () => {
    dataRefreshBtn.disabled = true;
    dataRefreshLabel.textContent = t("settings.data.refreshing", "Refreshing…");
    try {
      const response = await safeSendMessage<ReferenceDataResponse>({ type: "FLORA_REFRESH_DATA" }).catch(() => undefined);
      if (!response?.status) {
        showDataStatus(t("settings.data.workerUnreachable", "Couldn't reach ORE's background worker — try again."), "error");
        return;
      }
      showReferenceData(response.status);
      const failed = response.failed ?? [];
      showDataStatus(
        failed.length === 0
          ? t("settings.data.upToDate", "Retractions and Registered Reports are up to date.")
          : refreshFailedMessage(failed),
        failed.length === 0 ? "success" : "error"
      );
    } finally {
      dataRefreshBtn.disabled = false;
      dataRefreshLabel.textContent = t("settings.data.refresh", "Refresh now");
    }
  });

  // ── Site categories ─────────────────────────────────────────────────

  const siteStatusMsg = document.getElementById("site-status-msg") as HTMLParagraphElement;

  mountSiteCategoryPicker(document.getElementById("site-categories") as HTMLDivElement, (msg) => {
    siteStatusMsg.textContent = msg;
    siteStatusMsg.className = "status domain-status success";
    siteStatusMsg.hidden = false;
    setTimeout(() => {
      siteStatusMsg.hidden = true;
    }, 3000);
  });

  // ── Domain blocklist ────────────────────────────────────────────────

  const domainInput = document.getElementById("domain-input") as HTMLInputElement;
  const addDomainBtn = document.getElementById("add-domain-btn") as HTMLButtonElement;
  const domainList = document.getElementById("domain-list") as HTMLDivElement;
  const domainStatusMsg = document.getElementById("domain-status-msg") as HTMLParagraphElement;

  let blocked: string[] = [];

  function renderBlockedList(): void {
    domainList.innerHTML = "";

    if (blocked.length === 0) {
      const empty = document.createElement("div");
      empty.className = "domain-empty";
      empty.textContent = t("settings.blocklist.empty", "No sites blocked.");
      domainList.appendChild(empty);
      return;
    }

    const sorted = [...blocked].sort((a, b) => a.localeCompare(b));

    for (const domain of sorted) {
      const row = document.createElement("div");
      row.className = "domain-row";

      const label = document.createElement("span");
      label.className = "domain-name";
      label.textContent = domain;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "domain-remove";
      removeBtn.setAttribute("aria-label", t("settings.blocklist.unblock", "Unblock"));
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", () => unblockDomain(domain));

      row.appendChild(label);
      row.appendChild(removeBtn);
      domainList.appendChild(row);
    }
  }

  async function unblockDomain(domain: string): Promise<void> {
    blocked = blocked.filter((d) => d !== domain);
    await saveBlockedDomains(blocked);
    renderBlockedList();
    showDomainStatus(t("settings.blocklist.unblocked", "Unblocked {domain}", { domain }), "success");
  }

  async function blockDomain(): Promise<void> {
    const raw = domainInput.value.trim().toLowerCase();
    if (!raw) return;

    // Strip protocol & path
    const domain = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

    if (
      !domain ||
      !/^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)+$/.test(domain)
    ) {
      showDomainStatus(t("settings.blocklist.invalid", "Invalid domain format."), "error");
      return;
    }

    if (blocked.includes(domain)) {
      showDomainStatus(t("settings.blocklist.already", "{domain} is already blocked.", { domain }), "error");
      return;
    }

    blocked.push(domain);
    await saveBlockedDomains(blocked);
    domainInput.value = "";
    renderBlockedList();
    showDomainStatus(t("settings.blocklist.blocked", "Blocked {domain}", { domain }), "success");
  }

  function showDomainStatus(msg: string, type: "success" | "error"): void {
    domainStatusMsg.textContent = msg;
    domainStatusMsg.className = `status domain-status ${type}`;
    domainStatusMsg.hidden = false;
    setTimeout(() => {
      domainStatusMsg.hidden = true;
    }, 3000);
  }

  // Listeners
  addDomainBtn.addEventListener("click", blockDomain);
  domainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      blockDomain();
    }
  });

  // Init
  getBlockedDomains().then((b) => {
    blocked = b;
    renderBlockedList();
  });

  // ── Muted PubPeer commenters ────────────────────────────────────────

  const commenterInput = document.getElementById("commenter-input") as HTMLInputElement;
  const addCommenterBtn = document.getElementById("add-commenter-btn") as HTMLButtonElement;
  const commenterList = document.getElementById("commenter-list") as HTMLDivElement;
  const commenterStatusMsg = document.getElementById("commenter-status-msg") as HTMLParagraphElement;

  let mutedCommenters: string[] = [];

  function renderCommenterList(): void {
    commenterList.innerHTML = "";

    if (mutedCommenters.length === 0) {
      const empty = document.createElement("div");
      empty.className = "domain-empty";
      empty.textContent = t("settings.commenters.empty", "No commenters muted — all PubPeer comments are shown.");
      commenterList.appendChild(empty);
      return;
    }

    const sorted = [...mutedCommenters].sort((a, b) => a.localeCompare(b));

    for (const id of sorted) {
      const row = document.createElement("div");
      row.className = "domain-row";

      const label = document.createElement("span");
      label.className = "domain-name";
      label.textContent = id;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "domain-remove";
      removeBtn.setAttribute("aria-label", t("settings.commenters.unmuteLabel", "Unmute {name}", { name: id }));
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", () => unmuteCommenter(id));

      row.appendChild(label);
      row.appendChild(removeBtn);
      commenterList.appendChild(row);
    }
  }

  async function unmuteCommenter(id: string): Promise<void> {
    mutedCommenters = mutedCommenters.filter((c) => c !== id);
    await saveHiddenCommenters(mutedCommenters);
    renderCommenterList();
    showCommenterStatus(t("settings.commenters.unmuted", "Unmuted {name}", { name: id }), "success");
  }

  async function muteCommenter(): Promise<void> {
    const id = commenterInput.value.trim();
    if (!id) return;

    if (isHiddenCommenter(id, mutedCommenters)) {
      showCommenterStatus(t("settings.commenters.already", "{name} is already muted.", { name: id }), "error");
      return;
    }

    mutedCommenters.push(id);
    await saveHiddenCommenters(mutedCommenters);
    commenterInput.value = "";
    renderCommenterList();
    showCommenterStatus(t("settings.commenters.muted", "Muted {name}", { name: id }), "success");
  }

  function showCommenterStatus(msg: string, type: "success" | "error"): void {
    commenterStatusMsg.textContent = msg;
    commenterStatusMsg.className = `status domain-status ${type}`;
    commenterStatusMsg.hidden = false;
    setTimeout(() => {
      commenterStatusMsg.hidden = true;
    }, 3000);
  }

  addCommenterBtn.addEventListener("click", muteCommenter);
  commenterInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      muteCommenter();
    }
  });

  getHiddenCommenters().then((ids) => {
    mutedCommenters = ids;
    renderCommenterList();
  });

  // ── Debug mode & issue reports ──────────────────────────────────────

  const debugToggle = document.getElementById("debug-toggle") as HTMLInputElement;
  const debugPreview = document.getElementById("debug-preview") as HTMLPreElement;
  const debugStatus = document.getElementById("debug-status") as HTMLParagraphElement;
  const debugReportBtn = document.getElementById("debug-report-btn") as HTMLButtonElement;
  const debugCopyBtn = document.getElementById("debug-copy-btn") as HTMLButtonElement;
  const debugDownloadBtn = document.getElementById("debug-download-btn") as HTMLButtonElement;
  const debugRefreshBtn = document.getElementById("debug-refresh-btn") as HTMLButtonElement;
  const debugClearBtn = document.getElementById("debug-clear-btn") as HTMLButtonElement;

  /** Latest rendered report — what the copy/download/issue buttons act on. */
  let debugReport = "";

  function showDebugStatus(msg: string, type: "success" | "error"): void {
    debugStatus.textContent = msg;
    debugStatus.className = `status domain-status ${type}`;
    debugStatus.hidden = false;
    setTimeout(() => {
      debugStatus.hidden = true;
    }, 4000);
  }

  async function refreshDebugReport(): Promise<DebugReportData> {
    const { text, entryCount, data } = await buildDebugReport();
    debugReport = text;
    debugPreview.textContent = text;
    debugPreview.classList.toggle("empty", entryCount === 0);
    return data;
  }

  async function copyDebugReport(): Promise<boolean> {
    await refreshDebugReport();
    try {
      await navigator.clipboard.writeText(debugReport);
      return true;
    } catch (err) {
      debugError("Settings: copying the debug report failed —", err);
      return false;
    }
  }

  isDebugEnabledAsync().then((enabled) => {
    debugToggle.checked = enabled;
  });
  void refreshDebugReport();

  debugToggle.addEventListener("change", () => {
    setDebug(debugToggle.checked);
    showDebugStatus(
      debugToggle.checked
        ? t("settings.debug.on", "Debug mode on — reload a page to see ORE's progress toast.")
        : t("settings.debug.off", "Debug mode off. Warnings and errors are still logged."),
      "success"
    );
  });

  debugRefreshBtn.addEventListener("click", () => {
    void refreshDebugReport().then(() => showDebugStatus(t("settings.debug.refreshed", "Report refreshed."), "success"));
  });

  debugCopyBtn.addEventListener("click", async () => {
    if (await copyDebugReport()) {
      showDebugStatus(t("settings.debug.copied", "Report copied to the clipboard."), "success");
    } else {
      showDebugStatus(
        t("settings.debug.copyFailed", "Couldn't reach the clipboard — select the report below and copy it manually."),
        "error"
      );
    }
  });

  debugDownloadBtn.addEventListener("click", async () => {
    await refreshDebugReport();
    const blob = new Blob([debugReport], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = debugReportFilename();
    link.click();
    URL.revokeObjectURL(url);
    showDebugStatus(t("settings.debug.downloaded", "Report downloaded — attach the file to your issue."), "success");
  });

  debugReportBtn.addEventListener("click", async () => {
    const data = await refreshDebugReport();
    const link = issueUrl({ report: data });
    const stashed = await stashIssueReport(debugReport);
    // Clipboard as well: if GitHub ever reshapes its issue form, a paste still
    // beats sending the user back here to fetch the report by hand.
    await navigator.clipboard.writeText(debugReport).catch(() => {});

    chrome.tabs.create({ url: link.url });

    const attached = link.embedded || stashed;
    showDebugStatus(
      attached
        ? t("settings.debug.opening", "Opening a GitHub issue with the report filled in.")
        : t("settings.debug.attachFailed", "Couldn't attach the report — it's on your clipboard, paste it into the issue."),
      attached ? "success" : "error"
    );
  });

  debugClearBtn.addEventListener("click", async () => {
    await clearDebugLog();
    await refreshDebugReport();
    showDebugStatus(t("settings.debug.cleared", "Debug log cleared."), "success");
  });

  // A jump link to a collapsed card opens it.
  for (const link of document.querySelectorAll<HTMLAnchorElement>(".section-nav a")) {
    link.addEventListener("click", () => {
      const target = document.querySelector(link.hash);
      if (target instanceof HTMLDetailsElement) target.open = true;
    });
  }
}
