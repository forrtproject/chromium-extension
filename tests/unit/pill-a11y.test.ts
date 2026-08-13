import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/shared/settings", () => ({
    getSettings: vi.fn().mockResolvedValue({ email: "test@example.com", citationStyle: "apa" }),
    isSetupComplete: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../src/shared/pubpeer-api", () => ({
    lookupPubPeerForDoi: vi.fn(() => new Promise(() => {})),
}));

import { createIndicatorPill } from "../../src/shared/indicator-pill";
import type { DoiString, RetractionResponse } from "../../src/shared/types";

const DOI = "10.1000/keyboard" as DoiString;

function pillOf(el: HTMLElement): HTMLElement {
    return el.querySelector<HTMLElement>('[role="button"]')!;
}
function popoverOf(el: HTMLElement): HTMLElement {
    return el.querySelector<HTMLElement>('[role="dialog"]')!;
}
function press(el: HTMLElement, key: string): void {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("pill keyboard and screen-reader access", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
        document.body.innerHTML = "";
    });

    function mount(retraction: RetractionResponse | null = null): HTMLElement {
        const wrapper = createIndicatorPill({
            doi: DOI,
            oaStatus: null,
            retraction,
            replicationsCount: 2,
            reproductionsCount: 1,
        });
        document.body.appendChild(wrapper);
        return wrapper;
    }

    it("exposes the pill as a focusable button", () => {
        const pill = pillOf(mount());

        expect(pill.getAttribute("tabindex")).toBe("0");
        expect(pill.getAttribute("role")).toBe("button");
        expect(pill.getAttribute("aria-haspopup")).toBe("dialog");
        expect(pill.getAttribute("aria-expanded")).toBe("false");
    });

    it("summarises the paper's state in the accessible name", () => {
        const pill = pillOf(mount({ originDoi: DOI, doi: `${DOI}-n`, kind: "retraction" }));
        const label = pill.getAttribute("aria-label") ?? "";

        expect(label).toContain(DOI);
        expect(label).toContain("retracted");
        expect(label).toContain("3 replication or reproduction studies");
    });

    it("opens the popover on Enter and reports it expanded", () => {
        const wrapper = mount();
        const pill = pillOf(wrapper);

        press(pill, "Enter");

        expect(popoverOf(wrapper).style.display).toBe("flex");
        expect(pill.getAttribute("aria-expanded")).toBe("true");
    });

    it("opens the popover on Space", () => {
        const wrapper = mount();

        press(pillOf(wrapper), " ");

        expect(popoverOf(wrapper).style.display).toBe("flex");
    });

    it("closes on Escape and returns focus to the pill", () => {
        const wrapper = mount();
        const pill = pillOf(wrapper);
        press(pill, "Enter");

        press(pill, "Escape");

        expect(document.activeElement).toBe(pill);
    });

    it("opens when focus reaches the pill", () => {
        const wrapper = mount();

        pillOf(wrapper).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

        expect(popoverOf(wrapper).style.display).toBe("flex");
    });
});
