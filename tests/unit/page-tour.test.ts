import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../../src/shared/pubpeer-api", () => ({lookupPubPeerForDoi: vi.fn(() => new Promise(() => {}))}));

import {REFERENCE_ENTRY_ATTR} from "../../src/shared/flora-ui";
import {LOOSE_PILL_ATTR} from "../../src/content-general/loose-dois";
import type {DoiString} from "../../src/shared/types";

const doi = (s: string) => s as DoiString;
let store: Record<string, unknown>;

beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    document.getElementById("flora-page-tour")?.remove();
    Element.prototype.scrollIntoView = vi.fn();
    store = {};
    chrome.storage.local.get = vi.fn(async (key: string) => (key in store ? {[key]: store[key]} : {})) as never;
    chrome.storage.local.set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items); }) as never;
});
afterEach(() => vi.useRealTimers());

async function articlePage({notice = false} = {}): Promise<void> {
    const {createIndicatorPill} = await import("../../src/shared/indicator-pill");
    const title = createIndicatorPill({doi: doi("10.1/article")});
    title.setAttribute("data-flora-title-pill", "");
    const entry = document.createElement("li");
    entry.setAttribute(REFERENCE_ENTRY_ATTR, "true");
    entry.appendChild(createIndicatorPill({
        doi: doi("10.1/ref"),
        retraction: notice ? {originDoi: doi("10.1/ref"), doi: doi("10.9/n"), kind: "retraction"} : null,
    }));
    const loose = createIndicatorPill({doi: doi("10.1/loose")});
    loose.setAttribute(LOOSE_PILL_ATTR, "");
    const panel = document.createElement("div");
    panel.id = "flora-pubpeer-panel";
    panel.innerHTML = `<button data-flora-panel-tab aria-label="Open the FORRT ORE panel"></button>`;
    document.body.append(title, entry, loose, panel);
}

const card = () => document.getElementById("flora-page-tour")?.shadowRoot?.querySelector<HTMLElement>(".card") ?? null;
const cardTitle = () => card()?.querySelector("h2")?.textContent ?? "";
const press = (selector: string) => card()!.querySelector<HTMLButtonElement>(selector)!.click();

describe("the on-page tour of an article", () => {
    it("visits what is on the page in reading order", async () => {
        await articlePage();
        const {articleTourStops} = await import("../../src/shared/page-tour");
        expect(articleTourStops().map((s) => s.title)).toEqual([
            "This pill is about the article you are reading",
            "Point at a pill to see the details",
            "Every paper in the reference list gets one",
            "So does a DOI mentioned in the text",
            "Everything in one place",
        ]);
    });

    it("skips stops the page does not have, and adds a retraction when there is one", async () => {
        await articlePage({notice: true});
        document.querySelector(`[${LOOSE_PILL_ATTR}]`)!.remove();
        document.getElementById("flora-pubpeer-panel")!.remove();
        const {articleTourStops} = await import("../../src/shared/page-tour");
        const titles = articleTourStops().map((s) => s.title);
        expect(titles).not.toContain("So does a DOI mentioned in the text");
        expect(titles).not.toContain("Everything in one place");
        expect(titles).toContain("This paper has been retracted");
    });

    it("starts from a reference pill on a page with no pill for the article itself", async () => {
        await articlePage();
        document.querySelector("[data-flora-title-pill]")!.remove();
        const {articleTourStops} = await import("../../src/shared/page-tour");
        const stops = articleTourStops();
        expect(stops[0].title).toBe("Every paper in the reference list gets a pill");
        expect(stops[0].text).toContain("gets two pills");
        expect(stops.map((s) => s.title)).not.toContain("Every paper in the reference list gets one");
    });

    it("steps forward and back, opens the pill for its popover stop, and closes it again", async () => {
        await articlePage();
        const {startPageTour, isPageTourOpen} = await import("../../src/shared/page-tour");
        expect(startPageTour("article")).toBe(true);
        expect(cardTitle()).toBe("This pill is about the article you are reading");
        const titleButton = document.querySelector<HTMLElement>("[data-flora-title-pill] > [role=button]")!;

        press(".next");
        expect(cardTitle()).toBe("Point at a pill to see the details");
        expect(titleButton.getAttribute("aria-expanded")).toBe("true");

        press(".back");
        expect(cardTitle()).toBe("This pill is about the article you are reading");
        await vi.waitFor(() => expect(titleButton.getAttribute("aria-expanded")).toBe("false"));

        for (let i = 0; i < 4; i++) press(".next");
        expect(card()!.querySelector(".next")!.textContent).toBe("Done");
        press(".next");
        expect(isPageTourOpen()).toBe(false);
        expect(document.getElementById("flora-page-tour")).toBeNull();
    });

    it("closes on Escape", async () => {
        await articlePage();
        const {startPageTour, isPageTourOpen} = await import("../../src/shared/page-tour");
        startPageTour("article");
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
        expect(isPageTourOpen()).toBe(false);
    });

    it("reports that it cannot start on a page without anything from ORE", async () => {
        const {startPageTour} = await import("../../src/shared/page-tour");
        expect(startPageTour("article")).toBe(false);
        expect(card()).toBeNull();
    });
});

