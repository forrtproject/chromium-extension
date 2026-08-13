import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    expandReferencesSection,
    _resetExpandReferencesForTesting,
} from "../../src/shared/site-adapters";

const ADAPTER = {
    id: "test",
    hostnames: ["example.com"],
    autoExpandReferences: ".accordion__control",
} as Parameters<typeof expandReferencesSection>[0];

function control(attrs: Record<string, string> = {}): HTMLElement {
    const el = document.createElement("button");
    el.className = "accordion__control";
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
}

function setUrl(href: string): void {
    Object.defineProperty(window, "location", {
        value: { href, hostname: "example.com" },
        writable: true,
        configurable: true,
    });
}

describe("expandReferencesSection", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        _resetExpandReferencesForTesting();
        setUrl("https://example.com/article-1");
    });

    it("expands a collapsed section", () => {
        const el = control();
        const click = vi.spyOn(el, "click");

        expandReferencesSection(ADAPTER);

        expect(click).toHaveBeenCalledTimes(1);
    });

    it("clicks at most once per page across repeated passes", () => {
        const el = control();
        const click = vi.spyOn(el, "click");

        expandReferencesSection(ADAPTER);
        expandReferencesSection(ADAPTER);
        expandReferencesSection(ADAPTER);

        expect(click).toHaveBeenCalledTimes(1);
    });

    it("does not re-expand a section the reader collapsed", () => {
        const el = control();
        const click = vi.spyOn(el, "click");

        expandReferencesSection(ADAPTER);
        el.setAttribute("aria-expanded", "false");
        expandReferencesSection(ADAPTER);

        expect(click).toHaveBeenCalledTimes(1);
    });

    it("leaves an already-expanded section alone", () => {
        const el = control({ "aria-expanded": "true" });
        const click = vi.spyOn(el, "click");

        expandReferencesSection(ADAPTER);

        expect(click).not.toHaveBeenCalled();
    });

    it("does not burn its one click before the accordion renders", () => {
        expandReferencesSection(ADAPTER);

        const el = control();
        const click = vi.spyOn(el, "click");
        expandReferencesSection(ADAPTER);

        expect(click).toHaveBeenCalledTimes(1);
    });

    it("re-arms after an SPA navigation", () => {
        const first = control();
        const firstClick = vi.spyOn(first, "click");
        expandReferencesSection(ADAPTER);
        expect(firstClick).toHaveBeenCalledTimes(1);

        document.body.innerHTML = "";
        setUrl("https://example.com/article-2");
        const second = control();
        const secondClick = vi.spyOn(second, "click");

        expandReferencesSection(ADAPTER);

        expect(secondClick).toHaveBeenCalledTimes(1);
    });

    it("does nothing for an adapter without the option", () => {
        const el = control();
        const click = vi.spyOn(el, "click");

        expandReferencesSection({ id: "x", hostnames: [] } as Parameters<typeof expandReferencesSection>[0]);

        expect(click).not.toHaveBeenCalled();
    });
});
