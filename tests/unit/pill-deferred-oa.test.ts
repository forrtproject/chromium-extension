import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../../src/shared/pubpeer-api", () => ({lookupPubPeerForDoi: vi.fn(() => new Promise(() => {}))}));

import type {DoiString} from "../../src/shared/types";

const DOI = "10.1234/deferred" as DoiString;
const OA = {isOa: true, url: "https://repo.example.org/paper.pdf", locations: [{url: "https://repo.example.org/paper.pdf", label: "Repo", version: null, isPdf: true}]};

let observed: Element[];
let fire: (target: Element) => void;

beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    observed = [];
    vi.stubGlobal("IntersectionObserver", class {
        constructor(private callback: IntersectionObserverCallback) {
            fire = (target) => this.callback([{target, isIntersecting: true} as IntersectionObserverEntry], this as unknown as IntersectionObserver);
        }
        observe(el: Element) { observed.push(el); }
        unobserve(el: Element) { observed = observed.filter((o) => o !== el); }
        disconnect() {}
    });
});
afterEach(() => vi.unstubAllGlobals());

async function pill(lookup: () => Promise<typeof OA>) {
    const {createIndicatorPill} = await import("../../src/shared/indicator-pill");
    const wrapper = createIndicatorPill({doi: DOI, oaStatus: lookup});
    document.body.appendChild(wrapper);
    return wrapper;
}

const oaLit = (wrapper: HTMLElement) =>
    wrapper.querySelector("[data-flora-oa-segment]")!.getAttribute("title")!.includes("Free full text available");

describe("Open Access deferred until a pill is near the viewport", () => {
    it("asks for nothing while the pill is off screen", async () => {
        const lookup = vi.fn(async () => OA);
        await pill(lookup);
        await Promise.resolve();
        expect(lookup).not.toHaveBeenCalled();
        expect(observed).toHaveLength(1);
    });

    it("looks up once the pill nears the viewport, and lights the pill face", async () => {
        const lookup = vi.fn(async () => OA);
        const wrapper = await pill(lookup);
        fire(observed[0]);
        await vi.waitFor(() => expect(oaLit(wrapper)).toBe(true));
        expect(lookup).toHaveBeenCalledOnce();
        expect(observed).toHaveLength(0);
    });

    it("looks up when the popover opens before the pill was ever seen, and only once", async () => {
        const lookup = vi.fn(async () => OA);
        const wrapper = await pill(lookup);
        wrapper.querySelector<HTMLElement>("[role=button]")!.click();
        fire(observed[0]);
        await vi.waitFor(() => expect(oaLit(wrapper)).toBe(true));
        expect(lookup).toHaveBeenCalledOnce();
    });

    it("looks up when the popover is built without being opened", async () => {
        const lookup = vi.fn(async () => OA);
        const wrapper = await pill(lookup);
        const {ensurePopoverRows} = await import("../../src/shared/indicator-pill");
        ensurePopoverRows(wrapper);
        expect(lookup).toHaveBeenCalledOnce();
    });

    it("stops watching pills the page removed before they were ever seen", async () => {
        vi.useFakeTimers();
        const {createIndicatorPill} = await import("../../src/shared/indicator-pill");
        const removed = Array.from({length: 70}, (_, i) => {
            const wrapper = createIndicatorPill({doi: `10.1234/gone.${i}` as DoiString, oaStatus: async () => OA});
            document.body.appendChild(wrapper);
            return wrapper;
        });
        for (const wrapper of removed) wrapper.remove();
        const kept = createIndicatorPill({doi: DOI, oaStatus: async () => OA});
        document.body.appendChild(kept);
        await vi.runOnlyPendingTimersAsync();
        vi.useRealTimers();
        expect(observed).toHaveLength(1);
        expect(kept.contains(observed[0])).toBe(true);
    });

    it("still starts a promise passed directly, for the article's own pill", async () => {
        const {createIndicatorPill} = await import("../../src/shared/indicator-pill");
        const wrapper = createIndicatorPill({doi: DOI, oaStatus: Promise.resolve(OA)});
        document.body.appendChild(wrapper);
        await vi.waitFor(() => expect(oaLit(wrapper)).toBe(true));
        expect(observed).toHaveLength(0);
    });
});
