import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

type Listener = (message: unknown, sender: unknown, sendResponse: (reply: unknown) => void) => unknown;

const searchOwns = vi.fn(() => false);
vi.mock("../../src/shared/search-sites", async (original) => ({
    ...(await original<typeof import("../../src/shared/search-sites")>()),
    searchScriptOwns: () => searchOwns(),
}));
vi.mock("../../src/content-general/dom-listener", () => ({
    startDomListener: () => new MutationObserver(() => {}),
}));

async function listenerOf(bundle: "content-general" | "content-search"): Promise<Listener> {
    const addListener = chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>;
    addListener.mockClear();
    vi.resetModules();
    await import(`../../src/${bundle}/index.ts`);
    return addListener.mock.calls[0][0] as Listener;
}

function ask(listener: Listener): {async: unknown; reply: ReturnType<typeof vi.fn>} {
    const reply = vi.fn();
    return {async: listener({type: "FLORA_GET_RECENT_LOG"}, {}, reply), reply};
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); searchOwns.mockReturnValue(false); });

describe("the page log for an issue report", () => {
    it("comes from content-search alone where the search script owns the page", async () => {
        searchOwns.mockReturnValue(true);
        const general = ask(await listenerOf("content-general"));
        const search = ask(await listenerOf("content-search"));
        await vi.advanceTimersByTimeAsync(1000);
        expect(general.reply).not.toHaveBeenCalled();
        expect(search.reply).toHaveBeenCalledWith({entries: expect.any(Array)});
    });

    it("comes from content-general alone elsewhere, held briefly so a document frame can answer first", async () => {
        const search = ask(await listenerOf("content-search"));
        const general = ask(await listenerOf("content-general"));
        expect(search.reply).not.toHaveBeenCalled();
        expect(general.async).toBe(true);
        expect(general.reply).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        expect(general.reply).toHaveBeenCalledWith({entries: expect.any(Array)});
    });
}, 20_000);
