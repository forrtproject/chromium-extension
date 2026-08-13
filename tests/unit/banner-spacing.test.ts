import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderErrorBanner, removeBanner } from "../../src/content-general/injector";

function stickyAt(top: number, inlineStyle: string): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("style", `position: sticky; top: 0px; ${inlineStyle}`);
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ top, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) });
    return el;
}

describe("banner page spacing", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        document.body.removeAttribute("style");
        vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    });

    afterEach(() => {
        removeBanner();
        vi.unstubAllGlobals();
    });

    it("leaves a sticky element that needs no shift untouched", () => {
        const el = stickyAt(500, "padding-top: 20px;");

        renderErrorBanner("boom");

        expect(el.style.getPropertyValue("padding-top")).toBe("20px");
    });

    it("restores the site's own inline padding after the banner goes", () => {
        const el = stickyAt(0, "padding-top: 20px;");

        renderErrorBanner("boom");
        expect(el.style.getPropertyValue("padding-top")).not.toBe("20px");

        removeBanner();

        expect(el.style.getPropertyValue("padding-top")).toBe("20px");
    });

    it("preserves an !important priority the site had set", () => {
        const el = stickyAt(0, "padding-top: 20px !important;");

        renderErrorBanner("boom");
        removeBanner();

        expect(el.style.getPropertyValue("padding-top")).toBe("20px");
        expect(el.style.getPropertyPriority("padding-top")).toBe("important");
    });

    it("leaves no inline padding behind on an element that had none", () => {
        const el = stickyAt(0, "");

        renderErrorBanner("boom");
        removeBanner();

        expect(el.style.getPropertyValue("padding-top")).toBe("");
    });

    it("restores the body's own inline padding", () => {
        document.body.setAttribute("style", "padding-top: 30px;");

        renderErrorBanner("boom");
        removeBanner();

        expect(document.body.style.getPropertyValue("padding-top")).toBe("30px");
    });

    it("keeps the site's value as the original across repeated banner swaps", () => {
        const el = stickyAt(0, "padding-top: 20px;");

        renderErrorBanner("first");
        renderErrorBanner("second");
        removeBanner();

        expect(el.style.getPropertyValue("padding-top")).toBe("20px");
    });
});
