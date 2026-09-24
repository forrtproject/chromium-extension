import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

type TabPosition = typeof import("../../src/shared/tab-position");

async function load(stored?: string): Promise<TabPosition> {
    vi.resetModules();
    if (stored === undefined) localStorage.removeItem("flora_tab_top_v1");
    else localStorage.setItem("flora_tab_top_v1", stored);
    return import("../../src/shared/tab-position");
}

function rect(top: number, bottom: number, left = 900, right = 1024): DOMRect {
    return {top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({})};
}

function element(position: string, box: DOMRect): HTMLElement {
    const el = document.createElement("div");
    el.style.position = position;
    el.getBoundingClientRect = () => box;
    document.body.appendChild(el);
    return el;
}

function tabOfHeight(height: number): HTMLElement {
    const tab = document.createElement("button");
    Object.defineProperty(tab, "offsetHeight", {value: height});
    document.body.appendChild(tab);
    return tab;
}

describe("tab position", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    afterEach(() => {
        localStorage.removeItem("flora_tab_top_v1");
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("ignores a stored position that is not a number", async () => {
        for (const stored of ["abc", "", "  ", "NaN", "Infinity"]) {
            const {hasCustomTabTop, positionTabOnRightEdge} = await load(stored);
            expect(hasCustomTabTop(), JSON.stringify(stored)).toBe(false);
            const tab = tabOfHeight(80);
            positionTabOnRightEdge(tab);
            expect(tab.style.top).toMatch(/^\d+px$/);
        }
    });

    it("keeps a stored position that is a number", async () => {
        const {hasCustomTabTop, positionTabOnRightEdge} = await load("120");
        expect(hasCustomTabTop()).toBe(true);
        const tab = tabOfHeight(80);
        positionTabOnRightEdge(tab);
        expect(tab.style.top).toBe("120px");
    });

    it("steps around a fixed right-edge overlay, not the page's own containers", async () => {
        const {positionTabOnRightEdge} = await load();
        element("static", rect(0, 5000, 0));
        element("fixed", rect(300, 500));
        const tab = tabOfHeight(80);
        positionTabOnRightEdge(tab);
        expect(tab.style.top).toBe("204px");
    });

    it("measures again for a tab of a different height inside the throttle window", async () => {
        const {positionTabOnRightEdge} = await load();
        element("fixed", rect(300, 500));
        const sweeps = vi.spyOn(document, "querySelectorAll");

        positionTabOnRightEdge(tabOfHeight(80));
        positionTabOnRightEdge(tabOfHeight(82));
        expect(sweeps.mock.calls.filter(([sel]) => sel === "*")).toHaveLength(1);

        positionTabOnRightEdge(tabOfHeight(200));
        expect(sweeps.mock.calls.filter(([sel]) => sel === "*")).toHaveLength(2);
    });
});
