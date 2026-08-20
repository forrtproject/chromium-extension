import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    injectInlineRetractionPills,
    resetRetractionPills,
    FLORA_RET_CHECK_KEY,
    type RetractionResponse,
} from "../../src/shared/doi-retraction";
import { removeIndicatorPills, INDICATOR_PILL_CLASS } from "../../src/shared/indicator-pill";
import { resetReferenceMarkers } from "../../src/content-general/references";
import { FLORA_NOTICE_PILL_CLASS } from "../../src/shared/doi-label";
import type { DoiString } from "../../src/shared/types";

const ARTICLE_ONE = "10.1000/article-one" as DoiString;
const PROCESSED_ATTR = "data-flora-ref-processed";

function notice(doi: DoiString): RetractionResponse {
    return { originDoi: doi, doi: `${doi}-notice`, kind: "retraction" };
}

describe("SPA navigation reset", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        resetRetractionPills();
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    });

    it("removes a stale title pill so the new article can place its own", () => {
        const pill = document.createElement("span");
        pill.className = INDICATOR_PILL_CLASS;
        pill.setAttribute("data-flora-title-pill", "");
        document.body.appendChild(pill);

        removeIndicatorPills();

        expect(
            document.querySelector(`.${INDICATOR_PILL_CLASS}[data-flora-title-pill]`)
        ).toBeNull();
    });

    it("removes stale reference pills", () => {
        for (const _ of [1, 2, 3]) {
            const pill = document.createElement("span");
            pill.className = INDICATOR_PILL_CLASS;
            document.body.appendChild(pill);
        }

        removeIndicatorPills();

        expect(document.querySelectorAll(`.${INDICATOR_PILL_CLASS}`)).toHaveLength(0);
    });

    it("leaves the search script's result panels alone", () => {
        // Europe PMC, Scopus and EBSCOhost run both content scripts; the
        // search panels on a results page belong to the other one.
        const panel = document.createElement("div");
        panel.className = INDICATOR_PILL_CLASS;
        panel.setAttribute("data-flora-panel", "");
        const pill = document.createElement("span");
        pill.className = INDICATOR_PILL_CLASS;
        document.body.append(panel, pill);

        removeIndicatorPills();

        expect(document.querySelectorAll(`.${INDICATOR_PILL_CLASS}`)).toHaveLength(1);
        expect(document.querySelector(`.${INDICATOR_PILL_CLASS}[data-flora-panel]`)).toBe(panel);
    });

    it("removes the previous article's retraction pill", () => {
        const anchor = document.createElement("a");
        document.body.appendChild(anchor);
        injectInlineRetractionPills(
            [{ doi: ARTICLE_ONE, anchor }],
            new Map([[ARTICLE_ONE, notice(ARTICLE_ONE)]]),
            null
        );
        expect(document.querySelector(`.${FLORA_NOTICE_PILL_CLASS}`)).not.toBeNull();

        resetRetractionPills();

        expect(document.querySelector(`.${FLORA_NOTICE_PILL_CLASS}`)).toBeNull();
    });

    it("lets a reused anchor be pilled again for the new article", () => {
        const anchor = document.createElement("a");
        document.body.appendChild(anchor);
        const occurrences = [{ doi: ARTICLE_ONE, anchor }];
        const notices = new Map([[ARTICLE_ONE, notice(ARTICLE_ONE)]]);

        injectInlineRetractionPills(occurrences, notices, null);
        resetRetractionPills();
        expect(anchor.hasAttribute(FLORA_RET_CHECK_KEY)).toBe(false);

        injectInlineRetractionPills(occurrences, notices, null);

        expect(anchor.getAttribute(FLORA_RET_CHECK_KEY)).toBe(ARTICLE_ONE);
        expect(document.querySelectorAll(`.${FLORA_NOTICE_PILL_CLASS}`)).toHaveLength(1);
    });

    it("lets reused reference entries be processed again", () => {
        const entry = document.createElement("li");
        entry.setAttribute(PROCESSED_ATTR, "true");
        document.body.appendChild(entry);

        resetReferenceMarkers();

        expect(entry.hasAttribute(PROCESSED_ATTR)).toBe(false);
    });
});
