import {beforeEach, describe, expect, it, vi} from "vitest";

const lookup = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock("../../src/shared/pubpeer-api", () => ({lookupPubPeerForDoi: lookup}));

import type {DoiString, LookupState} from "../../src/shared/types";
import {createIndicatorPill, updateIndicatorPillBadges} from "../../src/shared/indicator-pill";

const DOI = "10.1234/known" as DoiString;
const hooks = {generation: () => 0};

beforeEach(() => {
    document.body.innerHTML = "";
    lookup.mockClear();
});

describe("a pill drawn from data the page already has", () => {
    it("shows a known PubPeer thread without looking it up", () => {
        const pill = createIndicatorPill({
            doi: DOI,
            pubpeer: {total_comments: 3, url: "https://pubpeer.com/publications/abc", title: "Paper"} as never,
        });
        document.body.appendChild(pill);

        expect(lookup).not.toHaveBeenCalled();
        const segment = pill.querySelector<HTMLElement>("[data-flora-pubpeer-segment]")!;
        expect(segment.hasAttribute("data-flora-present")).toBe(true);
        expect(segment.textContent).toContain("3");
        expect(segment.hasAttribute("data-flora-pending")).toBe(false);
    });

    it("treats a known absence as answered, not as still checking", () => {
        const pill = createIndicatorPill({doi: DOI, pubpeer: null});

        expect(lookup).not.toHaveBeenCalled();
        const segment = pill.querySelector<HTMLElement>("[data-flora-pubpeer-segment]")!;
        expect(segment.hasAttribute("data-flora-pending")).toBe(false);
        expect(segment.title).toBe("No PubPeer discussion found");
    });

    it("looks PubPeer up when the caller has no answer", () => {
        createIndicatorPill({doi: DOI});
        expect(lookup).toHaveBeenCalledWith(DOI);
    });

    it("marks Open Access as being checked while its lookup runs", () => {
        const pill = createIndicatorPill({doi: DOI, pubpeer: null, oaStatus: new Promise(() => {})});
        const oa = pill.querySelector<HTMLElement>("[data-flora-oa-segment]")!;

        expect(oa.hasAttribute("data-flora-pending")).toBe(true);
        expect(oa.title).toBe("Checking for a free copy…");
        expect(oa.style.textDecoration).toBe("none");
    });

    it("keeps an unchanged badge in place when the page repaints", () => {
        const pill = createIndicatorPill({doi: DOI, pubpeer: null});
        document.body.appendChild(pill);
        const before = pill.querySelector("[data-flora-badge-segment]");
        const state = new Map<DoiString, LookupState>([[DOI, {status: "no-match"}]]);

        updateIndicatorPillBadges(document, state, () => [], "pills", undefined, hooks);

        expect(pill.querySelector("[data-flora-badge-segment]")).toBe(before);
    });
});
