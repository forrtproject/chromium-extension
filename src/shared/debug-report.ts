/**
 * Builds the diagnostic report a user attaches to a GitHub issue.
 *
 * The report is meant to be read by a stranger on a public issue tracker, so
 * it carries the extension/browser build, the settings that change behaviour,
 * and the captured log — but never the user's contact email, which is a
 * setting we hold only to put in the Crossref/OpenAlex polite pool.
 *
 * Getting it into the issue has two routes. Preferred is GitHub's own `?body=`
 * prefill, which is a documented, stable interface — but a URL can only carry
 * so much, so that path trims the log to its most recent entries. The full log
 * is handed to the issue-form content script, which swaps it in once the page
 * loads. Either way something useful lands in the issue: the DOM-dependent step
 * only ever upgrades a trimmed log to a complete one.
 */

import { redactDebugText } from "./debug-redact";
import { isDetailedLogging, isFullLogBuild, recentDebugEntries, type DebugLogEntry, type RuntimeErrorInfo } from "./debug";
import { readDebugLog, withinLogAge } from "./debug-log";
import { safeSendMessage } from "./messages";
import { effectiveCacheQuotaMb, getSettings } from "./settings";
import { getBlockedDomains, getDisabledSites } from "./domains";
import { getHiddenCommenters } from "./pubpeer-filter";

/**
 * GitHub caps an issue body at 65,536 characters. Keep the log well under that
 * so the surrounding template and the user's own description always fit.
 */
const MAX_REPORT_CHARS = 50_000;

/**
 * Ceiling for a prefilled issue link. GitHub answers 414 somewhere above 8 KB;
 * this leaves room to spare, since percent-encoding a log inflates it roughly
 * threefold and the exact threshold isn't contractual.
 */
const MAX_ISSUE_URL_CHARS = 6_000;

/** Below this many entries a trimmed log isn't worth the space it costs. */
const MIN_USEFUL_ENTRIES = 5;

const ISSUE_URL = "https://github.com/forrtproject/chromium-extension/issues/new";

export interface DebugReportContext {
  /** Page the user was on when they hit the problem, if known. */
  pageUrl?: string | null;
  error?: RuntimeErrorInfo | null;
  /** The page's own in-memory tail, which holds routine lines the stored log may not. */
  pageEntries?: DebugLogEntry[];
}

/** The stored log plus any in-memory lines it lacks, oldest first. */
function mergeEntries(stored: DebugLogEntry[], ...tails: DebugLogEntry[][]): DebugLogEntry[] {
  const keyOf = (entry: DebugLogEntry) => `${entry.t}|${entry.level}|${entry.ctx}|${entry.msg}`;
  const have = new Map<string, number>();
  for (const entry of stored) have.set(keyOf(entry), (have.get(keyOf(entry)) ?? 0) + 1);
  const extra: DebugLogEntry[] = [];
  for (const tail of tails) {
    const inTail = new Map<string, number>();
    for (const entry of tail) {
      const key = keyOf(entry);
      const count = (inTail.get(key) ?? 0) + 1;
      inTail.set(key, count);
      if (count <= (have.get(key) ?? 0)) continue;
      have.set(key, count);
      extra.push(entry);
    }
  }
  return extra.length === 0 ? stored : [...stored, ...extra].sort((a, b) => a.t - b.t);
}

/** The report's parts, kept separate so the log can be re-rendered shorter. */
export interface DebugReportData {
  environment: string[];
  settings: string[];
  entries: DebugLogEntry[];
  error?: RuntimeErrorInfo | null;
  /** Entries from pages other than the one being reported, left out of the log. */
  otherPageEntries?: number;
  /** The reported page's host: the only page context named in the log. */
  pageHost?: string | null;
}

const MAX_STACK_CHARS = 2_000;

