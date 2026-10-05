import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {isIssueFormUrl} from "../../src/shared/debug-report";

type Call = {tabId: number; [key: string]: unknown};

const icon: Call[] = [];
const title: Call[] = [];
const badge: Call[] = [];
const badgeColour: string[] = [];
const popup: Call[] = [];
let session: Map<string, unknown>;

const GRAY = {16: "/dist/icons/gray-16.png", 32: "/dist/icons/gray-32.png"};
const MAROON = {16: "/dist/icons/maroon-16.png", 32: "/dist/icons/maroon-32.png"};
const CLEAR = {16: "/dist/icons/clear-16.png", 32: "/dist/icons/clear-32.png"};
const NOTE = " — some checks unavailable, results incomplete";

function installSpies(): void {
    const action = chrome.action as unknown as Record<string, unknown>;
    action.setIcon = vi.fn(async (a: Call) => { icon.push(a); });
    action.setTitle = vi.fn(async (a: Call) => { title.push(a); });
    action.setBadgeText = vi.fn(async (a: Call) => { badge.push(a); });
    action.setBadgeBackgroundColor = vi.fn(async (a: {color: string}) => { badgeColour.push(a.color); });
    action.setPopup = vi.fn(async (a: Call) => { popup.push(a); });
    action.openPopup = vi.fn(async () => undefined);
    const store = chrome.storage.session as unknown as Record<string, unknown>;
    store.get = vi.fn(async (key: string) => (session.has(key) ? {[key]: session.get(key)} : {}));
    store.set = vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) session.set(k, v);
    });
    store.remove = vi.fn(async (key: string) => { session.delete(key); });
    (chrome.tabs as unknown as Record<string, unknown>).create = vi.fn(async () => undefined);
}

async function deliver(message: unknown, tabId?: number): Promise<void> {
    const listener = (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>)
        .mock.calls.map(([fn]) => fn as (m: unknown, s: unknown, r: unknown) => unknown).at(-1)!;
    listener(message, tabId == null ? {} : {tab: {id: tabId}}, () => undefined);
    await Promise.resolve();
}

function scan(state: unknown, tabId = 1): Promise<void> {
    return deliver({type: "FLORA_SCAN_STATE", state}, tabId);
}

