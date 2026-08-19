// A deadline for the id → DOI resolvers. Their callers hold the work toast open
// until every batch answers, so a request that never returns would leave the
// pass — and the toast — running for as long as the page is open. A timed-out
// call rejects into the resolver's own catch, which is the path a failed batch
// already takes: the pipeline falls back to a title search for those rows.

/** How long an id-resolution request may take before it is abandoned. */
export const RESOLVE_TIMEOUT_MS = 15_000;

/**
 * Reject with `${label} timed out` when `work` has not settled within `ms`.
 * The request itself is left to finish in the background; nothing waits on it.
 */
export function withResolveTimeout<T>(work: Promise<T>, label: string, ms: number = RESOLVE_TIMEOUT_MS): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    });
    return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}
