/**
 * Disabled-domain list for FLoRA.
 *
 * FLoRA runs on ALL sites by default.  Users can disable specific domains
 * from the options page.  A disabled domain prevents the content script
 * from scanning/injecting on that hostname (exact match or subdomain).
 */

const BLACKLIST_KEY = "flora_blocked_domains";
const SNOOZE_KEY = "flora_snoozed_domains";
import { debugError } from "./debug";
let cachedBlockedDomains: string[] | null = null;
let cachedSnoozes: Record<string, number> | null = null;
let domainListenerInstalled = false;

function installDomainInvalidation(): void {
  if (domainListenerInstalled) return;
  domainListenerInstalled = true;
  try {
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === "sync" && changes[BLACKLIST_KEY]) {
        cachedBlockedDomains = (changes[BLACKLIST_KEY].newValue as string[] | undefined) ?? [];
      }
      if (area === "local" && changes[SNOOZE_KEY]) {
        cachedSnoozes = (changes[SNOOZE_KEY].newValue as Record<string, number> | undefined) ?? {};
      }
    });
  } catch {
    // Storage change events are unavailable in tests and some non-extension contexts.
  }
}

/** Read the blocked-domain list from chrome.storage.sync. */
export async function getBlockedDomains(): Promise<string[]> {
  installDomainInvalidation();
  if (cachedBlockedDomains) return cachedBlockedDomains;
  try {
    const raw = await chrome.storage.sync.get(BLACKLIST_KEY);
    cachedBlockedDomains = (raw[BLACKLIST_KEY] as string[] | undefined) ?? [];
    return cachedBlockedDomains;
  } catch (err) {
    // Silently disables the whole blocklist, so it must be visible in a report.
    debugError("Blocked domains: read failed — every domain will be treated as allowed:", err);
    cachedBlockedDomains = [];
    return cachedBlockedDomains;
  }
}

/** Persist the blocked-domain list. */
export async function saveBlockedDomains(domains: string[]): Promise<void> {
  cachedBlockedDomains = domains;
  await chrome.storage.sync.set({ [BLACKLIST_KEY]: domains });
}

/**
 * Check whether a hostname is blocked.
 *
 * Returns `true` if `hostname` equals a blocked domain or is a
 * subdomain of one (e.g. blocking `example.com` also blocks
 * `sub.example.com`).
 */
export async function isDomainBlocked(hostname: string): Promise<boolean> {
  const blocked = await getBlockedDomains();
  const host = hostname.toLowerCase();

  for (const domain of blocked) {
    if (matchesDomain(host, domain)) return true;
  }
  return false;
}

/** Add a hostname to the blocked-domain list. */
export async function blockDomain(hostname: string): Promise<void> {
  const domains = await getBlockedDomains();
  if (domains.includes(hostname)) return;
  await saveBlockedDomains([...domains, hostname]);
}

/** `host` equals `domain` or is a subdomain of it. Both lower-case. */
function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Temporary per-site pause.
 *
 * Snoozes live in chrome.storage.local as hostname → expiry epoch (ms).  They
 * are deliberately device-local: a pause is about the session in front of the
 * user, not a preference worth syncing.
 */
async function getSnoozes(): Promise<Record<string, number>> {
  installDomainInvalidation();
  if (cachedSnoozes) return cachedSnoozes;
  try {
    const raw = await chrome.storage.local.get(SNOOZE_KEY);
    cachedSnoozes = (raw[SNOOZE_KEY] as Record<string, number> | undefined) ?? {};
  } catch (err) {
    debugError("Snoozed domains: read failed — no site will be treated as paused:", err);
    cachedSnoozes = {};
  }
  return cachedSnoozes;
}

async function saveSnoozes(snoozes: Record<string, number>): Promise<void> {
  cachedSnoozes = snoozes;
  await chrome.storage.local.set({ [SNOOZE_KEY]: snoozes });
}

/** Pause FLoRA on `hostname` for `durationMs`. Returns the expiry epoch (ms). */
export async function snoozeDomain(hostname: string, durationMs: number): Promise<number> {
  const until = Date.now() + durationMs;
  const snoozes = await getSnoozes();
  await saveSnoozes({ ...snoozes, [hostname.toLowerCase()]: until });
  return until;
}

/**
 * End the pause on `hostname`, dropping every entry that covers it (the host
 * itself and any snoozed parent domain) so a resume actually resumes.
 */
export async function clearSnooze(hostname: string): Promise<void> {
  const snoozes = await getSnoozes();
  const host = hostname.toLowerCase();
  const kept = Object.entries(snoozes).filter(([domain]) => !matchesDomain(host, domain));
  if (kept.length === Object.keys(snoozes).length) return;
  await saveSnoozes(Object.fromEntries(kept));
}

/**
 * Expiry epoch of the pause covering `hostname` — exact host or a snoozed
 * parent domain, whichever runs longest — or `null` when nothing covers it.
 * Expired entries are dropped from storage on the way past.
 */
export async function getSnooze(hostname: string): Promise<number | null> {
  const snoozes = await getSnoozes();
  const host = hostname.toLowerCase();
  const now = Date.now();

  let until: number | null = null;
  let expired = false;
  for (const [domain, expiry] of Object.entries(snoozes)) {
    if (expiry <= now) {
      expired = true;
      continue;
    }
    if (matchesDomain(host, domain) && (until === null || expiry > until)) until = expiry;
  }

  if (expired) {
    const live = Object.fromEntries(Object.entries(snoozes).filter(([, e]) => e > now));
    await saveSnoozes(live);
  }
  return until;
}

/** Whether FLoRA is paused on `hostname`. */
export async function isDomainSnoozed(hostname: string): Promise<boolean> {
  return (await getSnooze(hostname)) !== null;
}
