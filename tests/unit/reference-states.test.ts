import { describe, it, expect, vi, beforeEach } from "vitest";
import { hasReplication, lookUpMissingReferenceStates, ResolvedReferences } from "../../src/content-general/reference-states";
import type { ResolvedReference } from "../../src/content-general/references";
import type { LookupResponse } from "../../src/shared/messages";
import type { DoiString, LookupState, ReplicationResult } from "../../src/shared/types";

const ON_PAGE = "10.1000/on-page" as DoiString;
const BY_TITLE = "10.1000/by-title" as DoiString;
const BY_PMC = "10.1000/by-pmc" as DoiString;

function ref(doi: DoiString, mode: ResolvedReference["mode"] = "augment"): ResolvedReference {
    const element = document.createElement("li");
    document.body.appendChild(element);
    return { entry: { element, text: `Citation for ${doi} (2020)`, doi: null } as ResolvedReference["entry"], doi, mode };
}

describe("ResolvedReferences", () => {
    beforeEach(() => { document.body.innerHTML = ""; });

    it("keeps earlier references when a later pass resolves nothing", () => {
        const refs = new ResolvedReferences();
        refs.merge([ref(BY_TITLE), ref(BY_PMC, "pmc")]);
        expect(refs.merge([]).map((r) => r.doi)).toEqual([BY_TITLE, BY_PMC]);
    });

    it("keeps one entry per DOI and drops entries that left the DOM", () => {
        const refs = new ResolvedReferences();
        const first = ref(BY_TITLE);
        const gone = ref(BY_PMC, "pmc");
        refs.merge([first, gone]);
        gone.entry.element.remove();
        const again = ref(BY_TITLE);
        expect(refs.merge([again])).toEqual([again]);
        refs.clear();
        expect(refs.all()).toEqual([]);
    });

    it("keeps a DOI cited twice while either citation is still in the DOM", () => {
        const refs = new ResolvedReferences();
        const older = ref(BY_TITLE);
        const newer = ref(BY_TITLE);
        refs.merge([older]);
        refs.merge([newer]);
        newer.entry.element.remove();
        expect(refs.all()).toEqual([older]);
        const detached = ref(BY_TITLE);
        detached.entry.element.remove();
        expect(refs.merge([detached])).toEqual([older]);
    });

    it("drops references that left the DOM without another merge", () => {
        const refs = new ResolvedReferences();
        const gone = ref(BY_PMC, "pmc");
        refs.merge([ref(BY_TITLE), gone]);
        gone.entry.element.remove();
        expect(refs.all().map((r) => r.doi)).toEqual([BY_TITLE]);
    });
});

describe("hasReplication", () => {
    const withStats = (stats: Record<string, number>): LookupState => ({
        status: "matched",
        source: "augmented",
        result: { record: { stats: { n_replications_total: 0, n_reproductions_total: 0, n_originals_total: 0, ...stats } } } as unknown as ReplicationResult,
    });

    it("counts replications, reproductions and original-data entries", () => {
        expect(hasReplication(withStats({ n_replications_total: 1 }))).toBe(true);
        expect(hasReplication(withStats({ n_originals_total: 1 }))).toBe(true);
        expect(hasReplication(withStats({ n_reproductions_total: 1 }))).toBe(true);
        expect(hasReplication(withStats({}))).toBe(false);
        expect(hasReplication({ status: "no-match" })).toBe(false);
        expect(hasReplication(undefined)).toBe(false);
    });
});

describe("lookUpMissingReferenceStates", () => {
    const matched = { record: { stats: { n_replications_total: 2, n_reproductions_total: 0 } } } as unknown as ReplicationResult;
    let pageState: Map<DoiString, LookupState>;

    beforeEach(() => {
        pageState = new Map([[ON_PAGE, { status: "no-match" }]]);
    });

    it("sends one batch for the DOIs without a state and records each outcome", async () => {
        const seenWhileLoading: (string | undefined)[] = [];
        const send = vi.fn(async (): Promise<LookupResponse> => ({
            results: { [BY_TITLE]: matched },
            errors: { [BY_PMC]: "timeout" },
        } as unknown as LookupResponse));
        const other = "10.1000/no-record" as DoiString;
        const looked = await lookUpMissingReferenceStates(pageState, [ON_PAGE, BY_TITLE, BY_PMC, other, BY_TITLE], {
            send,
            onLoading: () => seenWhileLoading.push(pageState.get(BY_TITLE)?.status),
            abandoned: () => false,
        });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith([BY_TITLE, BY_PMC, other]);
        expect(looked).toEqual([BY_TITLE, BY_PMC, other]);
        expect(seenWhileLoading).toEqual(["loading"]);
        expect(pageState.get(ON_PAGE)).toEqual({ status: "no-match" });
        expect(pageState.get(BY_TITLE)).toEqual({ status: "matched", result: matched, source: "augmented" });
        expect(pageState.get(BY_PMC)?.status).toBe("error");
        expect(pageState.get(other)).toEqual({ status: "no-match" });
    });

    it("records an unanswered request as an error, so the pill offers a retry", async () => {
        await lookUpMissingReferenceStates(pageState, [BY_TITLE], {
            send: async () => { throw new Error("worker gone"); },
            onLoading: () => {},
            abandoned: () => false,
        });
        expect(pageState.get(BY_TITLE)).toEqual({ status: "error", message: "FORRT unavailable" });
    });

    it("removes only its own loading entries when abandoned", async () => {
        const nextPage: LookupState = { status: "loading" };
        const looked = await lookUpMissingReferenceStates(pageState, [BY_TITLE, BY_PMC], {
            send: async () => {
                // Meanwhile another lookup took over BY_PMC.
                pageState.set(BY_PMC, nextPage);
                return { results: {}, errors: {} } as unknown as LookupResponse;
            },
            onLoading: () => {},
            abandoned: () => true,
        });
        expect(looked).toBeNull();
        expect(pageState.has(BY_TITLE)).toBe(false);
        expect(pageState.get(BY_PMC)).toBe(nextPage);
    });

    it("sends nothing when every DOI already has a state", async () => {
        const send = vi.fn();
        expect(await lookUpMissingReferenceStates(pageState, [ON_PAGE], { send, onLoading: send, abandoned: () => false })).toEqual([]);
        expect(send).not.toHaveBeenCalled();
    });
});
