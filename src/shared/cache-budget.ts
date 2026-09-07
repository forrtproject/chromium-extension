import {debugWarn} from "./debug";
import {effectiveCacheQuotaMb, getSettings} from "./settings";
import {RET_MAP_KEY} from "./data-extract";

// Only disposable provider data belongs to this budget. Preferences, the
// debug log, pending reports and the retraction map must never be evicted to
// make room for it — the map is bounded, refreshed weekly and always needed.
const BLOB_KEYS = new Set([
  "flora_oa_blob", "flora_pubpeer_blob", "flora_doival_blob", "flora_doi_blob",
  "flora_title_blob", "flora_pmc_blob", "flora_citation_blob",
]);
export function isProviderCacheKey(key: string): boolean {
  return ["flora:", "flora_doi:", "flora_title:", "flora_pubpeer:", "flora_doival:"].some(prefix => key.startsWith(prefix)) || BLOB_KEYS.has(key);
}

function writtenAt(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  if (typeof record.createdAt === "number") return record.createdAt;
  // Blobs are evicted as a unit so a sweep never writes a stale snapshot over
  // a concurrent cache update. An eviction can cause a refetch, not data loss.
  const timestamps = Object.values(record).map(v =>
    v && typeof v === "object" ? (v as {t?: unknown}).t : undefined,
  ).filter((t): t is number => typeof t === "number");
  return timestamps.length ? Math.max(...timestamps) : 0;
}

/** Enforce the shared soft budget with batched storage reads/removals. */
export async function enforceCacheBudget(bytes: number): Promise<void> {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  // Cheap upper bound first: everything except the retraction map, which is the
  // one large key outside the budget. Only an over-budget sweep pays for
  // deserialising the stored values.
  const [total, mapBytes] = await Promise.all([
    chrome.storage.local.getBytesInUse(null),
    chrome.storage.local.getBytesInUse(RET_MAP_KEY),
  ]);
  if (total - mapBytes <= bytes) return;
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(isProviderCacheKey);
  if (!keys.length) return;
  let used = await chrome.storage.local.getBytesInUse(keys);
  if (used <= bytes) return;
  const now = Date.now();
  const expired = (key: string) => {
    const entry = all[key] as {expiresAt?: number | null} | undefined;
    return typeof entry?.expiresAt === "number" && entry.expiresAt <= now;
  };
  const ordered = keys.sort((a, b) => Number(expired(b)) - Number(expired(a)) || writtenAt(all[a]) - writtenAt(all[b]));
  const encoder = new TextEncoder();
  let cursor = 0;
  while (used > bytes && cursor < ordered.length) {
    const remove: string[] = [];
    let estimatedFreed = 0;
    const target = used - bytes * 0.9; // headroom for the next batch of writes
    while (cursor < ordered.length && estimatedFreed < target) {
      const key = ordered[cursor++];
      remove.push(key);
      estimatedFreed += encoder.encode(key + JSON.stringify(all[key])).length;
    }
    await chrome.storage.local.remove(remove);
    // Check the actual storage accounting, rather than relying on estimates.
    used = cursor < ordered.length ? await chrome.storage.local.getBytesInUse(ordered.slice(cursor)) : 0;
  }
}

/** Install only in the service worker: one sweep owner for every provider. */
export function installCacheBudget(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void getSettings().then(settings => enforceCacheBudget(effectiveCacheQuotaMb(settings.cacheQuotaMb) * 1024 * 1024))
        .catch(err => debugWarn("Provider cache budget: sweep failed —", err));
    }, 1000);
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    // Only new data can push usage over budget, so a sweep never reschedules
    // itself off its own removals.
    if ((area === "local" && Object.entries(changes).some(([key, change]) => isProviderCacheKey(key) && change.newValue !== undefined)) ||
        (area === "sync" && "flora_settings" in changes)) schedule();
  });
  schedule(); // covers a restart and a quota change made while asleep
}