// The endpoints ORE itself calls. Any other URL in a log line is a page the
// reader visited, so a report keeps only these.
const SERVICE_URLS = /^https:\/\/(?:(?:dx\.)?doi\.org\/|api\.crossref\.org\/|api\.openalex\.org\/|api\.semanticscholar\.org\/|api\.unpaywall\.org\/|pmc\.ncbi\.nlm\.nih\.gov\/tools\/idconv\/|pubpeer\.com\/v3\/|rep-api\.forrt\.org\/|raw\.githubusercontent\.com\/forrtproject\/chromium-extension\/|github\.com\/forrtproject\/chromium-extension\/|www\.zotero\.org\/groups\/5937153\/)/i;

function redactPageUrls(text: string, keepHost: string | null): string {
  return text.replace(/\bhttps?:\/\/[^\s"'<>()[\]]+/gi, (url) => {
    if (SERVICE_URLS.test(url)) return url;
    let host: string;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "[url]";
    }
    return keepHost !== null && host === keepHost ? url : "[url]";
  });
}

function redactError(error: RuntimeErrorInfo, keepHost: string | null): RuntimeErrorInfo {
  return {
    ...error,
    message: redactPageUrls(error.message, keepHost),
    ...(error.stack ? { stack: redactPageUrls(error.stack, keepHost) } : {}),
  };
}

/**
 * Name page contexts "page 1", "page 2", … in order of appearance, so a report
 * shows which lines came from the same tab without saying which sites were open.
 */
function anonymiseContexts(entries: DebugLogEntry[], keepHost: string | null): DebugLogEntry[] {
  const labels = new Map<string, string>();
  return entries.map((entry) => {
    const ctx = entry.ctx.replace(/^www\./, "");
    if (EXTENSION_CONTEXTS.has(ctx) || (keepHost !== null && ctx === keepHost)) return entry;
    if (/\.officeapps\.live\.com$/.test(ctx)) return { ...entry, ctx: "office frame" };
    let label = labels.get(ctx);
    if (!label) {
      label = `page ${labels.size + 1}`;
      labels.set(ctx, label);
    }
    return { ...entry, ctx: label };
  });
}

function collapseRepeats(entries: DebugLogEntry[]): Array<DebugLogEntry & { repeats: number }> {
  const out: Array<DebugLogEntry & { repeats: number }> = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (last && last.ctx === entry.ctx && last.level === entry.level && last.msg === entry.msg) {
      last.repeats++;
    } else {
      out.push({ ...entry, repeats: 1 });
    }
  }
  return out;
}

function errorSection(error: RuntimeErrorInfo): string[] {
  const lines = ["### Error", "", `**${error.message}**`, ""];
  if (error.where) lines.push(`Raised in: \`${error.where}\``, "");
  if (error.stack) {
    lines.push("```", error.stack.slice(0, MAX_STACK_CHARS), "```", "");
  }
  return lines;
}

function formatTimestamp(t: number): string {
  const d = new Date(t);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** One log line, e.g. `12:04:31.882  [example.com] ERROR  Lookup failed`. */
export function formatDebugEntry(entry: DebugLogEntry): string {
  const level = entry.level === "log" ? "INFO" : entry.level.toUpperCase();
  return `${formatTimestamp(entry.t)}  [${entry.ctx}] ${level.padEnd(5)}  ${entry.msg}`;
}

export function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version || "unknown";
  } catch {
    return "unknown";
  }
}

function extensionIdentity(): string {
  try {
    const manifest = chrome.runtime.getManifest();
    return `${manifest.name} ${manifest.version}`;
  } catch {
    return "unknown";
  }
}

function userAgent(): string {
  try {
    return navigator.userAgent;
  } catch {
    return "unknown";
  }
}

/**
 * Render the report body. `maxEntries` keeps only the newest entries — the
 * failure is almost always at the end of a session — and says so in the
 * heading, so a trimmed log is never mistaken for a complete one.
 */
