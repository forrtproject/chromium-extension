import {beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../../src/shared/pubpeer-api", () => ({
    lookupPubPeerForDoi: vi.fn(() => new Promise(() => {})),
}));

import {createStackedIndicatorPill, updateIndicatorPillBadges} from "../../src/shared/indicator-pill";
import type {DoiString, LookupState} from "../../src/shared/types";

const A = "10.1234/first" as DoiString;
const B = "10.1234/second" as DoiString;
const HOOKS = {generation: () => 1};

const face = (stack: HTMLElement) => stack.querySelector<HTMLElement>(":scope > [role=button]")!;
const popover = (stack: HTMLElement) => stack.querySelector<HTMLElement>("[data-flora-popover]")!;
const slides = (stack: HTMLElement) => [...stack.querySelectorAll<HTMLElement>("[data-flora-stack-slide]")];
const shown = (stack: HTMLElement) =>
    [...stack.querySelectorAll<HTMLElement>("[data-flora-doi]")]
        .filter((p) => p.style.getPropertyValue("display") !== "none")
        .map((p) => p.getAttribute("data-flora-doi"));
const pager = (stack: HTMLElement, label: string) =>
    popover(stack).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

function build(): HTMLElement {
    const stack = createStackedIndicatorPill([{doi: A}, {doi: B}]);
    document.body.appendChild(stack);
    return stack;
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("a reference with several DOIs gets one stacked pill", () => {
    it("shows one paper on the face, numbered within the stack", () => {
        const stack = build();
        expect(shown(stack)).toEqual([A]);
        expect(stack.querySelector("[data-flora-doi-segment]")!.textContent).toContain("1/2");
        expect(stack.querySelectorAll("[role=button]")).toHaveLength(1);
    });

    it("opens one popover with a page of rows per paper", () => {
        const stack = build();
        face(stack).click();
        expect(popover(stack).style.display).toBe("flex");
        expect(slides(stack).map((s) => s.querySelector("[data-flora-doi-text]")!.textContent)).toEqual([A, B]);
        expect(popover(stack).textContent).toContain("Paper 1 of 2");
    });

    it("pages between the papers and moves the face with them", () => {
        const stack = build();
        face(stack).click();
        expect(pager(stack, "Previous paper").disabled).toBe(true);
        pager(stack, "Next paper").click();
        expect(shown(stack)).toEqual([B]);
        expect(popover(stack).textContent).toContain("Paper 2 of 2");
        expect(pager(stack, "Next paper").disabled).toBe(true);
        face(stack).dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true}));
        expect(shown(stack)).toEqual([A]);
    });

    it("stays open when paging to the last paper from a hover-opened popover", () => {
        vi.useFakeTimers();
        try {
            const stack = build();
            face(stack).dispatchEvent(new MouseEvent("mouseenter"));
            const next = pager(stack, "Next paper");
            next.focus();
            next.click();
            vi.advanceTimersByTime(1000);
            expect(popover(stack).style.display).toBe("flex");
            expect(document.activeElement).toBe(pager(stack, "Previous paper"));
        } finally {
            vi.useRealTimers();
        }
    });

    it("repaints each paper's rows inside its own page", () => {
        const stack = build();
        face(stack).click();
        const state = new Map<DoiString, LookupState>([[B, {
            status: "matched", source: "extracted",
            result: {record: {stats: {n_replications_total: 4, n_reproductions_total: 0}}},
        } as unknown as LookupState]]);
        updateIndicatorPillBadges(document, state, () => [], "pills", undefined, HOOKS);
        expect(slides(stack)[1].querySelector("[data-flora-badge-row]")!.textContent).toContain("4 replications");
        expect(slides(stack)[0].querySelector("[data-flora-badge-row]")!.textContent).not.toContain("4 replications");
    });
});
