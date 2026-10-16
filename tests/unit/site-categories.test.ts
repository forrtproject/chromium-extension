import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SITE_CATEGORIES, siteDomains} from "../../src/shared/site-categories";

let syncStore: Record<string, unknown> = {};
let localStore: Record<string, unknown> = {};
const originalLocal = {get: chrome.storage.local.get, set: chrome.storage.local.set};

function fakeArea(store: () => Record<string, unknown>) {
    return {
        get: vi.fn((keys: string | string[]) => {
            const names = typeof keys === "string" ? [keys] : keys;
            return Promise.resolve(Object.fromEntries(names.filter((n) => n in store()).map((n) => [n, store()[n]])));
        }),
        set: vi.fn((items: Record<string, unknown>) => {
            Object.assign(store(), items);
            return Promise.resolve();
        }),
    };
}

beforeEach(() => {
    syncStore = {};
    localStore = {};
    const sync = fakeArea(() => syncStore);
    const local = fakeArea(() => localStore);
    chrome.storage.sync.get = sync.get as unknown as typeof chrome.storage.sync.get;
    chrome.storage.sync.set = sync.set as unknown as typeof chrome.storage.sync.set;
    chrome.storage.local.get = local.get as unknown as typeof chrome.storage.local.get;
    chrome.storage.local.set = local.set as unknown as typeof chrome.storage.local.set;
});

afterEach(() => {
    chrome.storage.local.get = originalLocal.get;
    chrome.storage.local.set = originalLocal.set;
    vi.resetModules();
});

