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
        expect(selectors).toEqual(expect.arrayContaining([
            "[data-flora-ui]", "[data-flora-ui] *", '[id^="flora-"]', '[id^="flora-"] *',
        ]));
        expect(rule.cssText).toMatch(/hyphens: manual !important/);
    });
});
