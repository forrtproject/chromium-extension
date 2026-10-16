import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {createIndicatorPill as createClosedPill, createIndicatorPanel, ensurePopoverRows} from "../../src/shared/indicator-pill";
import type { DoiString } from "../../src/shared/types";

function createIndicatorPill(...args: Parameters<typeof createClosedPill>): HTMLElement {
    const pill = createClosedPill(...args);
    ensurePopoverRows(pill);
    return pill;
}

const DOI = "10.1234/x" as DoiString;

const BOX_PROPS = ["padding-right", "margin-right", "border-right-width"];

describe("a pill dropped into a publisher-styled container", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = "";
    });

    it("declares every box property inline, so no page rule reaches it", () => {
        const pill = createIndicatorPill({ doi: DOI });

        for (const el of [pill, ...pill.querySelectorAll<HTMLElement>("span, div")]) {
            for (const prop of BOX_PROPS) {
                expect(el.style.getPropertyValue(prop), `${prop} on ${el.getAttribute("style")?.slice(0, 40)}`)
                    .not.toBe("");
            }
        }
    });

    it("keeps the popover rows out of reach of the page's stylesheets", () => {
        const pill = createIndicatorPill({ doi: DOI });
        const popover = pill.querySelector<HTMLElement>("[data-flora-popover]")!;

        expect(popover.localName, "a custom tag, so page div and span rules miss the host").toBe("flora-popover");
        expect(popover.shadowRoot, "the rows live behind a shadow boundary").not.toBeNull();
        expect(popover.querySelector("[data-flora-badge-row]"), "nothing in the page DOM a page rule could match").toBeNull();
        expect(popover.shadowRoot!.querySelector("[data-flora-badge-row]")).not.toBeNull();
        const reset = popover.shadowRoot!.querySelector("style")!.textContent!;
        expect(reset).toContain("margin: 0; padding: 0; border-width: 0;");
        expect(reset).toMatch(/:focus-visible \{ outline: 2px solid/);
    });

    it("pins the popover's outer box against a site's own dialog styles", () => {
        const popover = createIndicatorPill({ doi: DOI }).querySelector<HTMLElement>("[data-flora-popover]")!;

        for (const prop of ["transform", "filter", "opacity", "visibility"]) {
            expect(popover.style.getPropertyPriority(prop), prop).toBe("important");
        }
        expect(popover.shadowRoot!.querySelector("style")!.textContent).toContain(":host::before, :host::after { content: none !important;");
    });

    it("leaves each element's own box values alone", () => {
        const pill = createIndicatorPill({ doi: DOI });
        const popover = pill.querySelector<HTMLElement>("[data-flora-popover]")!;
        const body = pill.querySelector<HTMLElement>('[role="button"]')!;

        expect(body.style.padding).toBe("2px");
        expect(popover.style.borderWidth).toBe("1px");
        expect(popover.style.padding).toBe("8px");
    });

    it("neutralises inherited text properties on the pill root", () => {
        const pill = createIndicatorPill({ doi: DOI });

        for (const prop of ["text-indent", "text-transform", "letter-spacing", "word-spacing", "font-variant", "text-shadow"]) {
            expect(pill.style.getPropertyPriority(prop), prop).toBe("important");
        }
        expect(pill.style.getPropertyValue("text-indent")).toBe("0");
    });

    it("neutralises inherited text properties on the panel too", () => {
        const panel = createIndicatorPanel({ doi: DOI });

        expect(panel.style.getPropertyValue("text-indent")).toBe("0");
        expect(panel.style.getPropertyPriority("text-indent")).toBe("important");
    });

    it("leaves the pill's own letter-spacing alone", () => {
        const pill = createIndicatorPill({ doi: DOI });
        const body = pill.querySelector<HTMLElement>('[role="button"]')!;

        expect(body.style.letterSpacing).toBe("0.02em");
    });

    it("does not pin the panel, whose margins come from each site's stylesheet", () => {
        const panel = createIndicatorPanel({ doi: DOI });

        expect(panel.style.getPropertyPriority("margin-top")).toBe("");
    });
});