describe("the tour on search results", () => {
    it("explains the result panel and a DOI matched by title", async () => {
        const {createIndicatorPanel} = await import("../../src/shared/indicator-pill");
        document.body.append(
            createIndicatorPanel({doi: doi("10.1/first")}),
            createIndicatorPanel({doi: doi("10.1/matched"), isAugmented: true}),
        );
        const {searchTourStops} = await import("../../src/shared/page-tour");
        const stops = searchTourStops();
        expect(stops.map((s) => s.title)).toEqual(["ORE adds this panel to each result", "A dotted DOI was matched by title"]);
        expect(stops[1].target.getAttribute("data-flora-doi")).toBe("10.1/matched");
    });
});

describe("the first-run tour", () => {
    it("starts once, after the page's work settles, and never again", async () => {
        vi.useFakeTimers();
        await articlePage();
        const {offerFirstPageTour, isPageTourOpen, closePageTour} = await import("../../src/shared/page-tour");
        const offer = offerFirstPageTour("article", () => true);
        await vi.advanceTimersByTimeAsync(2000);
        await offer;
        expect(isPageTourOpen()).toBe(true);
        expect(store.flora_page_tour_seen).toEqual({article: true});
        closePageTour();

        vi.resetModules();
        const again = await import("../../src/shared/page-tour");
        const second = again.offerFirstPageTour("article", () => true);
        await vi.advanceTimersByTimeAsync(2000);
        await second;
        expect(again.isPageTourOpen()).toBe(false);
    });

    it("waits for a later pass when nothing is on the page yet", async () => {
        vi.useFakeTimers();
        const {offerFirstPageTour, isPageTourOpen} = await import("../../src/shared/page-tour");
        const empty = offerFirstPageTour("article", () => true);
        await vi.advanceTimersByTimeAsync(2000);
        await empty;
        expect(isPageTourOpen()).toBe(false);
        expect(store.flora_page_tour_seen).toBeUndefined();

        await articlePage();
        const later = offerFirstPageTour("article", () => true);
        await vi.advanceTimersByTimeAsync(2000);
        await later;
        expect(isPageTourOpen()).toBe(true);
    });

    it("stays away while ORE is hidden on the page", async () => {
        vi.useFakeTimers();
        await articlePage();
        const {offerFirstPageTour, isPageTourOpen} = await import("../../src/shared/page-tour");
        const offer = offerFirstPageTour("article", () => false);
        await vi.advanceTimersByTimeAsync(2000);
        await offer;
        expect(isPageTourOpen()).toBe(false);
        expect(store.flora_page_tour_seen).toBeUndefined();
    });
});
