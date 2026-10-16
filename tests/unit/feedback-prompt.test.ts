import type {FeedbackPromptResponse, FeedbackPromptStep} from "../../src/shared/messages";

vi.mock("../../src/shared/page-tour", () => ({isPageTourOpen: () => false}));

const HOST = "#flora-feedback-prompt";
const sendMessage = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
const localGet = chrome.storage.local.get as ReturnType<typeof vi.fn>;
const localSet = chrome.storage.local.set as ReturnType<typeof vi.fn>;

let worker: {shown: boolean; pages: number};
let steps: FeedbackPromptStep[];
let claimGranted: boolean;

function fakeWorker(message: {type: string; step: FeedbackPromptStep}): FeedbackPromptResponse | undefined {
    if (message.type !== "FLORA_FEEDBACK_PROMPT") return undefined;
    steps.push(message.step);
    if (message.step === "release") {
        worker.shown = false;
        return {granted: true, pages: worker.pages};
    }
    if (worker.shown) return {granted: false, pages: worker.pages};
    if (message.step === "visit") return {granted: true, pages: ++worker.pages};
    if (!claimGranted) return {granted: false, pages: worker.pages};
    worker.shown = true;
    return {granted: true, pages: worker.pages};
}

async function loadPrompt() {
    vi.resetModules();
    return import("../../src/shared/feedback-prompt");
}

describe("maybeOfferFeedback", () => {
    let defaultSend: unknown;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0);
        worker = {shown: false, pages: 2};
        steps = [];
        claimGranted = true;
        defaultSend = sendMessage.getMockImplementation();
        sendMessage.mockImplementation(async (message) => fakeWorker(message));
        document.body.innerHTML = "";
    });

    afterEach(() => {
        sendMessage.mockImplementation(defaultSend as never);
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("counts each same-document navigation as its own page", async () => {
        const {maybeOfferFeedback} = await loadPrompt();
        worker.pages = 0;
        let page = 1;
        await maybeOfferFeedback(() => page, () => true);
        await maybeOfferFeedback(() => page, () => true);
        page = 2;
        await maybeOfferFeedback(() => page, () => true);
        expect(steps).toEqual(["visit", "visit"]);
    });

    it("does not show after the page that scheduled it has been navigated away from", async () => {
        const {maybeOfferFeedback} = await loadPrompt();
        let page = 1;
        const offer = maybeOfferFeedback(() => page, () => true);
        await vi.advanceTimersByTimeAsync(0);
        page = 2;
        await vi.advanceTimersByTimeAsync(30_000);
        await offer;
        expect(document.querySelector(HOST)).toBeNull();
        expect(steps).toEqual(["visit"]);
        expect(worker.shown).toBe(false);
    });

    it("shows a labelled region that announces itself without taking focus, and closes on Escape", async () => {
        const {maybeOfferFeedback} = await loadPrompt();
        const reading = document.createElement("button");
        document.body.appendChild(reading);
        reading.focus();

        const offer = maybeOfferFeedback(() => 1, () => true);
        await vi.advanceTimersByTimeAsync(30_000);
        await offer;

        const host = document.querySelector<HTMLElement>(HOST)!;
        expect(host.getAttribute("role")).toBe("region");
        expect(document.getElementById(host.getAttribute("aria-labelledby")!)?.textContent).toBe("How is ORE working for you?");
        expect(host.querySelector('[role="status"]')?.textContent).toContain("feedback");
        expect(document.activeElement).toBe(reading);
        expect(steps).toEqual(["visit", "claim"]);

        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
        expect(document.querySelector(HOST)).toBeNull();
    });

    it("returns focus to where the reader was when closed from inside the prompt", async () => {
        const {maybeOfferFeedback} = await loadPrompt();
        const reading = document.createElement("button");
        document.body.appendChild(reading);
        reading.focus();

        const offer = maybeOfferFeedback(() => 1, () => true);
        await vi.advanceTimersByTimeAsync(30_000);
        await offer;

        const later = [...document.querySelectorAll<HTMLButtonElement>(`${HOST} button`)].find((b) => b.textContent === "No thanks")!;
        later.focus();
        later.click();
        expect(document.querySelector(HOST)).toBeNull();
        expect(document.activeElement).toBe(reading);
    });

    it("does not show when another tab already claimed the prompt", async () => {
        const {maybeOfferFeedback} = await loadPrompt();
        claimGranted = false;
        const offer = maybeOfferFeedback(() => 1, () => true);
        await vi.advanceTimersByTimeAsync(30_000);
        await offer;
        expect(document.querySelector(HOST)).toBeNull();
    });

    it("releases the claim when the prompt cannot be inserted", async () => {
        const {maybeOfferFeedback} = await loadPrompt();
        vi.spyOn(document.body, "appendChild").mockImplementationOnce(() => {
            throw new Error("blocked");
        });
        const offer = maybeOfferFeedback(() => 1, () => true);
        await vi.advanceTimersByTimeAsync(30_000);
        await offer;
        expect(steps).toEqual(["visit", "claim", "release"]);
        expect(worker.shown).toBe(false);
    });

    it("releases the claim when the page stops allowing it while claiming", async () => {
        const {maybeOfferFeedback} = await loadPrompt();
        let allowed = true;
        sendMessage.mockImplementation(async (message) => {
            const response = fakeWorker(message);
            if (message.step === "claim") allowed = false;
            return response;
        });
        const offer = maybeOfferFeedback(() => 1, () => allowed);
        await vi.advanceTimersByTimeAsync(30_000);
        await offer;
        expect(document.querySelector(HOST)).toBeNull();
        expect(steps).toEqual(["visit", "claim", "release"]);
    });
});

describe("stepFeedbackPrompt (service worker)", () => {
    let store: Record<string, unknown>;

    beforeEach(() => {
        store = {};
        localGet.mockImplementation(async (key: string) => {
            await Promise.resolve();
            return key in store ? {[key]: structuredClone(store[key])} : {};
        });
        localSet.mockImplementation(async (items: Record<string, unknown>) => {
            await Promise.resolve();
            Object.assign(store, structuredClone(items));
        });
    });

    afterEach(() => {
        localGet.mockResolvedValue({});
        localSet.mockResolvedValue(undefined);
    });

    it("grants only one of several concurrent claims", async () => {
        const {stepFeedbackPrompt} = await import("../../src/background/service-worker");
        const results = await Promise.all([stepFeedbackPrompt("claim"), stepFeedbackPrompt("claim"), stepFeedbackPrompt("claim")]);
        expect(results.filter((r) => r.granted)).toHaveLength(1);
    });

    it("never lets a concurrent page count undo a claim", async () => {
        const {stepFeedbackPrompt} = await import("../../src/background/service-worker");
        await stepFeedbackPrompt("visit");
        await Promise.all([stepFeedbackPrompt("visit"), stepFeedbackPrompt("claim"), stepFeedbackPrompt("visit")]);
        expect(store.flora_feedback_prompt).toMatchObject({shown: true});
        expect((await stepFeedbackPrompt("claim")).granted).toBe(false);
    });

    it("lets a later page claim after a release", async () => {
        const {stepFeedbackPrompt} = await import("../../src/background/service-worker");
        expect((await stepFeedbackPrompt("claim")).granted).toBe(true);
        await stepFeedbackPrompt("release");
        expect((await stepFeedbackPrompt("claim")).granted).toBe(true);
    });
});
