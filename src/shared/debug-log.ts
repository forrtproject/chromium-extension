/**
 * Persistent store for captured debug entries.
 *
 * The service worker is the only writer: content scripts, the popup and the
 * options page all funnel their batches through it (see debug.ts), so there is
 * no read-modify-write race on the storage key. Readers — the options page
 * building an issue report — read the key directly.
 */

import type { DebugLogEntry } from "./debug";
import { setDebugSink } from "./debug";

export const DEBUG_LOG_KEY = "flora_debug_log";

/**
 * Ring-buffer size. Roughly 250 KB at the 1 KB per-entry ceiling, which sits
 * comfortably inside the unlimitedStorage budget while still covering a long
 * reproduction session.
 */
export const MAX_LOG_ENTRIES = 800;

/** Debounce on persistence so a burst of entries costs one storage write. */
const PERSIST_DELAY_MS = 500;

let buffer: DebugLogEntry[] | null = null;
let loading: Promise<DebugLogEntry[]> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function readStored(): Promise<DebugLogEntry[]> {
  return chrome.storage.local
    .get(DEBUG_LOG_KEY)
    .then((raw) => {
      const stored = raw?.[DEBUG_LOG_KEY];
      return Array.isArray(stored) ? (stored as DebugLogEntry[]) : [];
    })
    .catch(() => []);
}

async function load(): Promise<DebugLogEntry[]> {
  if (buffer) return buffer;
  // The worker can be restarted mid-session, so the first append after a
  // wake-up has to pick the existing log back up rather than replace it.
  if (!loading) loading = readStored();
  const stored = await loading;
  loading = null;
  if (!buffer) buffer = stored;
  return buffer;
}

function cancelPersist(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

function schedulePersist(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const snapshot = buffer ?? [];
    chrome.storage.local.set({ [DEBUG_LOG_KEY]: snapshot }).catch(() => {
      // Storage full or unavailable — the in-memory log still stands.
    });
  }, PERSIST_DELAY_MS);
}

/** Append a batch of entries, trimming the oldest once the cap is reached. */
export async function appendDebugEntries(entries: DebugLogEntry[]): Promise<void> {
  if (!Array.isArray(entries) || entries.length === 0) return;
  const log = await load();
  log.push(...entries);
  if (log.length > MAX_LOG_ENTRIES) log.splice(0, log.length - MAX_LOG_ENTRIES);
  schedulePersist();
}

/** Read the full captured log, oldest first. */
export async function readDebugLog(): Promise<DebugLogEntry[]> {
  if (buffer) return [...buffer];
  return readStored();
}

/** Drop every captured entry. */
export async function clearDebugLog(): Promise<void> {
  cancelPersist();
  buffer = [];
  await chrome.storage.local.set({ [DEBUG_LOG_KEY]: [] });
}

/**
 * Wire this context up as the log's owner: entries logged here are stored
 * directly, and entries arriving from other contexts land via
 * appendDebugEntries. Call once, from the service worker.
 */
export function installDebugLogStore(): void {
  setDebugSink((entries) => {
    void appendDebugEntries(entries);
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !(DEBUG_LOG_KEY in changes)) return;
      const next = changes[DEBUG_LOG_KEY].newValue;
      // Only an external clear empties the key; our own writes are non-empty.
      // Drop the pending write too, or a debounced flush would resurrect the
      // entries the user just cleared from the options page.
      if (!Array.isArray(next) || next.length === 0) {
        cancelPersist();
        buffer = [];
      }
    });
  } catch {
    // Storage change events are unavailable in tests and some contexts.
  }
}

/** Test-only: drop cached state so the next read hits storage again. */
export function _resetDebugLogForTesting(): void {
  cancelPersist();
  buffer = null;
  loading = null;
}