export function renderDebugReport(
  data: DebugReportData,
  maxEntries?: number
): string {
  const total = data.entries.length;
  const shown =
    maxEntries == null || maxEntries >= total
      ? data.entries
      : data.entries.slice(total - Math.max(0, maxEntries));
  const omitted = total - shown.length;

  const heading =
    omitted > 0
      ? `### Debug log (most recent ${shown.length} of ${total} entries)`
      : `### Debug log (${total} ${total === 1 ? "entry" : "entries"})`;

  const others = data.otherPageEntries ?? 0;
  const otherNote = others > 0
    ? [`_Left out ${others} ${others === 1 ? "entry" : "entries"} from other pages._`, ""]
    : [];
  const keepHost = data.pageHost ?? null;
  const lines: string[] = [
    ...(data.error ? errorSection(redactError(data.error, keepHost)) : []),
    "### Environment",
    "",
    ...data.environment.map((line) => `- ${line}`),
    "",
    "### Settings",
    "",
    ...data.settings.map((line) => `- ${line}`),
    "",
    heading,
    "",
    ...otherNote,
  ];

  if (shown.length === 0) {
    lines.push(others > 0
      ? "_No entries from this page yet. Reload the page, reproduce the problem, then copy the report again._"
      : "_No entries captured yet. Reproduce the problem, then copy the report again._"
    );
    return redactDebugText(lines.join("\n"));
  }

  const rendered = collapseRepeats(anonymiseContexts(shown, keepHost)).map((entry) =>
    entry.repeats > 1 ? `${formatDebugEntry(entry)}  (×${entry.repeats})` : formatDebugEntry(entry));
  let body = redactPageUrls(redactDebugText(rendered.join("\n")), keepHost);
  if (omitted > 0) body = `… ${omitted} earlier entries trimmed …\n${body}`;
  if (body.length > MAX_REPORT_CHARS) {
    body = `… earlier entries trimmed …\n${body.slice(body.length - MAX_REPORT_CHARS)}`;
  }

  lines.push("```", body, "```");
  return redactDebugText(lines.join("\n"));
}

/** Gather the report's parts without rendering them. */
export async function collectDebugReport(
  context: DebugReportContext = {}
): Promise<DebugReportData> {
  const [stored, settings, blockedDomains, disabledSites, mutedCommenters] = await Promise.all([
    readDebugLog(),
    getSettings(),
    getBlockedDomains(),
    getDisabledSites(),
    getHiddenCommenters(),
  ]);

  const all = mergeEntries(stored, withinLogAge(recentDebugEntries()), withinLogAge(context.pageEntries ?? []));
  const { entries, otherPageEntries } = focusOnPage(all, context.pageUrl);
  const host = pageHost(context.pageUrl)?.replace(/^www\./, "") ?? null;

  const environment = [
    `Extension: ${extensionIdentity()}`,
    `User agent: ${userAgent()}`,
    `Report generated: ${new Date().toISOString()}`,
    `Detailed logging: ${isFullLogBuild() ? "on (testing build)" : isDetailedLogging() ? "on" : "off — warnings, errors and the page's recent lines only"}`,
  ];
  if (host) environment.push(`Page: ${host}`);

  const settingsLines = [
    // The address itself is never included — only whether one is configured,
    // which is what distinguishes "setup incomplete" from a real bug.
    `Contact email configured: ${settings.email.trim() ? "yes" : "no"}`,
    `Citation style: ${settings.citationStyle}`,
    `Cache limit: ${settings.cacheQuotaMb === 0 ? "unlimited" : `${effectiveCacheQuotaMb(settings.cacheQuotaMb)} MB`}`,
    `Blocked domains: ${blockedDomains.length}`,
    `Sites switched off by category: ${disabledSites.length}`,
    `Muted PubPeer commenters: ${mutedCommenters.length}`,
  ];

  return { environment, settings: settingsLines, entries, error: context.error ?? null, otherPageEntries, pageHost: host };
}

function pageHost(pageUrl: string | null | undefined): string | null {
  if (!pageUrl) return null;
  try {
    return new URL(pageUrl).hostname || null;
  } catch {
    return /^[a-z0-9.-]+$/i.test(pageUrl) ? pageUrl.toLowerCase() : null;
  }
}

