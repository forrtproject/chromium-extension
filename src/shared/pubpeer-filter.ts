// Commenters muted in the PubPeer panel, matched case-insensitively
// on their PubPeer display name.

import { debugWarn } from "./debug";

const HIDDEN_COMMENTERS_KEY = "flora_hidden_pubpeer_commenters";

export const DEFAULT_HIDDEN_COMMENTERS = ["FORRT"];

let cachedHiddenCommenters: string[] | null = null;
let listenerInstalled = false;

function installInvalidation(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  try {
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === "sync" && changes[HIDDEN_COMMENTERS_KEY]) {
        cachedHiddenCommenters =
          (changes[HIDDEN_COMMENTERS_KEY].newValue as string[] | undefined) ??
          [...DEFAULT_HIDDEN_COMMENTERS];
      }
    });
  } catch {
    // Storage change events are unavailable in tests and some non-extension contexts.
  }
}

/** Read the hidden-commenter list from chrome.storage.sync. */
export async function getHiddenCommenters(): Promise<string[]> {
  installInvalidation();
  if (cachedHiddenCommenters) return cachedHiddenCommenters;
  try {
    const raw = await chrome.storage.sync.get(HIDDEN_COMMENTERS_KEY);
    const stored = raw[HIDDEN_COMMENTERS_KEY] as string[] | undefined;
    cachedHiddenCommenters = stored ?? [...DEFAULT_HIDDEN_COMMENTERS];
    return cachedHiddenCommenters;
  } catch (err) {
    debugWarn("Hidden commenters: read failed — falling back to defaults:", err);
    cachedHiddenCommenters = [...DEFAULT_HIDDEN_COMMENTERS];
    return cachedHiddenCommenters;
  }
}

/** Persist the hidden-commenter list. */
export async function saveHiddenCommenters(ids: string[]): Promise<void> {
  cachedHiddenCommenters = ids;
  await chrome.storage.sync.set({ [HIDDEN_COMMENTERS_KEY]: ids });
}

/** Subscribe to list changes. Returns an unsubscribe function. */
export function onHiddenCommentersChanged(fn: (ids: string[]) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ): void => {
    if (area !== "sync" || !changes[HIDDEN_COMMENTERS_KEY]) return;
    fn(
      (changes[HIDDEN_COMMENTERS_KEY].newValue as string[] | undefined) ??
        [...DEFAULT_HIDDEN_COMMENTERS]
    );
  };
  try {
    chrome.storage.onChanged?.addListener(listener);
  } catch {
    return () => {};
  }
  return () => {
    try {
      chrome.storage.onChanged?.removeListener(listener);
    } catch {
      // Nothing to detach.
    }
  };
}

/** Case-insensitive membership test against a hidden-commenter list. */
export function isHiddenCommenter(id: string, hidden: readonly string[]): boolean {
  const needle = id.trim().toLowerCase();
  if (!needle) return false;
  return hidden.some((h) => h.trim().toLowerCase() === needle);
}
