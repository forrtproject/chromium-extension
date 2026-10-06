import {describe, expect, it} from "vitest";
import {JSDOM} from "jsdom";
import {findArticleTitle, placeTitlePill} from "../../src/shared/article-title";

const TITLE = "Replication of a seminal study on memory";

function doc(head: string, body: string): Document {
    return new JSDOM(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`).window.document;
}

const citationTitle = `<meta name="citation_title" content="${TITLE}">`;

describe("findArticleTitle", () => {
    it("picks the article h1 over a journal-name h1 listed first", () => {
        const d = doc(citationTitle, `<h1 id="j">Journal of Examples</h1><h1 id="a">${TITLE}</h1>`);
        expect(findArticleTitle(d)!.id).toBe("a");
    });

    it("without metadata skips banner, screen-reader, nav and site-name headings", () => {
        const d = doc(
            '<meta property="og:site_name" content="Example Journal Site">',
            `<header role="banner"><h1 id="b">Banner heading text</h1></header>
             <h1 id="s" class="sr-only">Screen reader heading</h1>
             <nav><h1 id="n">Navigation heading text</h1></nav>
             <h1 id="site">Example Journal Site</h1>
             <main><header><h1 id="real">${TITLE}</h1></header></main>`);
        expect(findArticleTitle(d)!.id).toBe("real");
    });

    it("finds a title that is not an h1 via citation_title", () => {
        const acl = doc(citationTitle, `<h2 id="title">${TITLE}</h2>`);
        expect(findArticleTitle(acl)!.id).toBe("title");
        const jstage = doc(citationTitle, `<div class="global-article-title" id="g">${TITLE}</div>`);
        expect(findArticleTitle(jstage)!.id).toBe("g");
    });

    it("prefers a heading and ignores breadcrumb and modal copies", () => {
        const d = doc(citationTitle, `
            <ol class="breadcrumb"><li class="title">${TITLE}</li></ol>
            <div class="modal"><div class="title">${TITLE}</div></div>
            <h1 id="h">${TITLE}</h1>`);
        expect(findArticleTitle(d)!.id).toBe("h");
    });

    it("matches an og:title carrying the journal name", () => {
        const d = doc(
            `<meta property="og:title" content="${TITLE} | Journal Name">`,
            `<h1 id="h">${TITLE}</h1>`);
        expect(findArticleTitle(d)!.id).toBe("h");
    });

    it("does not let a weak reference select a non-heading", () => {
        const d = doc(
            `<meta property="og:title" content="${TITLE}">`,
            `<div><span class="something-title">${TITLE}</span></div>`);
        expect(findArticleTitle(d)).toBeNull();
    });

    it("returns the paragraph around a bold title", () => {
        const d = doc(citationTitle, `<div class="card-body"><p id="p"><b>${TITLE}</b></p></div>`);
        expect(findArticleTitle(d)!.id).toBe("p");
    });

    it("prefers the nested element over its wrapper", () => {
        const d = doc(citationTitle, `<div class="panel-pane"><div id="inner" class="highwire-cite-title">${TITLE}</div></div>`);
        expect(findArticleTitle(d)!.id).toBe("inner");
    });

    it("returns null with no metadata and only a short heading", () => {
        expect(findArticleTitle(doc("", "<h1>pedocs</h1>"))).toBeNull();
    });
});

describe("placeTitlePill", () => {
    it("puts a block pill after the title, not inside it", () => {
        const d = doc("", `<h1>Long title <span>x</span></h1>`);
        const h1 = d.querySelector("h1")!;
        const pill = d.createElement("span");
        placeTitlePill(pill, h1);
        expect(h1.nextElementSibling).toBe(pill);
        expect(pill.style.display).toBe("block");
        expect(pill.style.getPropertyPriority("display")).toBe("");
        expect(pill.style.getPropertyValue("margin-inline-start")).toBe("0");
    });

    it("appends inside the title when its parent is a flex row", () => {
        const d = doc("", `<div style="display:flex"><h1>Long title text here</h1></div>`);
        const h1 = d.querySelector("h1")!;
        const pill = d.createElement("span");
        placeTitlePill(pill, h1);
        expect(pill.parentElement).toBe(h1);
    });

    it("appends inside the title when its parent is a reversed flex column", () => {
        const d = doc("", `<div style="display:flex;flex-direction:column-reverse"><h1>Long title text here</h1></div>`);
        const h1 = d.querySelector("h1")!;
        const pill = d.createElement("span");
        placeTitlePill(pill, h1);
        expect(pill.parentElement).toBe(h1);
    });

    it("keeps a plain flex column as a sibling", () => {
        const d = doc("", `<div style="display:flex;flex-direction:column"><h1>Long title text here</h1></div>`);
        const h1 = d.querySelector("h1")!;
        const pill = d.createElement("span");
        placeTitlePill(pill, h1);
        expect(h1.nextElementSibling).toBe(pill);
    });

    it("matches the title's own start inset when placed after it", () => {
        const d = doc("", `<h1 style="margin-left:20px;padding-left:4px">Long title text here</h1>`);
        const pill = d.createElement("span");
        placeTitlePill(pill, d.querySelector("h1")!);
        expect(pill.style.getPropertyValue("margin-inline-start")).toBe("24px");
    });

    it("centres the pill under a centred title", () => {
        const d = doc("", `<h1 style="text-align:center">Long title text here</h1>`);
        const pill = d.createElement("span");
        placeTitlePill(pill, d.querySelector("h1")!);
        expect(pill.style.getPropertyValue("margin-inline-start")).toBe("auto");
    });
});

describe("placeTitlePill spacing", () => {
    const place = (html: string) => {
        const d = doc("", html);
        const title = d.querySelector("h1")!;
        const pill = d.createElement("span");
        placeTitlePill(pill, title);
        return {title, pill};
    };

    it("goes inside a title that carries its own bottom rule", () => {
        const {title, pill} = place(`<h1 style="border-bottom:1px solid #ccc;margin-left:20px">Long title text here</h1>`);
        expect(pill.parentElement).toBe(title);
        expect(pill.style.getPropertyValue("margin-inline-start")).toBe("0");
    });

    it("stays a sibling when a ruled title is itself a flex row", () => {
        const {title, pill} = place(`<h1 style="display:flex;border-bottom:1px solid #ccc">Long title text here</h1>`);
        expect(title.nextElementSibling).toBe(pill);
    });

    it("moves a large title margin below the pill", () => {
        const {pill} = place(`<h1 style="margin-bottom:16px">Long title text here</h1>`);
        expect(pill.style.getPropertyValue("margin-top")).toBe("-10px");
        expect(pill.style.getPropertyPriority("margin-top")).toBe("important");
        expect(pill.style.getPropertyValue("margin-bottom")).toBe("16px");
    });

    it("keeps 6px both sides for small or inline margins", () => {
        const small = place(`<h1 style="margin-bottom:4px">Long title text here</h1>`);
        expect(small.pill.style.getPropertyValue("margin-top")).toBe("6px");
        expect(small.pill.style.getPropertyValue("margin-bottom")).toBe("6px");
        const inline = place(`<h1 style="display:inline;margin-bottom:20px">Long title text here</h1>`);
        expect(inline.pill.style.getPropertyValue("margin-bottom")).toBe("6px");
    });

    it("keeps 6px inside a flex-row parent", () => {
        const d = doc("", `<div style="display:flex"><h1 style="margin-bottom:16px">Long title text here</h1></div>`);
        const pill = d.createElement("span");
        placeTitlePill(pill, d.querySelector("h1")!);
        expect(pill.style.getPropertyValue("margin-top")).toBe("6px");
        expect(pill.style.getPropertyValue("margin-bottom")).toBe("6px");
    });
});

describe("findArticleTitle on heading-less markup", () => {
    it("finds a title span marked only by data-testid, with curly quotes and an en dash", () => {
        const title = "The ‘other half’ of the public debt–economic growth relationship: a note on Reinhart and Rogoff";
        const d = doc(`<meta name="citation_title" content="${title}">`,
            `<div class="typography-body text-headline"><span data-testid="block-primitivetitle">
    ${title}
</span></div>`);
        expect(findArticleTitle(d)!.className).toBe("typography-body text-headline");
    });
});
