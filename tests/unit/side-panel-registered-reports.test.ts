import {beforeEach, describe, expect, it, vi} from "vitest";
import type {DoiContext, DoiString, LookupState} from "../../src/shared/types";
import {doi, mockResult} from "../helpers";

const ARTICLE = doi("10.1098/rsos.171474");
const REFS = ["10.1/a", "10.1/b", "10.1/c", "10.1/d"].map((d) => ({doi: doi(d), title: `Paper ${d}`}));

function sendMessage(): ReturnType<typeof vi.fn> {
    return chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
}

async function render() {
    const {renderSidePanel} = await import("../../src/content-general/injector");
    const state = new Map<DoiString, LookupState>([[ARTICLE, {status: "matched", result: mockResult(), source: "extracted"}]]);
    const context = new Map<DoiString, DoiContext>([[ARTICLE, "article"]]);
    renderSidePanel([], REFS, state, context, new Map(), [], "Article");
}

describe("Registered Reports in the side panel", () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = "";
        sendMessage().mockReset();
    });

    it("asks once for the article and every reference, and marks what it finds", async () => {
        sendMessage().mockImplementation(async (msg: {type: string; dois?: string[]}) => msg.type === "FLORA_RR_CHECK"
            ? {type: "FLORA_RR_CHECK_RESULT", results: {[ARTICLE]: {key: "K1", stage: 2}, [REFS[1].doi]: {key: "K2", stage: 1}}}
            : undefined);
        await render();

        await vi.waitFor(() => expect(document.querySelector("[data-flora-rr-banner]")).not.toBeNull());
        const rrCalls = sendMessage().mock.calls.filter(([msg]) => msg.type === "FLORA_RR_CHECK");
        expect(rrCalls).toHaveLength(1);
        expect(new Set(rrCalls[0][0].dois)).toEqual(new Set([ARTICLE, ...REFS.map((r) => r.doi)]));
        expect(document.querySelectorAll("[data-flora-rr-tag]")).toHaveLength(1);
    });

    it("tags every row that shows the same Registered Report", async () => {
        sendMessage().mockImplementation(async (msg: {type: string}) => msg.type === "FLORA_RR_CHECK"
            ? {type: "FLORA_RR_CHECK_RESULT", results: {[REFS[1].doi]: {key: "K2", stage: 1}}}
            : undefined);
        const {renderSidePanel} = await import("../../src/content-general/injector");
        const state = new Map<DoiString, LookupState>([[ARTICLE, {status: "matched", result: mockResult(), source: "extracted"}]]);
        const context = new Map<DoiString, DoiContext>([[ARTICLE, "article"]]);
        renderSidePanel([], [REFS[1], {doi: REFS[1].doi, title: "Same paper, cited again"}], state, context, new Map(), [], "Article");

        await vi.waitFor(() => expect(document.querySelectorAll("[data-flora-rr-tag]")).toHaveLength(2));
        const rows = new Set([...document.querySelectorAll("[data-flora-rr-tag]")].map((tag) => tag.closest("li")));
        expect(rows.size, "each cited row carries its own tag").toBe(2);
        expect(rows.has(null)).toBe(false);
    });

    it("logs a failed lookup once, not once per reference", async () => {
        sendMessage().mockImplementation(async (msg: {type: string}) => msg.type === "FLORA_RR_CHECK"
            ? {type: "FLORA_RR_CHECK_RESULT", results: {}, error: "Registered Reports data unavailable"}
            : undefined);
        const debug = await import("../../src/shared/debug");
        const warn = vi.spyOn(debug, "debugWarn");
        await render();

        await vi.waitFor(() => expect(warn.mock.calls.filter(([m]) => String(m).includes("Registered Reports"))).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(warn.mock.calls.filter(([m]) => String(m).includes("Registered Reports"))).toHaveLength(1);
        expect(String(warn.mock.calls.find(([m]) => String(m).includes("Registered Reports"))![1]))
            .toContain("Registered Reports: Registered Reports data unavailable");
    });
});
