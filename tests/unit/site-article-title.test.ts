import {beforeEach, describe, expect, it} from "vitest";
import {JSDOM} from "jsdom";
import {findArticleTitle, placeTitlePill, siteArticleTitle} from "../../src/shared/article-title";
import {beginDomScanPass, classifyPageDois, extractPrimaryDOI} from "../../src/shared/doi-extractor";

function page(url: string, head: string, body: string): Document {
    return new JSDOM(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, {url}).window.document;
}

beforeEach(() => beginDomScanPass());

describe("sticky headers", () => {
    const place = (body: string) => {
        const d = page("https://example.org/a", "", body);
        const pill = d.createElement("span");
        placeTitlePill(pill, d.querySelector("h1")!);
        return pill;
    };

    it("drops the margin compensation under a data-sticky-header wrapper", () => {
        const pill = place(`<div data-sticky-header><h1 style="margin-bottom:16px">Long title text here</h1></div>`);
        expect(pill.style.getPropertyValue("margin-top")).toBe("6px");
        expect(pill.style.getPropertyValue("margin-bottom")).toBe("6px");
    });

    it("drops it under a position:sticky ancestor", () => {
        const pill = place(`<header style="position:sticky"><h1 style="margin-bottom:16px">Long title text here</h1></header>`);
        expect(pill.style.getPropertyValue("margin-top")).toBe("6px");
        expect(pill.style.getPropertyValue("margin-bottom")).toBe("6px");
    });

    it("keeps the compensation for an ordinary title", () => {
        const pill = place(`<div><h1 style="margin-bottom:16px">Long title text here</h1></div>`);
        expect(pill.style.getPropertyValue("margin-top")).toBe("-10px");
    });
});

describe("psicothema", () => {
    const DOI = "10.7334/psicothema2016.24";
    const body = `<a href="https://doi.org/${DOI}">https://doi.org/${DOI}</a>
        <center><h3><span>Knowledge level of effect size statistics</span></h3></center>
        <center><h4>Grado de conocimiento de los estadísticos del tamaño del efecto</h4></center>`;

    it("finds the title from the site adapter", () => {
        const d = page("https://www.psicothema.com/pi?pii=1", "", body);
        expect(findArticleTitle(d)!.tagName).toBe("H3");
        expect(siteArticleTitle(d)!.tagName).toBe("H3");
    });

    it("adopts the lone DOI as the article's", () => {
        const d = page("https://www.psicothema.com/pi?pii=1", "", body);
        const result = classifyPageDois(d);
        expect(result.articleDois).toEqual([DOI]);
        expect(result.otherDois).toEqual([]);
    });

    it("leaves the same markup on an unregistered host as other", () => {
        const d = page("https://www.example.org/pi?pii=1", "", body);
        const result = classifyPageDois(d);
        expect(result.articleDois).toEqual([]);
        expect(result.otherDois).toEqual([DOI]);
    });

    it("centres the pill for a computed -webkit-center", () => {
        const d = page("https://www.psicothema.com/pi?pii=1", "", body);
        const title = d.querySelector<HTMLElement>("h3")!;
        title.style.textAlign = "-webkit-center";
        const pill = d.createElement("span");
        placeTitlePill(pill, title);
        expect(pill.style.getPropertyValue("margin-inline-start")).toBe("auto");
    });
});

describe("heiup", () => {
    it("finds the subtitle heading after the authors block", () => {
        const d = page("https://heiup.uni-heidelberg.de/reader/chapter/1", "",
            `<div class="item authors">A</div><h2 class="title">Repetitive Research</h2><h3 class="subtitle">Spitzer and Racine</h3>`);
        expect(findArticleTitle(d)!.tagName).toBe("H3");
    });

    it.each([
        [["10.17885/heiup.1157", "10.17885/heiup.1157.c19369"], "10.17885/heiup.1157.c19369"],
        [["10.17885/heiup.1157", "10.17885/heiup.1157.c19369", "10.17885/heiup.1157.c19369.s2"], "10.17885/heiup.1157.c19369.s2"],
        [["10.17885/heiup.1157_v2", "10.17885/heiup.1157"], "10.17885/heiup.1157"],
        [["10.7554/elife.1", "10.7554/elife.1.3"], "10.7554/elife.1"],
        [["10.31219/osf.io/5gskw", "10.31219/osf.io/5gskw_v1"], "10.31219/osf.io/5gskw"],
    ])("picks the primary from %j as %s", (dois, expected) => {
        const metas = dois.map((d, i) => `<meta name="${i === 0 ? "citation_doi" : "DC.Identifier.DOI"}" content="${d}">`).join("");
        const d = page("https://example.org/a", metas, "<p>x</p>");
        expect(extractPrimaryDOI(d)).toBe(expected);
        expect(classifyPageDois(d).articleDois[0]).toBe(expected);
    });
});
