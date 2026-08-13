import { describe, it, expect, beforeEach, vi } from "vitest";
import { hideAllFloraUI, showAllFloraUI, HIDE_STYLE_ID } from "../../src/content-general/injector";
import { FLORA_UI_SELECTOR } from "../../src/shared/flora-ui";
import { createIndicatorPill } from "../../src/shared/indicator-pill";
import { injectInlineRetractionPills, type RetractionResponse } from "../../src/shared/doi-retraction";
import { FLORA_NOTICE_PILL_CLASS } from "../../src/shared/doi-label";
import type { DoiString } from "../../src/shared/types";

const DOI = "10.1000/hidden" as DoiString;

function hideRule(): string | null {
    return document.getElementById(HIDE_STYLE_ID)?.textContent ?? null;
}

describe("popup hide/show covers later-injected UI", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    });

    it("installs a rule targeting every FLoRA-owned element", () => {
        hideAllFloraUI();

        expect(hideRule()).toContain(FLORA_UI_SELECTOR);
        expect(hideRule()).toContain("display: none !important");
    });

    it("removes the rule when the UI is shown again", () => {
        hideAllFloraUI();
        showAllFloraUI();

        expect(document.getElementById(HIDE_STYLE_ID)).toBeNull();
    });

    it("does not stack rules when hidden twice", () => {
        hideAllFloraUI();
        hideAllFloraUI();

        expect(document.querySelectorAll(`#${HIDE_STYLE_ID}`)).toHaveLength(1);
    });

    it("covers an indicator pill created after hiding", () => {
        hideAllFloraUI();

        const pill = createIndicatorPill({ doi: DOI, oaStatus: null, retraction: null });

        expect(pill.matches(FLORA_UI_SELECTOR)).toBe(true);
    });

    it("covers a retraction pill created after hiding", () => {
        hideAllFloraUI();
        const anchor = document.createElement("a");
        document.body.appendChild(anchor);
        const notice: RetractionResponse = { originDoi: DOI, doi: `${DOI}-notice`, kind: "retraction" };

        injectInlineRetractionPills([{ doi: DOI, anchor }], new Map([[DOI, notice]]), null);

        const pill = document.querySelector(`.${FLORA_NOTICE_PILL_CLASS}`);
        expect(pill).not.toBeNull();
        expect(pill!.matches(FLORA_UI_SELECTOR)).toBe(true);
    });
});
