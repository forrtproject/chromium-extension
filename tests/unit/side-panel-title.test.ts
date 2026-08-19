import {describe, it, expect, beforeEach} from "vitest";
import {renderSidePanel} from "../../src/content-general/injector";
import type {DoiContext, DoiString, LookupState} from "../../src/shared/types";
import {doi, mockResult} from "../helpers";

const ARTICLE = doi("10.1037/pspp0000136");

function render(articleTitle: string | null = null): void {
    const pageState = new Map<DoiString, LookupState>([
        [ARTICLE, {status: "matched", result: mockResult(), source: "extracted"}],
    ]);
    const doiContext = new Map<DoiString, DoiContext>([[ARTICLE, "article"]]);
    renderSidePanel([], [], pageState, doiContext, new Map(), [], articleTitle);
}

function panelTitle(): string {
    const link = document.querySelector<HTMLElement>("#flora-pubpeer-panel a[title='Open in FLoRA'] span");
    return link?.textContent ?? "";
}

describe("side panel article title", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
        document.title = "";
    });

    it("prefers the DOI-resolved title over the page's own metadata", () => {
        document.title = "APA PsycNet";
        render("The incremental validity of average state self-reports");

        expect(panelTitle()).toBe("The incremental validity of average state self-reports");
    });

    it("leaves FLoRA's injected pill text out of a heading-derived title", () => {
        document.body.innerHTML =
            `<h1>Real Article Title<span data-flora-ui>DOI 10.1037/pspp0000136 1 rep</span></h1>`;
        render();

        expect(panelTitle()).toBe("Real Article Title");
    });

    it("skips a masthead heading in favour of the article heading", () => {
        document.body.innerHTML =
            `<header><h1>APA PsycNet</h1></header><main><h1>Real Article Title</h1></main>`;
        render();

        expect(panelTitle()).toBe("Real Article Title");
    });

    it("re-renders when the title changes", () => {
        document.title = "APA PsycNet";
        render();
        expect(panelTitle()).toBe("APA PsycNet");

        render("The incremental validity of average state self-reports");
        expect(panelTitle()).toBe("The incremental validity of average state self-reports");
    });
});
