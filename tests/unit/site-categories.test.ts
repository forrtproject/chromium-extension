import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SITE_CATEGORIES, siteDomains} from "../../src/shared/site-categories";

let syncStore: Record<string, unknown> = {};

beforeEach(() => {
    syncStore = {};
    chrome.storage.sync.get = vi.fn((keys: string | string[]) => {
        const names = typeof keys === "string" ? [keys] : keys;
        return Promise.resolve(Object.fromEntries(names.filter((n) => n in syncStore).map((n) => [n, syncStore[n]])));
    }) as unknown as typeof chrome.storage.sync.get;
    chrome.storage.sync.set = vi.fn((items: Record<string, unknown>) => {
        Object.assign(syncStore, items);
        return Promise.resolve();
    }) as unknown as typeof chrome.storage.sync.set;
});

afterEach(() => {
    vi.resetModules();
});

describe("sites switched off by category", () => {
    it("starts with publishers on and shopping, video, messaging and web search off", async () => {
        const {isDomainBlocked} = await import("../../src/shared/domains");
        for (const host of ["journals.sagepub.com", "www.nature.com", "link.springer.com", "osf.io", "docs.google.com", "www.reddit.com", "unlisted.example"]) {
            await expect(isDomainBlocked(host), host).resolves.toBe(false);
        }
        for (const host of ["www.youtube.com", "www.amazon.com", "mail.google.com", "www.google.com"]) {
            await expect(isDomainBlocked(host), host).resolves.toBe(true);
        }
    });

    it("keeps the user's choice once they have made one", async () => {
        const {isDomainBlocked, saveDisabledSites} = await import("../../src/shared/domains");
        await saveDisabledSites([]);
        await expect(isDomainBlocked("www.youtube.com")).resolves.toBe(false);
    });

    it("lists every off-by-default site in the catalog", async () => {
        const {DEFAULT_DISABLED_SITES} = await import("../../src/shared/site-categories-off");
        const catalog = new Set(SITE_CATEGORIES.flatMap((category) => category.sites.flatMap(siteDomains)));
        expect(DEFAULT_DISABLED_SITES.every((d) => catalog.has(d))).toBe(true);
    });

    it("blocks a switched-off site and its subdomains", async () => {
        const {isDomainBlocked, saveDisabledSites} = await import("../../src/shared/domains");
        await saveDisabledSites(["reddit.com"]);
        await expect(isDomainBlocked("reddit.com")).resolves.toBe(true);
        await expect(isDomainBlocked("old.reddit.com")).resolves.toBe(true);
        await expect(isDomainBlocked("notreddit.com")).resolves.toBe(false);
        expect(syncStore.flora_disabled_sites).toEqual(["reddit.com"]);
    });

    it("leaves Scholar and Docs alone when Google Search is switched off", async () => {
        const {isDomainBlocked, saveDisabledSites} = await import("../../src/shared/domains");
        await saveDisabledSites(["www.google.com"]);
        await expect(isDomainBlocked("www.google.com")).resolves.toBe(true);
        await expect(isDomainBlocked("scholar.google.com")).resolves.toBe(false);
        await expect(isDomainBlocked("docs.google.com")).resolves.toBe(false);
    });

    it("lists every site once, under one category", () => {
        const domains = SITE_CATEGORIES.flatMap((category) => category.sites.flatMap(siteDomains));
        expect(new Set(domains).size).toBe(domains.length);
        expect(domains.every((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))).toBe(true);
    });
});

describe("adding a site of your own", () => {
    it("reduces what the user typed to a bare host", async () => {
        const {normaliseSiteInput} = await import("../../src/shared/domains");
        expect(normaliseSiteInput("https://www.Journals.Example.org/article/1?x=2")).toBe("journals.example.org");
        expect(normaliseSiteInput("  example.org:8080 ")).toBe("example.org");
        expect(normaliseSiteInput("not a domain")).toBeNull();
        expect(normaliseSiteInput("localhost")).toBeNull();
    });

    it("lists an added site under Your sites, and removes it again", async () => {
        const {mountSiteCategoryPicker} = await import("../../src/shared/site-category-picker");
        const container = document.createElement("div");
        document.body.replaceChildren(container);
        mountSiteCategoryPicker(container);
        await vi.waitFor(() => expect(container.querySelector("details")).not.toBeNull());

        const input = container.querySelector<HTMLInputElement>(".site-add input")!;
        input.value = "https://my-lab-journal.example.org/paper";
        container.querySelector("form")!.dispatchEvent(new Event("submit", {cancelable: true}));
        await vi.waitFor(() => expect(container.querySelector('details[data-category="custom"]')).not.toBeNull());
        expect(syncStore.flora_custom_sites).toEqual(["my-lab-journal.example.org"]);
        const custom = container.querySelector<HTMLDetailsElement>('details[data-category="custom"]')!;
        expect(custom.open).toBe(true);
        expect(custom.textContent).toContain("my-lab-journal.example.org");

        custom.querySelector<HTMLButtonElement>(".site-remove")!.click();
        await vi.waitFor(() => expect(container.querySelector('details[data-category="custom"]')).toBeNull());
        expect(syncStore.flora_custom_sites).toEqual([]);
    });

    it("points to the category that already lists a site", async () => {
        const {mountSiteCategoryPicker} = await import("../../src/shared/site-category-picker");
        const container = document.createElement("div");
        document.body.replaceChildren(container);
        mountSiteCategoryPicker(container);
        await vi.waitFor(() => expect(container.querySelector("details")).not.toBeNull());

        container.querySelector<HTMLInputElement>(".site-add input")!.value = "www.tandfonline.com";
        container.querySelector("form")!.dispatchEvent(new Event("submit", {cancelable: true}));
        await vi.waitFor(() => expect(container.querySelector(".site-add-error")!.textContent)
            .toBe("tandfonline.com is already listed under Major publishers & university presses."));
        expect(syncStore.flora_custom_sites).toBeUndefined();
    });
});

describe("Google Scholar", () => {
    it("is one entry that switches every country site together", async () => {
        const scholar = SITE_CATEGORIES.flatMap((c) => c.sites).filter((site) => siteDomains(site).some((d) => d.startsWith("scholar.google.")));
        expect(scholar).toHaveLength(1);
        expect(siteDomains(scholar[0])).toContain("scholar.google.co.uk");

        const {mountSiteCategoryPicker} = await import("../../src/shared/site-category-picker");
        const container = document.createElement("div");
        document.body.replaceChildren(container);
        mountSiteCategoryPicker(container);
        await vi.waitFor(() => expect(container.querySelector('details[data-category="search-discovery"]')).not.toBeNull());
        const box = [...container.querySelectorAll<HTMLLabelElement>(".site-option")]
            .find((label) => label.textContent?.startsWith("Google Scholar"))!.querySelector("input")!;
        box.click();
        await vi.waitFor(() => expect(syncStore.flora_disabled_sites).toEqual(expect.arrayContaining(siteDomains(scholar[0]))));
        const {isDomainBlocked} = await import("../../src/shared/domains");
        await expect(isDomainBlocked("scholar.google.de")).resolves.toBe(true);
    });
});
