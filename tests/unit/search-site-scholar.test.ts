import {describe, it, expect, beforeEach} from "vitest";
import {JSDOM} from "jsdom";
import {SCHOLAR} from "../../src/content-search/sites/scholar";

const QUERY_URL = "https://scholar.google.com/scholar?hl=en&as_sdt=0%2C5&q=10.5281%2Fzenodo.14871843&btnG=";

function rowFrom(html: string): HTMLElement {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {url: QUERY_URL});
    (globalThis as unknown as {document: Document}).document = dom.window.document;
    return dom.window.document.querySelector(".gs_r") as HTMLElement;
}

describe("Google Scholar row extraction", () => {
    beforeEach(() => {
        (globalThis as unknown as {document: Document}).document = document;
    });

    it("does not attribute the searched-for DOI to a row that echoes it in a nav link", () => {
        const row = rowFrom(`
          <div class="gs_r gs_or gs_scl">
            <h3 class="gs_rt"><a href="https://example.org/some-unrelated-paper">A totally different paper</a></h3>
            <div class="gs_a">J Smith - Journal of Things, 2019 - example.org</div>
            <div class="gs_fl">
              <a href="/scholar?q=related:abc:scholar.google.com/&hl=en&as_sdt=0,5&q=10.5281/zenodo.14871843">Related articles</a>
              <a href="/scholar?cluster=123&hl=en&as_sdt=0,5&q=10.5281/zenodo.14871843">All 4 versions</a>
            </div>
          </div>`);

        expect(SCHOLAR.extractRow!(row)?.doi).toBeNull();
    });

    it("still reads a DOI embedded in a publisher link's path", () => {
        const row = rowFrom(`
          <div class="gs_r gs_or gs_scl">
            <h3 class="gs_rt"><a href="https://onlinelibrary.wiley.com/doi/10.1111/jopy.12345">A real paper</a></h3>
            <div class="gs_a">A Author - Journal, 2020 - wiley.com</div>
          </div>`);

        expect(SCHOLAR.extractRow!(row)?.doi).toBe("10.1111/jopy.12345");
    });

    it("still reads a DOI from an explicitly named query parameter", () => {
        const row = rowFrom(`
          <div class="gs_r gs_or gs_scl">
            <h3 class="gs_rt"><a href="https://example.org/article?doi=10.1234/named.param">Named param</a></h3>
            <div class="gs_a">A Author - Journal, 2021 - example.org</div>
          </div>`);

        expect(SCHOLAR.extractRow!(row)?.doi).toBe("10.1234/named.param");
    });
});
