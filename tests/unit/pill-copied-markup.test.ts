import {beforeEach, describe, expect, it, vi} from "vitest";
import {deep} from "../helpers";

vi.mock("../../src/shared/pubpeer-api", () => ({
    lookupPubPeerForDoi: vi.fn(() => new Promise(() => {})),
}));

import {createIndicatorPill, createStackedIndicatorPill, updateIndicatorPillBadges} from "../../src/shared/indicator-pill";
import type {DoiString, LookupState} from "../../src/shared/types";

const DOI = "10.1234/copied" as DoiString;
const OTHER = "10.1234/other" as DoiString;
const HOOKS = {generation: () => 1};
const face = (root: ParentNode) => deep(root).querySelector<HTMLElement>("[role=button]")!;
const popover = (root: ParentNode) => deep(root).querySelector<HTMLElement>("[data-flora-popover]")!;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function openModalCopying(entry: HTMLElement): HTMLElement {
    const modal = document.createElement("div");
    modal.className = "reveal-modal";
    modal.innerHTML = entry.innerHTML;
    document.body.appendChild(modal);
    return modal;
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("a pill copied into a publisher modal", () => {
    it("is replaced by a working pill", async () => {
        const entry = document.createElement("div");
        const pill = createIndicatorPill({doi: DOI});
        pill.setAttribute("data-flora-loose-pill", "");
        entry.append("Boutonnet & Lupyan (2015). ", pill);
        document.body.appendChild(entry);

        const modal = openModalCopying(entry);
        await settle();

        const copy = modal.querySelector<HTMLElement>(`[data-flora-doi="${DOI}"]`)!;
        expect(copy.hasAttribute("data-flora-loose-pill")).toBe(true);
        expect(popover(copy).shadowRoot).not.toBeNull();
        face(copy).click();
        expect(popover(copy).style.display).toBe("flex");
        expect(popover(pill).style.display).toBe("none");
    });

    it("carries the badge state the original already shows", async () => {
        const entry = document.createElement("div");
        entry.appendChild(createIndicatorPill({doi: DOI}));
        document.body.appendChild(entry);
        const state = new Map<DoiString, LookupState>([[DOI, {
            status: "matched", source: "extracted",
            result: {record: {stats: {n_replications_total: 3, n_reproductions_total: 0}}},
        } as unknown as LookupState]]);
        updateIndicatorPillBadges(document, state, () => [], "pills", undefined, HOOKS);

        const modal = openModalCopying(entry);
        await settle();

        const copy = modal.querySelector<HTMLElement>(`[data-flora-doi="${DOI}"]`)!;
        face(copy).click();
        expect(deep(popover(copy)).querySelector("[data-flora-badge-row]")!.textContent).toContain("3 replications");
    });

    it("revives a stacked pill as a whole", async () => {
        const entry = document.createElement("div");
        entry.appendChild(createStackedIndicatorPill([{doi: DOI}, {doi: OTHER}]));
        document.body.appendChild(entry);

        const modal = openModalCopying(entry);
        await settle();

        const stack = modal.querySelector<HTMLElement>("[data-flora-stack]")!;
        expect(popover(stack).shadowRoot).not.toBeNull();
        face(stack).click();
        expect(popover(stack).style.display).toBe("flex");
    });

    it("leaves a pill the page only moved alone", async () => {
        const pill = createIndicatorPill({doi: DOI});
        document.body.appendChild(pill);
        const modal = document.createElement("div");
        document.body.appendChild(modal);
        modal.appendChild(pill);
        await settle();
        expect(modal.firstElementChild).toBe(pill);
    });
});
