import {beforeEach, describe, expect, it, vi} from "vitest";

const pubpeer = vi.hoisted(() => ({resolve: (_: unknown) => {}}));
vi.mock("../../src/shared/pubpeer-api", () => ({
    lookupPubPeerForDoi: vi.fn(() => new Promise((resolve) => { pubpeer.resolve = resolve; })),
}));

import {createIndicatorPill, updateIndicatorPillBadges} from "../../src/shared/indicator-pill";
import type {DoiString, LookupState} from "../../src/shared/types";

const DOI = "10.1234/lazy" as DoiString;
const HOOKS = {generation: () => 1};
const open = (pill: HTMLElement) => pill.querySelector<HTMLElement>("[role=button]")!.click();
const popover = (pill: HTMLElement) => pill.querySelector<HTMLElement>("[data-flora-popover]")!;

beforeEach(() => { document.body.innerHTML = ""; });

describe("the pill's popover is built when it first opens", () => {
    it("carries no rows until then", () => {
        const pill = createIndicatorPill({doi: DOI, oaStatus: Promise.resolve(null)});
        document.body.appendChild(pill);
        expect(popover(pill).childElementCount).toBe(0);
        open(pill);
        expect(popover(pill).querySelector("[data-flora-badge-row]")).not.toBeNull();
    });

    it("shows a lookup that landed before it opened", async () => {
        const pill = createIndicatorPill({doi: DOI, oaStatus: Promise.resolve({isOa: true, url: "https://repo.example.org/a.pdf"})});
        document.body.appendChild(pill);
        pubpeer.resolve({total_comments: 2, url: "https://pubpeer.com/p/1"});
        await vi.waitFor(() => expect(pill.querySelector("[data-flora-pubpeer-segment]")!.textContent).toContain("2"));
        open(pill);
        expect(popover(pill).textContent).toContain("Free full text available");
        expect(popover(pill).textContent).toContain("2 comments");
    });

    it("shows a replication count repainted before it opened", () => {
        const pill = createIndicatorPill({doi: DOI});
        document.body.appendChild(pill);
        const state = new Map<DoiString, LookupState>([[DOI, {
            status: "matched", source: "extracted",
            result: {record: {stats: {n_replications_total: 5, n_reproductions_total: 0}}},
        } as unknown as LookupState]]);
        updateIndicatorPillBadges(document, state, () => [], "pills", undefined, HOOKS);
        open(pill);
        expect(popover(pill).querySelector("[data-flora-badge-row]")!.textContent).toContain("5 replications");
    });
});
