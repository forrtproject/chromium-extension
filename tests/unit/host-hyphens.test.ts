import {describe, expect, it} from "vitest";
import {ensureFocusStyle} from "../../src/shared/flora-ui";

// A publisher's `* { hyphens: auto }` split words inside ORE popovers and the
// side panel ("open-ac-cess"). Checked in Chrome for Testing; here the rule
// that prevents it.
describe("host hyphenation", () => {
    it("is switched off on every ORE root and everything inside it", () => {
        document.head.innerHTML = "";
        ensureFocusStyle();
        const sheet = (document.getElementById("flora-focus-style") as HTMLStyleElement).sheet!;
        const rule = [...sheet.cssRules].find((r) => r.cssText.includes("hyphens")) as CSSStyleRule;
        expect(rule).toBeDefined();
        const selectors = rule.selectorText.split(",").map((s) => s.trim());
        const roots = ["[data-flora-ui]", "#flora-banner-host", "#flora-setup-prompt", "#flora-sheets-modal", "#flora-pubpeer-panel"];
        expect(selectors).toEqual(expect.arrayContaining(roots.flatMap((root) => [root, `${root} *`])));
        expect(rule.cssText).toMatch(/hyphens: manual !important/);
    });

    it("leaves a host element that merely uses the flora- id prefix alone", () => {
        document.head.innerHTML = "";
        document.body.innerHTML = '<div id="flora-content"><p>text</p></div>';
        ensureFocusStyle();
        const sheet = (document.getElementById("flora-focus-style") as HTMLStyleElement).sheet!;
        const rule = [...sheet.cssRules].find((r) => r.cssText.includes("hyphens")) as CSSStyleRule;
        expect(document.querySelector("#flora-content")!.matches(rule.selectorText)).toBe(false);
        expect(document.querySelector("#flora-content p")!.matches(rule.selectorText)).toBe(false);
    });
});

describe("toasts", () => {
    it("install the hyphenation reset even on a page without pills", async () => {
        document.head.innerHTML = "";
        const {showToast} = await import("../../src/shared/toast");
        showToast("Copied");
        expect(document.getElementById("flora-focus-style")?.textContent).toContain("hyphens: manual");
    });
});

describe("search-result panels", () => {
    it("install the hyphenation reset even on a page without pills", async () => {
        document.head.innerHTML = "";
        const {createIndicatorPanel} = await import("../../src/shared/indicator-pill");
        createIndicatorPanel({doi: "10.1234/panel" as never});
        expect(document.getElementById("flora-focus-style")?.textContent).toContain("hyphens: manual");
    });
});