async function mountPicker(onChange?: (message: string) => void): Promise<HTMLDivElement> {
    const {mountSiteCategoryPicker} = await import("../../src/shared/site-category-picker");
    const container = document.createElement("div");
    document.body.replaceChildren(container);
    mountSiteCategoryPicker(container, onChange);
    await vi.waitFor(() => expect(container.querySelector("details")).not.toBeNull());
    return container;
}

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
        expect(localStore.flora_disabled_sites).toEqual(["reddit.com"]);
    });

    it("switches off Google Search on its country sites by default, but not Scholar", async () => {
        const {isDomainBlocked} = await import("../../src/shared/domains");
        for (const host of ["www.google.co.uk", "www.google.de", "www.google.com.au"]) {
            await expect(isDomainBlocked(host), host).resolves.toBe(true);
        }
        for (const host of ["scholar.google.co.uk", "scholar.google.de", "docs.google.com"]) {
            await expect(isDomainBlocked(host), host).resolves.toBe(false);
        }
    });

    it("covers every Scholar country with a Google Search country site", () => {
        const sites = SITE_CATEGORIES.flatMap((c) => c.sites);
        const scholar = sites.find((s) => s.domain === "scholar.google.com")!;
        const search = sites.find((s) => s.domain === "www.google.com")!;
        expect(siteDomains(search)).toEqual(siteDomains(scholar).map((d) => d.replace(/^scholar\./, "www.")));
    });

    it("keeps the off-by-default sites off when storage cannot be read", async () => {
        const read = chrome.storage.local.get;
        chrome.storage.local.get = vi.fn((keys: string | string[]) => keys === "flora_disabled_sites"
            ? Promise.reject(new Error("unavailable")) : read(keys)) as unknown as typeof chrome.storage.local.get;
        const {isDomainBlocked} = await import("../../src/shared/domains");
        await expect(isDomainBlocked("www.youtube.com")).resolves.toBe(true);
        await expect(isDomainBlocked("www.nature.com")).resolves.toBe(false);
    });

    it("stores the choice on this device, so a large selection is not held to the sync item quota", async () => {
        const {saveDisabledSites} = await import("../../src/shared/domains");
        const everything = SITE_CATEGORIES.flatMap((category) => category.sites.flatMap(siteDomains)).sort();
        expect(JSON.stringify(everything).length).toBeGreaterThan(8192);
        await saveDisabledSites(everything);
        expect(localStore.flora_disabled_sites).toEqual(everything);
        expect(syncStore.flora_disabled_sites).toBeUndefined();
        vi.resetModules();
        const reloaded = await import("../../src/shared/domains");
        await expect(reloaded.getDisabledSites()).resolves.toEqual(everything);
    });

    it("carries over a choice saved to sync by an earlier version", async () => {
        syncStore.flora_disabled_sites = ["reddit.com"];
        const {getDisabledSites, isDomainBlocked} = await import("../../src/shared/domains");
        await expect(getDisabledSites()).resolves.toEqual(["reddit.com"]);
        await expect(isDomainBlocked("www.youtube.com")).resolves.toBe(false);
        expect(localStore.flora_disabled_sites).toEqual(["reddit.com"]);
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
        expect(normaliseSiteInput("https://www.Journals.Example.org/article/1?x=2")).toBe("www.journals.example.org");
        expect(normaliseSiteInput("https://Journals.Example.org/")).toBe("journals.example.org");
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

describe("site picker", () => {
    it("matches a catalog site typed with or without www", async () => {
        const container = await mountPicker();
        const error = container.querySelector(".site-add-error")!;
        for (const typed of ["https://www.google.com/search?q=x", "google.com", "bing.com"]) {
            container.querySelector<HTMLInputElement>(".site-add input")!.value = typed;
            container.querySelector("form")!.dispatchEvent(new Event("submit", {cancelable: true}));
            await vi.waitFor(() => expect(error.textContent).toContain("is already listed under Web search."));
            error.textContent = "";
        }
        expect(syncStore.flora_custom_sites).toBeUndefined();
    });

    it("keeps the www host a user adds", async () => {
        const container = await mountPicker();
        container.querySelector<HTMLInputElement>(".site-add input")!.value = "www.my-lab.example.org";
        container.querySelector("form")!.dispatchEvent(new Event("submit", {cancelable: true}));
        await vi.waitFor(() => expect(syncStore.flora_custom_sites).toEqual(["www.my-lab.example.org"]));
    });

    it("keeps the add form disabled until saved choices have loaded", async () => {
        let finish!: (value: Record<string, unknown>) => void;
        chrome.storage.local.get = vi.fn(() => new Promise((resolve) => { finish = resolve; })) as unknown as typeof chrome.storage.local.get;
        const {mountSiteCategoryPicker} = await import("../../src/shared/site-category-picker");
        const container = document.createElement("div");
        mountSiteCategoryPicker(container);
        const input = container.querySelector<HTMLInputElement>(".site-add input")!;
        const button = container.querySelector<HTMLButtonElement>(".site-add button")!;
        expect(input.disabled && button.disabled).toBe(true);
        finish({});
        await vi.waitFor(() => expect(container.querySelector("details")).not.toBeNull());
        expect(input.disabled || button.disabled).toBe(false);
    });

    it("reports a failed save instead of confirming it, and restores the checkbox", async () => {
        const onChange = vi.fn();
        const container = await mountPicker(onChange);
        chrome.storage.local.set = vi.fn().mockRejectedValue(new Error("QUOTA_BYTES_PER_ITEM quota exceeded"));
        const box = container.querySelector<HTMLInputElement>('details[data-category="publishers"] summary input')!;
        box.click();
        await vi.waitFor(() => expect(container.querySelector<HTMLElement>(".site-add-error")!.hidden).toBe(false));
        expect(onChange).not.toHaveBeenCalled();
        expect(container.querySelector<HTMLInputElement>('details[data-category="publishers"] summary input')!.checked).toBe(true);
        const {isDomainBlocked} = await import("../../src/shared/domains");
        await expect(isDomainBlocked("academic.oup.com")).resolves.toBe(false);
    });

    it("keeps a custom site's remove button outside its checkbox label", async () => {
        syncStore.flora_custom_sites = ["my-lab.example.org"];
        const container = await mountPicker();
        const remove = container.querySelector<HTMLButtonElement>(".site-remove")!;
        expect(remove.closest("label")).toBeNull();
        expect(remove.parentElement!.querySelector(".site-option input")).not.toBeNull();
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
        await vi.waitFor(() => expect(localStore.flora_disabled_sites).toEqual(expect.arrayContaining(siteDomains(scholar[0]))));
        const {isDomainBlocked} = await import("../../src/shared/domains");
        await expect(isDomainBlocked("scholar.google.de")).resolves.toBe(true);
    });
});
