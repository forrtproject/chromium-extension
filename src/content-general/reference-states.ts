import type {LookupResponse} from "@shared/messages";
import type {DoiString, LookupState} from "@shared/types";
import type {ResolvedReference} from "./references";

/**
 * Every reference resolved on the current page, one per DOI. Each pass of
 * resolveReferenceDois returns only the entries it newly handled, so the
 * page's reference set is the union of all passes. A DOI cited more than once
 * keeps every occurrence, and is listed while any of them is still in the DOM.
 */
export class ResolvedReferences {
    private byDoi = new Map<DoiString, ResolvedReference[]>();

    merge(refs: readonly ResolvedReference[]): ResolvedReference[] {
        for (const ref of refs) {
            const occurrences = this.byDoi.get(ref.doi) ?? [];
            if (!occurrences.some((o) => o.entry.element === ref.entry.element)) occurrences.push(ref);
            this.byDoi.set(ref.doi, occurrences);
        }
        return this.all();
    }

    /** The newest connected occurrence of each DOI; drops occurrences that left the DOM. */
    all(): ResolvedReference[] {
        const refs: ResolvedReference[] = [];
        for (const [doi, occurrences] of this.byDoi) {
            const connected = occurrences.filter((o) => o.entry.element.isConnected);
            if (connected.length === 0) this.byDoi.delete(doi);
            else {
                this.byDoi.set(doi, connected);
                refs.push(connected[connected.length - 1]);
            }
        }
        return refs;
    }

    clear(): void {
        this.byDoi.clear();
    }
}

/** True when FLoRA holds replications, reproductions or original-data entries for the DOI. */
export function hasReplication(state: LookupState | undefined): boolean {
    if (state?.status !== "matched") return false;
    const {n_replications_total, n_reproductions_total, n_originals_total} = state.result.record.stats;
    return n_replications_total > 0 || n_reproductions_total > 0 || n_originals_total > 0;
}

export interface ReferenceLookupHooks {
    send: (dois: DoiString[]) => Promise<LookupResponse | undefined>;
    /** Called after the DOIs are marked loading, before the request goes out. */
    onLoading: () => void;
    /** True when the page changed or the work was abandoned while the request ran. */
    abandoned: () => boolean;
}

/**
 * One batched FORRT lookup for reference DOIs that have no lookup state yet
 * (resolved by title or PMC id, or annotated in a document editor). Writes
 * matched / no-match / error into `pageState`; an unanswered request counts as
 * an error, so the pill offers a retry. Returns the looked-up DOIs, or null
 * when abandoned: this call's loading entries are then removed so a later
 * pass looks them up again.
 */
export async function lookUpMissingReferenceStates(
    pageState: Map<DoiString, LookupState>,
    dois: readonly DoiString[],
    hooks: ReferenceLookupHooks,
): Promise<DoiString[] | null> {
    const missing = [...new Set(dois)].filter((doi) => !pageState.has(doi));
    if (missing.length === 0) return [];
    // Identity marks this call's entries: after a navigation, the same DOI may
    // be loading for the next page.
    const loading: LookupState = {status: "loading"};
    for (const doi of missing) pageState.set(doi, loading);
    hooks.onLoading();
    let response: LookupResponse | undefined;
    try {
        response = await hooks.send(missing);
    } catch {
        // Recorded as unavailable below.
    }
    if (hooks.abandoned()) {
        for (const doi of missing) if (pageState.get(doi) === loading) pageState.delete(doi);
        return null;
    }
    for (const doi of missing) {
        const result = response?.results[doi];
        pageState.set(doi, !response || response.errors[doi]
            ? {status: "error", message: "FORRT unavailable"}
            : result ? {status: "matched", result, source: "augmented"} : {status: "no-match"});
    }
    return missing;
}
