import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ensureFocusStyle } from "../../src/shared/flora-ui";
import { createIndicatorPill } from "../../src/shared/indicator-pill";
import type { DoiString } from "../../src/shared/types";

const POPUP_CSS = readFileSync(join(__dirname, "..", "..", "src", "popup", "popup.css"), "utf-8");

function relativeLuminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastOnWhite(hex: string): number {
    return 1.05 / (relativeLuminance(hex) + 0.05);
}

describe("text contrast", () => {
    it("uses an AA-passing muted colour in the popup", () => {
        const match = POPUP_CSS.match(/--text-muted:\s*(#[0-9a-f]{6})/i);
        expect(match).not.toBeNull();
        expect(contrastOnWhite(match![1])).toBeGreaterThanOrEqual(4.5);
    });

    it("uses an AA-passing colour for pill no-data subtitles", () => {
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
        const pill = createIndicatorPill({
            doi: "10.1000/x" as DoiString,
            oaStatus: null,
            retraction: null,
        });

        const faint = [...pill.querySelectorAll<HTMLElement>("*")].filter(
            (el) =>
                (el.textContent ?? "").trim().length > 0 &&
                /color:\s*#8b949e/i.test(el.getAttribute("style") ?? "")
        );

        expect(faint).toHaveLength(0);
        vi.unstubAllGlobals();
    });
});

describe("keyboard focus visibility", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
    });

    it("injects a focus-visible rule scoped to FLoRA UI", () => {
        ensureFocusStyle();

        const style = document.getElementById("flora-focus-style");
        expect(style?.textContent).toContain(":focus-visible");
        expect(style?.textContent).toContain("outline");
        expect(style?.textContent).toContain("[data-flora-ui]");
    });

    it("injects the rule only once", () => {
        ensureFocusStyle();
        ensureFocusStyle();

        expect(document.querySelectorAll("#flora-focus-style")).toHaveLength(1);
    });

    it("restores a focus ring the popup's all:unset would have removed", () => {
        expect(POPUP_CSS).toMatch(/\.popup-btn:focus-visible[\s\S]*?outline:/);
    });
});
