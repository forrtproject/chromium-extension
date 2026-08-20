import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createIndicatorPill, createIndicatorPanel } from "../../src/shared/indicator-pill";
import type { DoiString } from "../../src/shared/types";

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

    it("keeps the popover rows shielded too", () => {
        const pill = createIndicatorPill({ doi: DOI });
        const popover = pill.querySelector<HTMLElement>("[data-flora-popover]");

        expect(popover).not.toBeNull();
        const rows = popover!.querySelectorAll<HTMLElement>("span, div");
        expect(rows.length).toBeGreaterThan(5);
        for (const row of rows) {
            expect(row.style.getPropertyValue("border-right-width")).not.toBe("");
        }
    });

    it("leaves each element's own box values alone", () => {
        const pill = createIndicatorPill({ doi: DOI });
        const popover = pill.querySelector<HTMLElement>("[data-flora-popover]")!;
        const body = pill.querySelector<HTMLElement>('[role="button"]')!;

        expect(body.style.padding).toBe("2px 8px 2px 10px");
        expect(popover.style.borderWidth).toBe("1px");
        expect(popover.style.padding).toBe("8px");
    });

    it("does not pin the panel, whose margins come from each site's stylesheet", () => {
        const panel = createIndicatorPanel({ doi: DOI });

        expect(panel.style.getPropertyPriority("margin-top")).toBe("");
    });
});
