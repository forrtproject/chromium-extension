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
afterEach(async () => {
    (await import("../../src/shared/page-tour")).closePageTour();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

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
    panel.innerHTML = `<button data-flora-panel-tab aria-label="Open the ORE report"></button>`;
    document.body.append(title, entry, loose, panel);
}

const card = () => document.getElementById("flora-page-tour")?.shadowRoot?.querySelector<HTMLElement>(".card") ?? null;
const cardTitle = () => card()?.querySelector("h2")?.textContent ?? "";
const press = (selector: string) => card()!.querySelector<HTMLButtonElement>(selector)!.click();

describe("the on-page tour of an article", () => {
    it("stops at a pill, its details and the report tab, naming the other pills on the way", async () => {
        await articlePage();
        const {articleTourStops} = await import("../../src/shared/page-tour");
        const stops = articleTourStops();
        expect(stops.map((s) => s.title)).toEqual([
            "Findings for this article",
            "Point at a pill to see the details",
            "Everything in one place",
        ]);
        expect(stops[0].text).toBe("ORE adds the same pill to each paper in the reference list and each DOI mentioned in the text.");
    });

    it("skips stops the page does not have, and adds a retraction when there is one", async () => {
        await articlePage({notice: true});
        document.querySelector(`[${LOOSE_PILL_ATTR}]`)!.remove();
        document.getElementById("flora-pubpeer-panel")!.remove();
        const {articleTourStops} = await import("../../src/shared/page-tour");
        const titles = articleTourStops().map((s) => s.title);
        expect(titles).not.toContain("Everything in one place");
        expect(titles).toContain("This paper has been retracted");
    });

    it("starts from a reference pill on a page with no pill for the article itself", async () => {
        await articlePage();
        document.querySelector("[data-flora-title-pill]")!.remove();
        const {articleTourStops} = await import("../../src/shared/page-tour");
        const stops = articleTourStops();
        expect(stops[0].title).toBe("Identified papers in the reference list get a pill");
        expect(stops[0].text).toBe("A reference without a pill is one ORE could not identify. ORE adds the same pill to each DOI mentioned in the text.");
    });

    it("steps forward and back, opens the pill for its popover stop, and closes it again", async () => {
        await articlePage();
        const {startPageTour, isPageTourOpen} = await import("../../src/shared/page-tour");
        expect(startPageTour("article")).toBe(true);
        expect(cardTitle()).toBe("Findings for this article");
        const titleButton = document.querySelector<HTMLElement>("[data-flora-title-pill] > [role=button]")!;

        press(".next");
        expect(cardTitle()).toBe("Point at a pill to see the details");
        expect(titleButton.getAttribute("aria-expanded")).toBe("true");

        press(".back");
        expect(cardTitle()).toBe("Findings for this article");
        await vi.waitFor(() => expect(titleButton.getAttribute("aria-expanded")).toBe("false"));

        for (let i = 0; i < 2; i++) press(".next");
        expect(card()!.querySelector(".next")!.textContent).toBe("Done");
        expect(card()!.querySelector<HTMLElement>(".skip")!.style.visibility).toBe("hidden");
        press(".next");
        expect(isPageTourOpen()).toBe(false);
        expect(document.getElementById("flora-page-tour")).toBeNull();
    });

    it("gives focus back to where the reader was when it closes", async () => {
        await articlePage();
        const before = document.createElement("button");
        document.body.appendChild(before);
        before.focus();
        const {startPageTour, closePageTour} = await import("../../src/shared/page-tour");
        startPageTour("article");
        expect(document.activeElement).not.toBe(before);
        closePageTour();
        expect(document.activeElement).toBe(before);
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

describe("a tour asked for while the page is still being checked", () => {
    it("waits for the pass and starts on the pills it painted", async () => {
        const {beginWorkIndicator, endWorkIndicator} = await import("../../src/shared/progress-toast");
        const {startPageTourOnceIdle, isPageTourOpen} = await import("../../src/shared/page-tour");
        beginWorkIndicator();
        const started = startPageTourOnceIdle("article", () => true);
        await Promise.resolve();
        expect(isPageTourOpen()).toBe(false);

        await articlePage();
        endWorkIndicator();
        await expect(started).resolves.toBe(true);
        expect(isPageTourOpen()).toBe(true);
    });

    it("starts straight away on a page with no work running", async () => {
        await articlePage();
        const {startPageTourOnceIdle} = await import("../../src/shared/page-tour");
        await expect(startPageTourOnceIdle("article", () => true)).resolves.toBe(true);
    });

    it("waits past an early title pill so the tour includes what the pass paints later", async () => {
        await articlePage();
        const reference = document.querySelector(`[${REFERENCE_ENTRY_ATTR}]`)!;
        reference.remove();
        const {beginWorkIndicator, endWorkIndicator} = await import("../../src/shared/progress-toast");
        const {startPageTourOnceIdle, isPageTourOpen} = await import("../../src/shared/page-tour");
        beginWorkIndicator();
        const started = startPageTourOnceIdle("article", () => true);
        await Promise.resolve();
        expect(isPageTourOpen()).toBe(false);

        document.body.append(reference);
        endWorkIndicator();
        await expect(started).resolves.toBe(true);
        expect(cardTitle()).toBe("Findings for this article");
        expect(card()!.querySelector("p")!.textContent).toContain("each paper in the reference list");
    });

    it("does not start once the reader has cancelled", async () => {
        await articlePage();
        const {beginWorkIndicator, endWorkIndicator} = await import("../../src/shared/progress-toast");
        const {cancelPageTourStart, startPageTourOnceIdle, isPageTourOpen} = await import("../../src/shared/page-tour");
        beginWorkIndicator();
        const started = startPageTourOnceIdle("article", () => true);
        cancelPageTourStart();
        endWorkIndicator();
        await expect(started).resolves.toBe(false);
        expect(isPageTourOpen()).toBe(false);
    });

    it("answers at once when ORE is hidden, without waiting for the pass", async () => {
        const {beginWorkIndicator, endWorkIndicator} = await import("../../src/shared/progress-toast");
        const {startPageTourOnceIdle} = await import("../../src/shared/page-tour");
        beginWorkIndicator();
        await expect(startPageTourOnceIdle("article", () => false)).resolves.toBe(false);
        endWorkIndicator();
    });

    it("does not start on the page an SPA navigated to during the wait", async () => {
        await articlePage();
        vi.stubGlobal("location", new URL("https://example.org/first"));
        const {beginWorkIndicator, endWorkIndicator} = await import("../../src/shared/progress-toast");
        const {startPageTourOnceIdle, isPageTourOpen} = await import("../../src/shared/page-tour");
        beginWorkIndicator();
        const started = startPageTourOnceIdle("article", () => true);
        vi.stubGlobal("location", new URL("https://example.org/second"));
        endWorkIndicator();
        await expect(started).resolves.toBe(false);
        expect(isPageTourOpen()).toBe(false);
    });

    it("still starts after a jump to a fragment on the same page", async () => {
        await articlePage();
        vi.stubGlobal("location", new URL("https://example.org/first"));
        const {beginWorkIndicator, endWorkIndicator} = await import("../../src/shared/progress-toast");
        const {startPageTourOnceIdle} = await import("../../src/shared/page-tour");
        beginWorkIndicator();
        const started = startPageTourOnceIdle("article", () => true);
        vi.stubGlobal("location", new URL("https://example.org/first#ref-12"));
        endWorkIndicator();
        await expect(started).resolves.toBe(true);
    });

    it("waits for the page's startup before deciding there is nothing to show", async () => {
        const {startPageTourOnceIdle} = await import("../../src/shared/page-tour");
        let finishStartup!: () => void;
        const started = startPageTourOnceIdle("article", () => true, new Promise<void>((resolve) => { finishStartup = resolve; }));
        await new Promise((resolve) => setTimeout(resolve));
        await articlePage();
        finishStartup();
        await expect(started).resolves.toBe(true);
    });

    it("can be cancelled while the page is still starting up", async () => {
        await articlePage();
        const {cancelPageTourStart, startPageTourOnceIdle} = await import("../../src/shared/page-tour");
        let finishStartup!: () => void;
        const started = startPageTourOnceIdle("article", () => true, new Promise<void>((resolve) => { finishStartup = resolve; }));
        cancelPageTourStart();
        finishStartup();
        await expect(started).resolves.toBe(false);
    });

    it("reports failure once the pass ends with nothing to show", async () => {
        const {beginWorkIndicator, endWorkIndicator} = await import("../../src/shared/progress-toast");
        const {startPageTourOnceIdle} = await import("../../src/shared/page-tour");
        beginWorkIndicator();
        const started = startPageTourOnceIdle("article", () => true);
        endWorkIndicator();
        await expect(started).resolves.toBe(false);
    });

    it("does not start while ORE is hidden, even with pills on the page", async () => {
        await articlePage();
        const {startPageTourOnceIdle, isPageTourOpen} = await import("../../src/shared/page-tour");
        await expect(startPageTourOnceIdle("article", () => false)).resolves.toBe(false);
        expect(isPageTourOpen()).toBe(false);
    });
});

describe("the tour requested on the sample article", () => {
    const REQUEST_KEY = "flora_page_tour_request";

    async function onSampleArticle(): Promise<void> {
        const {TOUR_SAMPLE_URL} = await import("../../src/shared/tour-sample");
        vi.stubGlobal("location", new URL(TOUR_SAMPLE_URL));
    }

    afterEach(() => vi.unstubAllGlobals());

    beforeEach(() => {
        chrome.storage.local.remove = vi.fn(async (key: string) => { delete store[key]; }) as never;
    });

    it("runs even for a reader who has seen the tour, then clears the request", async () => {
        vi.useFakeTimers();
        await articlePage();
        await onSampleArticle();
        store.flora_page_tour_seen = {article: true};
        store[REQUEST_KEY] = Date.now() + 60_000;
        const {offerFirstPageTour, isPageTourOpen} = await import("../../src/shared/page-tour");
        const offer = offerFirstPageTour("article", () => true);
        await vi.advanceTimersByTimeAsync(2000);
        await offer;
        expect(isPageTourOpen()).toBe(true);
        expect(store[REQUEST_KEY]).toBeUndefined();
    });

    it("keeps the request for a later pass when no pill has painted yet", async () => {
        vi.useFakeTimers();
        await onSampleArticle();
        store[REQUEST_KEY] = Date.now() + 60_000;
        const {offerFirstPageTour, isPageTourOpen} = await import("../../src/shared/page-tour");
        const offer = offerFirstPageTour("article", () => true);
        await vi.advanceTimersByTimeAsync(2000);
        await offer;
        expect(isPageTourOpen()).toBe(false);
        expect(store[REQUEST_KEY]).toBeDefined();
    });

    it("keeps the request when the reader navigates off the sample during the wait", async () => {
        vi.useFakeTimers();
        await articlePage();
        await onSampleArticle();
        store.flora_page_tour_seen = {article: true};
        store[REQUEST_KEY] = Date.now() + 60_000;
        const {offerFirstPageTour, isPageTourOpen} = await import("../../src/shared/page-tour");
        const offer = offerFirstPageTour("article", () => true);
        await vi.advanceTimersByTimeAsync(0);
        vi.stubGlobal("location", new URL("https://example.org/elsewhere"));
        await vi.advanceTimersByTimeAsync(2000);
        await offer;
        expect(isPageTourOpen()).toBe(false);
        expect(store[REQUEST_KEY]).toBeDefined();

        const nextPage = offerFirstPageTour("article", () => true);
        await vi.advanceTimersByTimeAsync(2000);
        await nextPage;
        expect(isPageTourOpen()).toBe(false);
        expect(store[REQUEST_KEY]).toBeDefined();
    });

    it("ignores an expired request", async () => {
        vi.useFakeTimers();
        await articlePage();
        await onSampleArticle();
        store.flora_page_tour_seen = {article: true};
        store[REQUEST_KEY] = Date.now() - 1;
        const {offerFirstPageTour, isPageTourOpen} = await import("../../src/shared/page-tour");
        const offer = offerFirstPageTour("article", () => true);
        await vi.advanceTimersByTimeAsync(2000);
        await offer;
        expect(isPageTourOpen()).toBe(false);
    });

    it("ignores the request on any other page", async () => {
        vi.useFakeTimers();
        await articlePage();
        store.flora_page_tour_seen = {article: true};
        store[REQUEST_KEY] = Date.now() + 60_000;
        const {offerFirstPageTour, isPageTourOpen} = await import("../../src/shared/page-tour");
        const offer = offerFirstPageTour("article", () => true);
        await vi.advanceTimersByTimeAsync(2000);
        await offer;
        expect(isPageTourOpen()).toBe(false);
        expect(store[REQUEST_KEY]).toBeDefined();
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

    it("waits until the page pass has finished", async () => {
        vi.useFakeTimers();
        await articlePage();
        const {beginWorkIndicator, endWorkIndicator} = await import("../../src/shared/progress-toast");
        const {offerFirstPageTour, isPageTourOpen} = await import("../../src/shared/page-tour");
        beginWorkIndicator();
        const offer = offerFirstPageTour("article", () => true);
        await vi.advanceTimersByTimeAsync(5000);
        expect(isPageTourOpen()).toBe(false);
        endWorkIndicator();
        await vi.advanceTimersByTimeAsync(2000);
        await offer;
        expect(isPageTourOpen()).toBe(true);
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

    it("does not scroll a reader away from what they are reading", async () => {
        vi.useFakeTimers();
        await articlePage();
        const offScreen = {top: 5000, bottom: 5020, left: 10, right: 200, width: 190, height: 20, x: 10, y: 5000, toJSON: () => ({})};
        const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(offScreen as DOMRect);
        try {
            const {offerFirstPageTour, isPageTourOpen} = await import("../../src/shared/page-tour");
            const offer = offerFirstPageTour("article", () => true);
            await vi.advanceTimersByTimeAsync(2000);
            await offer;
            expect(isPageTourOpen()).toBe(false);
            expect(store.flora_page_tour_seen).toBeUndefined();
            expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
        } finally {
            rect.mockRestore();
        }
    });

    it("leaves the tour seen after the reader starts it from the popup", async () => {
        await articlePage();
        const {startPageTour} = await import("../../src/shared/page-tour");
        startPageTour("article");
        await vi.waitFor(() => expect(store.flora_page_tour_seen).toEqual({article: true}));
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