function lastListener<T>(spy: unknown): T {
    return (spy as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as T;
}

const errorState = {
    phase: "error",
    pageUrl: "https://example.org/paper?id=1",
    error: {message: "TypeError: boom", where: "scan"},
    entries: [{t: 1, level: "error", ctx: "example.org", msg: "kaboom"}],
};

describe("the toolbar reflects scan progress and results", () => {
    beforeEach(async () => {
        icon.length = title.length = badge.length = badgeColour.length = popup.length = 0;
        session = new Map();
        installSpies();
        vi.resetModules();
        await import("../../src/background/service-worker");
    });

    it("shows a gray scanning icon with an ellipsis badge", async () => {
        await scan({phase: "scanning", papers: 0});

        expect(icon.at(-1)!.path).toEqual(GRAY);
        expect(title.at(-1)!.title).toBe("FORRT ORE — checking this page…");
        expect(badge.at(-1)!.text).toBe("…");
        expect(badgeColour.at(-1)).toBe("#5f6368");
    });

    it("counts the papers being checked", async () => {
        await scan({phase: "scanning", papers: 1});
        expect(title.at(-1)!.title).toBe("FORRT ORE — checking 1 paper…");

        await scan({phase: "scanning", papers: 3});
        expect(title.at(-1)!.title).toBe("FORRT ORE — checking 3 papers…");
    });

    it("shows the green icon when nothing was flagged", async () => {
        await scan({phase: "done", papers: 4, flagged: 0, incomplete: false});

        expect(icon.at(-1)!.path).toEqual(CLEAR);
        expect(title.at(-1)!.title).toBe("FORRT ORE — no flags: checked 4 papers");
        expect(badge.at(-1)!.text).toBe("");
    });

    it("warns when nothing was flagged but some checks failed", async () => {
        await scan({phase: "done", papers: 4, flagged: 0, incomplete: true});

        expect(icon.at(-1)!.path).toEqual(CLEAR);
        expect(badge.at(-1)!.text).toBe("!");
        expect(badgeColour.at(-1)).toBe("#b45309");
        expect(title.at(-1)!.title).toBe(`FORRT ORE — no flags: checked 4 papers${NOTE}`);
    });

    it("shows the maroon icon and count when papers are flagged", async () => {
        await scan({phase: "done", papers: 5, flagged: 2, incomplete: false});

        expect(icon.at(-1)!.path).toEqual(MAROON);
        expect(badge.at(-1)!.text).toBe("2");
        expect(badgeColour.at(-1)).toBe("#853953");
        expect(title.at(-1)!.title).toBe("FORRT ORE — 2 papers flagged");
    });

    it("turns the flagged badge amber and says so when checks are incomplete", async () => {
        await scan({phase: "done", papers: 5, flagged: 1, incomplete: true});

        expect(badge.at(-1)!.text).toBe("1");
        expect(badgeColour.at(-1)).toBe("#b45309");
        expect(title.at(-1)!.title).toBe(`FORRT ORE — 1 paper flagged${NOTE}`);
    });

    it("caps a large flagged count", async () => {
        await scan({phase: "done", papers: 200, flagged: 150, incomplete: false});

        expect(badge.at(-1)!.text).toBe("99+");
    });

    it("ignores scan states with no tab", async () => {
        await deliver({type: "FLORA_SCAN_STATE", state: {phase: "scanning", papers: 1}});

        expect(icon).toHaveLength(0);
    });

    it("ignores malformed scan states", async () => {
        await scan({phase: "done", papers: 1});

        expect(icon).toHaveLength(0);
    });

    describe("an error", () => {
        it("makes the toolbar click report a bug instead of opening the popup", async () => {
            await scan(errorState, 7);

            expect(popup.at(-1)).toEqual({tabId: 7, popup: ""});
            expect(session.has("flora_tab_error:7")).toBe(true);
            expect(icon.at(-1)!.path).toEqual(GRAY);
            expect(badge.at(-1)!.text).toBe("!");
            expect(badgeColour.at(-1)).toBe("#b91c1c");
            expect(title.at(-1)!.title).toBe("FORRT ORE — something went wrong. Click to report a bug");
        });

        it("gives the popup back on the next scan state", async () => {
            await scan(errorState, 7);
            await scan({phase: "done", papers: 1, flagged: 0, incomplete: false}, 7);

            expect(popup.at(-1)).toEqual({tabId: 7, popup: "dist/popup.html"});
            expect(session.has("flora_tab_error:7")).toBe(false);
        });

        it("gives the popup back on an active state", async () => {
            await scan(errorState, 7);
            await deliver({type: "FLORA_ACTIVE_STATE", active: true, snoozedUntil: null}, 7);

            expect(popup.at(-1)).toEqual({tabId: 7, popup: "dist/popup.html"});
            expect(session.has("flora_tab_error:7")).toBe(false);
        });

        it("opens a prefilled issue when the toolbar is clicked on the same page", async () => {
            await scan(errorState, 7);
            const onClicked = lastListener<(tab: {id: number; url: string}) => void>(chrome.action.onClicked.addListener);

            onClicked({id: 7, url: "https://example.org/paper?id=2#top"});

            await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());
            const url = lastListener<{url: string}>(chrome.tabs.create).url;
            expect(isIssueFormUrl(url)).toBe(true);
            expect(new URL(url).searchParams.get("body")).toContain("TypeError: boom");
            await vi.waitFor(() => expect(session.has("flora_pending_report")).toBe(true));
        });

        it("falls back to the popup when no error is stored", async () => {
            const onClicked = lastListener<(tab: {id: number; url: string}) => void>(chrome.action.onClicked.addListener);

            onClicked({id: 7, url: "https://example.org/paper"});

            await vi.waitFor(() => expect(chrome.action.openPopup).toHaveBeenCalled());
            expect(chrome.tabs.create).not.toHaveBeenCalled();
            expect(popup.at(-1)).toEqual({tabId: 7, popup: "dist/popup.html"});
        });

        it("falls back to the popup when the tab has moved to another page", async () => {
            await scan(errorState, 7);
            const onClicked = lastListener<(tab: {id: number; url: string}) => void>(chrome.action.onClicked.addListener);

            onClicked({id: 7, url: "https://example.org/other"});

            await vi.waitFor(() => expect(chrome.action.openPopup).toHaveBeenCalled());
            expect(chrome.tabs.create).not.toHaveBeenCalled();
            expect(popup.at(-1)).toEqual({tabId: 7, popup: "dist/popup.html"});
        });

        it("opens the popup page in a tab when openPopup is unavailable", async () => {
            (chrome.action as unknown as Record<string, unknown>).openPopup = undefined;
            const onClicked = lastListener<(tab: {id: number; url: string}) => void>(chrome.action.onClicked.addListener);

            onClicked({id: 7, url: "https://example.org/paper"});

            await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());
            expect(lastListener<{url: string}>(chrome.tabs.create).url)
                .toBe("chrome-extension://test-extension-id/dist/popup.html?tabId=7");
        });

        it("opens the popup page in a tab when openPopup rejects", async () => {
            (chrome.action as unknown as Record<string, unknown>).openPopup = vi.fn(async () => { throw new Error("no"); });
            await scan(errorState, 7);
            const onClicked = lastListener<(tab: {id: number; url: string}) => void>(chrome.action.onClicked.addListener);

            onClicked({id: 7, url: "https://example.org/other"});

            await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());
            expect(lastListener<{url: string}>(chrome.tabs.create).url).toContain("popup.html?tabId=7");
        });

        it("restores the popup when the tab navigates to another page", async () => {
            await scan(errorState, 7);
            const onUpdated = lastListener<(id: number, info: {url?: string}) => void>(chrome.tabs.onUpdated.addListener);

            onUpdated(7, {url: "https://example.org/other"});

            await vi.waitFor(() => expect(session.has("flora_tab_error:7")).toBe(false));
            expect(popup.at(-1)).toEqual({tabId: 7, popup: "dist/popup.html"});
        });

        it("keeps the error when the tab stays on the same page", async () => {
            await scan(errorState, 7);
            const onUpdated = lastListener<(id: number, info: {url?: string}) => void>(chrome.tabs.onUpdated.addListener);

            onUpdated(7, {url: "https://example.org/paper?id=2#top"});
            onUpdated(7, {status: "complete"} as {url?: string});
            await new Promise((r) => setTimeout(r, 0));

            expect(session.has("flora_tab_error:7")).toBe(true);
            expect(popup.at(-1)).toEqual({tabId: 7, popup: ""});
        });

        describe("the report's log entries", () => {
            const worker = {t: 5, level: "log", ctx: "background", msg: "worker line"};

            afterEach(() => { (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({}); });

            async function report(log: unknown[]): Promise<string> {
                (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({flora_debug_log: log});
                await scan(errorState, 7);
                const onClicked = lastListener<(tab: {id: number; url: string}) => void>(chrome.action.onClicked.addListener);
                onClicked({id: 7, url: "https://example.org/paper"});
                await vi.waitFor(() => expect(session.has("flora_pending_report")).toBe(true));
                return (session.get("flora_pending_report") as {report: string}).report;
            }

            it("adds the page's captured entries missing from the persisted log", async () => {
                const text = await report([worker]);

                expect(text).toContain("kaboom");
                expect(text).toContain("worker line");
                expect(text.indexOf("kaboom")).toBeLessThan(text.indexOf("worker line"));
            });

            it("does not repeat entries the log already holds", async () => {
                const text = await report([errorState.entries[0], worker]);

                expect(text.split("kaboom")).toHaveLength(2);
            });
        });

        it("forgets the error when the tab closes", async () => {
            await scan(errorState, 7);
            const onRemoved = lastListener<(tabId: number) => void>(chrome.tabs.onRemoved.addListener);

            onRemoved(7);

            expect(session.has("flora_tab_error:7")).toBe(false);
        });
    });
});