const EXTENSION_CONTEXTS = new Set(["background", "popup", "options", "walkthrough", "extension"]);
const OFFICE_HOSTS =
  /(^|\.)(sharepoint\.com|onedrive\.live\.com|officeapps\.live\.com|office\.com|office\.live\.com|cloud\.microsoft|microsoft365\.com|teams\.microsoft\.com|teams\.live\.com)$/;

function focusOnPage(
  all: DebugLogEntry[],
  pageUrl: string | null | undefined,
): { entries: DebugLogEntry[]; otherPageEntries: number } {
  const host = pageHost(pageUrl)?.replace(/^www\./, "");
  if (!host) return { entries: all, otherPageEntries: 0 };
  const officePage = OFFICE_HOSTS.test(host);
  const belongs = (ctx: string): boolean =>
    ctx.replace(/^www\./, "") === host || EXTENSION_CONTEXTS.has(ctx)
    || (officePage && ctx.endsWith(".officeapps.live.com"));
  const entries = all.filter((entry) => belongs(entry.ctx));
  return { entries, otherPageEntries: all.length - entries.length };
}

/** Collect and render the full report the user can copy, save or attach. */
export async function buildDebugReport(
  context: DebugReportContext = {}
): Promise<{ text: string; entryCount: number; data: DebugReportData }> {
  const data = await collectDebugReport(context);
  return {
    text: renderDebugReport(data),
    entryCount: data.entries.length,
    data,
  };
}

/**
 * Park a report with the service worker for the issue form to claim. Returns
 * false when the worker didn't acknowledge, so the caller can fall back to
 * opening an issue that asks the user to paste it instead.
 */
export async function stashIssueReport(report: string, screenshot?: string): Promise<boolean> {
  const ack = await safeSendMessage<{ ok?: boolean }>({
    type: "FLORA_STASH_REPORT",
    report,
    ...(screenshot ? { screenshot } : {}),
  });
  return ack?.ok === true;
}

/** Filename for the downloadable copy of a report. */
export function debugReportFilename(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `forrt-ore-debug-${stamp}.md`;
}

// ── Issue body ──────────────────────────────────────────────────────────────

/**
 * Fences around the report inside an issue body. The issue-form content script
 * looks for these to replace a URL-trimmed log with the complete one; they are
 * HTML comments, so they stay invisible in the posted issue either way.
 */
export const REPORT_START = "<!-- ORE-DEBUG-REPORT:START -->";
export const REPORT_END = "<!-- ORE-DEBUG-REPORT:END -->";

/** Stands in for the report when it was too long to travel in the URL. */
export const REPORT_PLACEHOLDER = `${REPORT_START}\n_Attaching the debug log…_\n${REPORT_END}`;

const REPORT_BLOCK_PATTERN =
  /<!--\s*ORE-DEBUG-REPORT:START\s*-->[\s\S]*?<!--\s*ORE-DEBUG-REPORT:END\s*-->/;

function fenced(report: string): string {
  return `${REPORT_START}\n${report}\n${REPORT_END}`;
}

/**
 * Put the full report into an issue body, replacing a trimmed one if the URL
 * already carried it. Returns null when there is nothing to do, so a re-render
 * of the form can't append a second copy.
 */
export function insertReportIntoIssueBody(
  body: string,
  report: string
): string | null {
  const block = fenced(report);
  if (body.includes(block)) return null;
  // Function replacement: a `$&` inside a captured log line must stay literal.
  if (REPORT_BLOCK_PATTERN.test(body)) return body.replace(REPORT_BLOCK_PATTERN, () => block);
  // The fence is gone (the user edited it away, or GitHub applied its own
  // template) — append rather than lose the report.
  return `${body.trimEnd()}\n\n${block}\n`;
}

const MAX_TITLE_CHARS = 80;

