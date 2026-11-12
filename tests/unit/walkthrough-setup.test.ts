import {beforeEach, describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";

vi.mock("../../src/walkthrough/demos", () => ({installOfflineFixtures: vi.fn(), mountDemos: vi.fn()}));
vi.mock("../../src/shared/site-category-picker", () => ({mountSiteCategoryPicker: vi.fn()}));

const WALKTHROUGH_HTML = readFileSync(join(__dirname, "..", "..", "src", "walkthrough", "index.html"), "utf-8");
const SETUP_STEP = 7;
const LAST_STEP = 8;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const emailInput = () => byId<HTMLInputElement>("wt-email-input");
const citationSelect = () => byId<HTMLSelectElement>("wt-citation-select");
const stepIsActive = (n: number) => byId(`step-${n}`).classList.contains("is-active");
const syncSet = () => chrome.storage.sync.set as unknown as ReturnType<typeof vi.fn>;

function savedSettings(): Record<string, unknown> | undefined {
    return syncSet().mock.lastCall?.[0]?.flora_settings;
}

function enterEmail(value: string): void {
    emailInput().value = value;
    emailInput().dispatchEvent(new Event("change"));
}

async function openWalkthrough(stored: Record<string, unknown> = {}): Promise<void> {
    vi.resetModules();
    document.body.innerHTML = new DOMParser().parseFromString(WALKTHROUGH_HTML, "text/html").body.innerHTML;
    chrome.storage.sync.get = vi.fn().mockResolvedValue({flora_settings: stored}) as never;
    chrome.storage.sync.set = vi.fn().mockResolvedValue(undefined) as never;
    const addListener = vi.spyOn(document, "addEventListener");
    await import("../../src/walkthrough/walkthrough");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    for (const [type, listener] of addListener.mock.calls) document.removeEventListener(type, listener as EventListener);
    addListener.mockRestore();
    await vi.waitFor(() => expect(citationSelect().value).not.toBe(""));
    await new Promise((resolve) => setTimeout(resolve));
    byId("skip-btn").click();
}

describe("the walkthrough's setup step", () => {
    beforeEach(() => {
        chrome.runtime.openOptionsPage = vi.fn() as never;
        window.close = vi.fn();
    });

    it("shows what is already saved", async () => {
        await openWalkthrough({email: "a@b.co", citationStyle: "ieee"});

        expect(emailInput().value).toBe("a@b.co");
        expect(citationSelect().value).toBe("ieee");
    });

    it("offers every citation style and defaults to APA", async () => {
        await openWalkthrough();

        expect(citationSelect().options.length).toBe(11);
        expect(citationSelect().value).toBe("apa");
    });

    it("saves a valid email when the field is left", async () => {
        await openWalkthrough();

        enterEmail("  me@uni.edu  ");

        await vi.waitFor(() => expect(savedSettings()?.email).toBe("me@uni.edu"));
        expect(byId("wt-email-status").textContent).toContain("Email saved");
    });

    it("saves the email when Enter submits the form", async () => {
        await openWalkthrough();

        emailInput().value = "me@uni.edu";
        byId("wt-email-form").dispatchEvent(new Event("submit", {cancelable: true}));

        await vi.waitFor(() => expect(savedSettings()?.email).toBe("me@uni.edu"));
    });

    it("does not save an unchanged email again", async () => {
        await openWalkthrough({email: "a@b.co"});

        enterEmail("a@b.co");
        await new Promise((resolve) => setTimeout(resolve));

        expect(syncSet()).not.toHaveBeenCalled();
    });

    it("removes the email when the field is cleared", async () => {
        await openWalkthrough({email: "a@b.co"});

        enterEmail("");

        await vi.waitFor(() => expect(savedSettings()?.email).toBe(""));
        expect(byId("wt-email-status").textContent).toContain("Email removed");
    });

    it("keeps the reader on the step until an invalid email is fixed", async () => {
        await openWalkthrough();

        enterEmail("not-an-email");
        byId("next-btn").click();

        expect(syncSet()).not.toHaveBeenCalled();
        expect(stepIsActive(SETUP_STEP)).toBe(true);
        expect(byId("wt-email-status").textContent).toContain("doesn't look like");

        enterEmail("me@uni.edu");
        byId("next-btn").click();

        expect(stepIsActive(LAST_STEP)).toBe(true);
    });

    it("says so when the email cannot be saved", async () => {
        await openWalkthrough();
        chrome.storage.sync.set = vi.fn().mockRejectedValue(new Error("quota")) as never;

        enterEmail("me@uni.edu");

        await vi.waitFor(() => expect(byId("wt-email-status").textContent).toContain("Couldn't save"));
    });

    it("saves the chosen citation style straight away", async () => {
        await openWalkthrough();

        citationSelect().value = "bibtex";
        citationSelect().dispatchEvent(new Event("change"));

        await vi.waitFor(() => expect(savedSettings()?.citationStyle).toBe("bibtex"));
        expect(byId("wt-citation-status").textContent).toContain("BibTeX");
    });

    it("ends on a success message instead of opening Settings", async () => {
        await openWalkthrough();

        byId("next-btn").click();
        expect(byId("next-btn").textContent).toBe("Finish");
        byId("next-btn").click();

        expect(byId("wt-done").classList.contains("is-active")).toBe(true);
        expect(byId("wt-done").textContent).toContain("ORE will check papers automatically");
        expect(stepIsActive(LAST_STEP)).toBe(false);
        expect(document.querySelector<HTMLElement>(".wt-nav")!.hidden).toBe(true);
        expect(window.close).not.toHaveBeenCalled();
        expect(chrome.runtime.openOptionsPage).not.toHaveBeenCalled();

        byId("done-close-btn").click();
        expect(window.close).toHaveBeenCalled();
    });
});
