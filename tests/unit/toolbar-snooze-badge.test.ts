import {describe, it, expect, vi, beforeEach} from "vitest";

type IconCall = {tabId: number; path: Record<string, string>};
type TitleCall = {tabId: number; title: string};
type BadgeCall = {tabId: number; text: string};

const icon: IconCall[] = [];
const title: TitleCall[] = [];
const badge: BadgeCall[] = [];

function installActionSpies(): void {
    chrome.action.setIcon = vi.fn(async (a: IconCall) => { icon.push(a); }) as never;
    chrome.action.setTitle = vi.fn(async (a: TitleCall) => { title.push(a); }) as never;
    (chrome.action as Record<string, unknown>).setBadgeText =
        vi.fn(async (a: BadgeCall) => { badge.push(a); });
    (chrome.action as Record<string, unknown>).setBadgeBackgroundColor = vi.fn(async () => undefined);
}

async function deliver(message: unknown, tabId?: number): Promise<void> {
    const listener = (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>)
        .mock.calls.map(([fn]) => fn as (m: unknown, s: unknown, r: unknown) => unknown).at(-1)!;
    listener(message, tabId == null ? {} : {tab: {id: tabId}}, () => undefined);
    await Promise.resolve();
}

describe("the toolbar shows a snoozed site differently from an inactive one", () => {
    beforeEach(async () => {
        icon.length = title.length = badge.length = 0;
        installActionSpies();
        vi.resetModules();
        await import("../../src/background/service-worker");
    });

    it("badges a snoozed tab and says until when", async () => {
        const until = new Date();
        until.setHours(until.getHours() + 1);

        await deliver({type: "FLORA_ACTIVE_STATE", active: false, snoozedUntil: until.getTime()}, 7);

        expect(badge.at(-1)).toEqual({tabId: 7, text: "Zz"});
        expect(title.at(-1)!.title).toContain("snoozed here until");
    });

    it("leaves an ordinary inactive tab unbadged", async () => {
        await deliver({type: "FLORA_ACTIVE_STATE", active: false, snoozedUntil: null}, 8);

        expect(badge.at(-1)).toEqual({tabId: 8, text: ""});
        expect(title.at(-1)!.title).toBe("FORRT ORE — inactive on this page");
    });

    it("clears the badge when the site becomes active again", async () => {
        await deliver({type: "FLORA_ACTIVE_STATE", active: true, snoozedUntil: null}, 9);

        expect(badge.at(-1)).toEqual({tabId: 9, text: ""});
        expect(title.at(-1)!.title).toBe("FORRT ORE — active on this page");
    });

    it("keeps the badge when the torn-down page reports itself still snoozed", async () => {
        const until = Date.now() + 3_600_000;

        await deliver({type: "FLORA_ACTIVE_STATE", active: false, snoozedUntil: until, tabId: 5});
        // The popup then tears the page down; the content script reports in.
        await deliver({type: "FLORA_ACTIVE_STATE", active: false, snoozedUntil: until}, 5);

        expect(badge.map((b) => b.text), "the teardown must not clear the badge")
            .toEqual(["Zz", "Zz"]);
    });

    it("loses the badge if a torn-down page forgets it was snoozed", async () => {
        await deliver({type: "FLORA_ACTIVE_STATE", active: false, snoozedUntil: Date.now() + 60_000, tabId: 5});
        await deliver({type: "FLORA_ACTIVE_STATE", active: false, snoozedUntil: null}, 5);

        expect(badge.at(-1)!.text, "this is the bug the content script must avoid").toBe("");
    });

    it("accepts the tab id from the popup, which has no sender.tab", async () => {
        await deliver({type: "FLORA_ACTIVE_STATE", active: false, snoozedUntil: Date.now() + 60_000, tabId: 11});

        expect(badge.at(-1)).toEqual({tabId: 11, text: "Zz"});
    });
});