function issueTitle(domain: string | null | undefined, error?: RuntimeErrorInfo | null): string {
  if (error) {
    const summary = error.message.replace(/\s+/g, " ").trim();
    const named = /^[A-Za-z]*(?:Error|Exception):/.test(summary) ? summary : `Error: ${summary}`;
    return named.length > MAX_TITLE_CHARS ? `${named.slice(0, MAX_TITLE_CHARS)}…` : named;
  }
  return domain ? `Issue on domain: ${domain}` : "Issue report";
}

function issueBody(
  domain: string | null | undefined,
  reportSection: string,
  error?: RuntimeErrorInfo | null
): string {
  return [
    ...(error
      ? [
        "**ORE hit an error.**",
        "",
        `\`${error.message}\`${error.where ? ` — in \`${error.where}\`` : ""}`,
        "",
      ]
      : []),
    "**What happened?**",
    "",
    "",
    "**What did you expect?**",
    "",
    "",
    ...(domain ? [`**Domain:** ${domain}`, ""] : []),
    `**Extension version:** ${extensionVersion()}`,
    "",
    "**Debug report**",
    "",
    reportSection,
    "",
  ].join("\n");
}

function linkFor(
  domain: string | null | undefined,
  reportSection: string,
  error?: RuntimeErrorInfo | null
): string {
  const params = new URLSearchParams({
    title: redactDebugText(issueTitle(domain, error)),
    body: redactDebugText(issueBody(domain, reportSection, error)),
    labels: error ? "bug" : domain ? "domain-issue" : "bug",
  });
  return `${ISSUE_URL}?${params.toString()}`;
}

export interface IssueLink {
  url: string;
  /** True when the log travelled in the URL and needs no help from the page. */
  embedded: boolean;
  /** Entries the URL had room for; 0 when none were embedded. */
  embeddedEntries: number;
}

/**
 * Build the prefilled new-issue link. Fits as much of the log into the URL as
 * GitHub will accept — newest entries first — so the issue is useful even if
 * the content script never gets to swap in the full log.
 */
export function issueUrl(options: {
  domain?: string | null;
  report?: DebugReportData | null;
  error?: RuntimeErrorInfo | null;
}): IssueLink {
  const { domain, report } = options;
  const rawError = options.error ?? report?.error ?? null;
  const keepHost = report?.pageHost ?? pageHost(domain)?.replace(/^www\./, "") ?? null;
  const error = rawError && redactError(rawError, keepHost);

  if (!report || report.entries.length === 0) {
    const hint = report
      ? REPORT_PLACEHOLDER
      : "<!-- Optional: reproduce the problem, then report it from the ORE toolbar menu — the log comes with it. -->";
    return { url: linkFor(domain, hint, error), embedded: false, embeddedEntries: 0 };
  }

  const data = error && !report.error ? { ...report, error } : report;

  const total = data.entries.length;
  const fits = (count: number): boolean =>
    linkFor(domain, fenced(renderDebugReport(data, count)), error).length <= MAX_ISSUE_URL_CHARS;

  // Binary search the entry count rather than slicing the rendered string:
  // trimming whole entries keeps the markdown (and its code fence) intact.
  let lo = 0;
  let hi = total;
  let best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best < Math.min(MIN_USEFUL_ENTRIES, total)) {
    // Not even a useful tail fits — leave it to the content script entirely.
    return { url: linkFor(domain, REPORT_PLACEHOLDER, error), embedded: false, embeddedEntries: 0 };
  }

  return {
    url: linkFor(domain, fenced(renderDebugReport(data, best)), error),
    embedded: true,
    embeddedEntries: best,
  };
}

export function isOwnRepoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /(^|\.)github\.com$/.test(parsed.hostname)
      && parsed.pathname.startsWith("/forrtproject/chromium-extension");
  } catch {
    return false;
  }
}

/** True when a URL is the new-issue form on the extension's own repository. */
export function isIssueFormUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "") === ISSUE_URL &&
      // The template chooser lives one level up and has no body field.
      !parsed.pathname.endsWith("/choose")
    );
  } catch {
    return false;
  }
}
