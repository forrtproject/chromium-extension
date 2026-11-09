import { describe, it, expect, vi, beforeEach } from "vitest";
import { countFindings, hasReplication, lookUpMissingReferenceStates, ResolvedReferences } from "../../src/content-general/reference-states";
import type { ResolvedReference } from "../../src/content-general/references";
import type { LookupResponse } from "../../src/shared/messages";
import type { DoiString, LookupState, ReplicationResult } from "../../src/shared/types";

const ON_PAGE = "10.1000/on-page" as DoiString;
const BY_TITLE = "10.1000/by-title" as DoiString;
const BY_PMC = "10.1000/by-pmc" as DoiString;

function ref(doi: DoiString, mode: ResolvedReference["mode"] = "augment"): ResolvedReference {
    const element = document.createElement("li");
    document.body.appendChild(element);
    return { entry: { element, text: `Citation for ${doi} (2020)`, dois: [] } as ResolvedReference["entry"], doi, mode };
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

describe("countFindings", () => {
    const withReplications: LookupState = {
        status: "matched",
        source: "augmented",
        result: { record: { stats: { n_replications_total: 2, n_reproductions_total: 0, n_originals_total: 0 } } } as unknown as ReplicationResult,
    };
    const A = "10.1000/a" as DoiString;
    const B = "10.1000/b" as DoiString;
    const C = "10.1000/c" as DoiString;
    const D = "10.1000/d" as DoiString;

    it("finds a paper's state under any casing of its DOI", () => {
        const upper = "10.1000/MIXED" as DoiString;
        const lower = "10.1000/mixed" as DoiString;
        const counts = countFindings([upper, lower], {
            pageState: new Map<DoiString, LookupState>([[lower, withReplications]]),
            notices: [], hasComments: (doi) => doi === lower,
        });
        expect(counts).toMatchObject({papers: 1, checked: 1, replications: 1, pubpeer: 1});
    });

    it("keeps a paper unavailable when any casing of its DOI failed", () => {
        const upper = "10.1000/MIXED" as DoiString;
        const lower = "10.1000/mixed" as DoiString;
        const counts = countFindings([upper, lower], {
            pageState: new Map<DoiString, LookupState>([[upper, { status: "no-match" }], [lower, { status: "error" } as LookupState]]),
            notices: [], hasComments: () => false,
        });
        expect(counts).toMatchObject({papers: 1, unavailable: 1});
    });

    it("counts failed checks as unavailable, not as clear", () => {
        const counts = countFindings([A, B, C], {
            pageState: new Map<DoiString, LookupState>([[A, { status: "error" } as LookupState], [B, withReplications], [C, withReplications]]),
            notices: [], hasComments: () => false, checkFailed: (doi) => doi === B,
        });
        expect(counts).toMatchObject({ papers: 3, checked: 3, unavailable: 2 });
    });

    it("counts each paper once, however its DOI is cased", () => {
        const counts = countFindings([A, A.toUpperCase() as DoiString], {
            pageState: new Map([[A, withReplications]]), notices: [], hasComments: () => false,
        });
        expect(counts).toMatchObject({ papers: 1, checked: 1, replications: 1 });
    });

    it("counts a retracted paper as retracted only, even with a concern notice too", () => {
        const counts = countFindings([A, B], {
            pageState: new Map(),
            notices: [{ originDoi: A, kind: "concern" }, { originDoi: A, kind: "retraction" }, { originDoi: B, kind: "concern" }],
            hasComments: () => false,
        });
        expect(counts).toMatchObject({ papers: 2, checked: 2, retracted: 1, concern: 1 });
    });

    it("counts PubPeer-only papers from the per-DOI verdict", () => {
        const counts = countFindings([A, B], {
            pageState: new Map([[A, { status: "no-match" }], [B, { status: "no-match" }]]),
            notices: [],
            hasComments: (doi) => doi === B,
        });
        expect(counts).toMatchObject({ papers: 2, checked: 2, pubpeer: 1, replications: 0 });
    });

    it("leaves papers still loading out of the checked count", () => {
        const counts = countFindings([A, B, C, D], {
            pageState: new Map<DoiString, LookupState>([
                [A, { status: "loading" }], [B, { status: "error", message: "x" }], [C, withReplications],
            ]),
            notices: [],
            hasComments: () => false,
        });
        expect(counts).toMatchObject({ papers: 4, checked: 2, replications: 1 });
    });
});
