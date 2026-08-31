import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { atlasDoiUrl, bindAtlasLink, needsAtlasSet } from "../../src/shared/flora-atlas";
import { renderMatchedBanner, removeBanner } from "../../src/content-general/injector";
import { doi, mockResult } from "../helpers";
import type { DoiString } from "../../src/shared/types";

function dois(count: number, tag: string): DoiString[] {
    return Array.from({ length: count }, (_, i) => doi(`10.1234/journal.${tag}.article.${i}`));
}

function anchor(): HTMLAnchorElement {
    const el = document.createElement("a");
    document.body.appendChild(el);
    return el;
}

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("atlas links for long DOI lists", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.mocked(chrome.runtime.sendMessage).mockReset();
        vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
            type: "FLORA_CREATE_SET_RESULT",
            setId: "abc123",
        });
    });

    afterEach(() => {
        removeBanner();
        vi.unstubAllGlobals();
    });

    it("keeps a short list on the ?doi= URL and asks for no set", async () => {
        const few = dois(3, "short");
        const el = anchor();

        bindAtlasLink(el, few);
        await flush();

        expect(el.href).toBe(atlasDoiUrl(few));
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it("swaps a long list onto the ?sets= URL", async () => {
        const many = dois(100, "swap");
        expect(needsAtlasSet(many)).toBe(true);
        const el = anchor();

        bindAtlasLink(el, many);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            type: "FLORA_CREATE_SET",
            dois: many,
        });

        await flush();
        expect(el.href).toBe("https://forrt.org/flora-replication-atlas/?sets=abc123");
    });

    it("creates one set for a list rendered twice", async () => {
        const many = dois(100, "repeat");

        bindAtlasLink(anchor(), many);
        await flush();
        bindAtlasLink(anchor(), many);
        await flush();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("falls back to the ?doi= URL when the set cannot be created", async () => {
        vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
            type: "FLORA_CREATE_SET_RESULT",
            setId: null,
        });
        const many = dois(100, "fallback");
        const el = anchor();

        bindAtlasLink(el, many);
        await flush();

        expect(el.href).toBe(atlasDoiUrl(many));
    });

    it("retries the set after a failed attempt", async () => {
        vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({
            type: "FLORA_CREATE_SET_RESULT",
            setId: null,
        });
        const many = dois(100, "retry");

        bindAtlasLink(anchor(), many);
        await flush();
        const el = anchor();
        bindAtlasLink(el, many);
        await flush();

        expect(el.href).toBe("https://forrt.org/flora-replication-atlas/?sets=abc123");
    });

    it("holds a click made before the set id arrives, then opens the set URL", async () => {
        const open = vi.fn();
        vi.stubGlobal("open", open);
        let release: (value: unknown) => void = () => {};
        vi.mocked(chrome.runtime.sendMessage).mockReturnValue(
            new Promise((resolve) => { release = resolve; })
        );
        const el = anchor();
        bindAtlasLink(el, dois(100, "click"));

        const click = new MouseEvent("click", { cancelable: true });
        el.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);

        release({ type: "FLORA_CREATE_SET_RESULT", setId: "abc123" });
        await flush();

        expect(open).toHaveBeenCalledWith(
            "https://forrt.org/flora-replication-atlas/?sets=abc123",
            "_blank",
            "noopener"
        );
    });

    it("gives the matched banner's details link a set URL", async () => {
        vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
        const matched = dois(100, "banner").map((d) => ({ doi: d, result: mockResult() }));

        renderMatchedBanner(matched);
        await flush();

        const link = document.querySelector<HTMLAnchorElement>("[data-flora-details-link]");
        expect(link?.href).toBe("https://forrt.org/flora-replication-atlas/?sets=abc123");
    });
});
