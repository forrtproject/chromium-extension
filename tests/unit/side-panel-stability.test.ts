import {describe, it, expect, beforeEach, vi} from "vitest";
import {renderSidePanel} from "../../src/content-general/injector";
import type {DoiContext, DoiString, LookupState} from "../../src/shared/types";
import type {PubPeerFeedback} from "../../src/shared/pubpeer-api";
import {doi, mockResult} from "../helpers";

const ARTICLE = doi("10.1038/nature12373");

function feedback(overrides: Partial<PubPeerFeedback> = {}): PubPeerFeedback {
    return {
        id: ARTICLE,
        title: "Test Article",
        total_comments: 3,
        total_peeriodical_comments: 0,
        last_commented_at: "2024-01-01",
        users: "Statcheck",
        url: "https://pubpeer.com/publications/ABC123",
        ...overrides,
    };
}

function render(feedbacks: PubPeerFeedback[], refs: {doi: DoiString; title: string}[] = []): void {
    const pageState = new Map<DoiString, LookupState>([
        [ARTICLE, {status: "matched", result: mockResult(), source: "extracted"}],
    ]);
    const doiContext = new Map<DoiString, DoiContext>([[ARTICLE, "article"]]);
    renderSidePanel(feedbacks, refs, pageState, doiContext, new Map(), []);
}

const panel = (): HTMLElement | null => document.getElementById("flora-pubpeer-panel");
const comments = (): HTMLElement | null =>
    document.querySelector<HTMLElement>("#flora-pubpeer-panel [data-flora-pubpeer-comments]");

describe("side panel stability", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("keeps the same comments element when re-rendered with identical data", () => {
        render([feedback()]);
        const first = comments();
        expect(first).not.toBeNull();
        // Marks the live node — a rebuilt section would not carry this.
        (first as unknown as {floraMark?: number}).floraMark = 42;

        render([feedback()]);

        expect(comments()).toBe(first);
        expect((comments() as unknown as {floraMark?: number}).floraMark).toBe(42);
    });

    it("preserves the panel host across a no-op re-render", () => {
        render([feedback()]);
        const host = panel();

        render([feedback()]);

        expect(panel()).toBe(host);
    });

    it("rebuilds when the PubPeer thread changes, pointing at the new thread", async () => {
        render([feedback()]);
        const first = comments();

        render([feedback({url: "https://pubpeer.com/publications/DIFFERENT", total_comments: 9})]);

        expect(comments()).not.toBe(first);
        document.querySelector<HTMLElement>('[aria-label="Open the ORE report"]')!.click();
        await vi.waitFor(() => expect(comments()?.querySelector("a")?.href).toContain("DIFFERENT"));
    });

    it("rebuilds when the comment count changes on the same thread", () => {
        render([feedback({total_comments: 3})]);
        const first = comments();

        render([feedback({total_comments: 4})]);

        expect(comments()).not.toBe(first);
    });

    it("rebuilds when a flagged reference is added", () => {
        render([feedback()]);
        const first = comments();

        render([feedback()], [{doi: doi("10.1371/journal.pone.0012345"), title: "A cited paper"}]);

        expect(comments()).not.toBe(first);
    });
});
