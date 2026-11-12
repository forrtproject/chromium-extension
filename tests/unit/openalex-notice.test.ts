import {beforeEach, expect, it, vi} from "vitest";

const reply = (openalexLimit?: {resetAt: number; keyed: boolean}) =>
    ({type: "FLORA_AUGMENT_RESULT", results: {Paper: null}, ...(openalexLimit ? {openalexLimit} : {})});

beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    let stored: Record<string, unknown> = {};
    vi.mocked(chrome.storage.local.get).mockImplementation(async (key: any) => ({[key]: stored[key]}) as any);
    vi.mocked(chrome.storage.local.set).mockImplementation(async (items: any) => { stored = {...stored, ...items}; });
});

async function setup() {
    const messages = await import("../../src/shared/messages");
    const {installOpenAlexLimitNotice} = await import("../../src/shared/openalex-notice");
    installOpenAlexLimitNotice();
    return messages;
}

const toastText = () => document.body.textContent ?? "";

it("tells the reader once per budget that title matching uses Crossref alone", async () => {
    const {augmentDOIsViaWorker} = await setup();
    const resetAt = Date.now() + 3_600_000;
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue(reply({resetAt, keyed: false}) as any);
    await augmentDOIsViaWorker(["Paper"]);
    await vi.waitFor(() => expect(toastText()).toContain("OpenAlex limit reached"));
    expect(toastText()).toContain("Crossref alone");
    expect(toastText()).toContain("Settings");

    document.body.innerHTML = "";
    await augmentDOIsViaWorker(["Paper"]);
    await new Promise((r) => setTimeout(r, 20));
    expect(toastText()).not.toContain("OpenAlex");
});

it("says nothing while OpenAlex has budget, and waits for a Retry to be dealt with", async () => {
    const {augmentDOIsViaWorker} = await setup();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue(reply() as any);
    await augmentDOIsViaWorker(["Paper"]);
    await new Promise((r) => setTimeout(r, 20));
    expect(toastText()).not.toContain("OpenAlex");

    const {showToast} = await import("../../src/shared/toast");
    showToast("DOI matching is unavailable for some results.", {action: {label: "Retry", onClick: () => {}}});
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue(reply({resetAt: Date.now() + 3_600_000, keyed: false}) as any);
    await augmentDOIsViaWorker(["Paper"]);
    await new Promise((r) => setTimeout(r, 20));
    expect(toastText()).toContain("Retry");
    expect(toastText()).not.toContain("OpenAlex limit");
});
