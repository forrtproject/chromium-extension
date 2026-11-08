// Per-pill Open Access and PubPeer lookups that failed on this page.
//
// Each pill runs its own lookups, so the page-level "unavailable" notice
// learns about their failures here and can retry them all at once. A lookup
// stays listed until it succeeds (or the page changes), so a retry that fails
// again keeps the notice up.

export type OutageSource = "oa" | "pubpeer";

const failed = new Map<object, Partial<Record<OutageSource, () => void>>>();
const listeners = new Set<() => void>();
// Bumped on every page change; a lookup started for an earlier page reports nothing.
let epoch = 0;

/** The current page's epoch, captured when a pill starts its lookups. */
export function outageEpoch(): number {
    return epoch;
}

function changed(): void {
    for (const listener of listeners) listener();
}

/** Record one lookup's outcome; `retry` set means it failed and how to run it again. */
export function noteOutage(owner: object, source: OutageSource, retry: (() => void) | null, startedIn = epoch): void {
    if (startedIn !== epoch) return;
    const entry = failed.get(owner) ?? {};
    if (!retry === !entry[source]) {
        if (retry) entry[source] = retry;
        return;
    }
    if (retry) entry[source] = retry;
    else delete entry[source];
    if (Object.keys(entry).length > 0) failed.set(owner, entry);
    else failed.delete(owner);
    changed();
}

export function outageSources(): Set<OutageSource> {
    const sources = new Set<OutageSource>();
    for (const entry of failed.values()) {
        for (const source of Object.keys(entry) as OutageSource[]) sources.add(source);
    }
    return sources;
}

export function retryOutages(): void {
    for (const entry of [...failed.values()]) {
        for (const retry of Object.values(entry)) retry?.();
    }
}

/** Forget every failure, e.g. when the page changes and its pills go. */
export function clearOutages(): void {
    epoch++;
    if (failed.size === 0) return;
    failed.clear();
    changed();
}

export function onOutagesChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
