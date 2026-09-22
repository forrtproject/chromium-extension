import {describe, expect, it} from "vitest";
import {isSamePage, pageUrl} from "../../src/shared/page-identity";

const A = "https://journal.example/article/1?v=2";

describe("pageUrl", () => {
    it.each([
        [A, A],
        [`${A}#ref-12`, A],
        [`${A}#`, A],
        ["https://scholar.google.com/scholar?q=x#d=gs_cit&t=1", "https://scholar.google.com/scholar?q=x"],
        [`${A}#/results/2`, `${A}#/results/2`],
        [`${A}#!/results/2`, `${A}#!/results/2`],
        ["https://docs.google.com/spreadsheets/d/abc/edit#gid=7&range=A1", "https://docs.google.com/spreadsheets/d/abc/edit#gid=7"],
    ])("%s → %s", (href, expected) => {
        expect(pageUrl(href)).toBe(expected);
    });
});

describe("isSamePage", () => {
    it("treats a plain-fragment change as the same page, whatever the entry key", () => {
        expect(isSamePage({href: A, key: "k1"}, {href: `${A}#ref-12`, key: "k2"})).toBe(true);
        expect(isSamePage({href: `${A}#ref-12`, key: "k2"}, {href: A, key: "k1"})).toBe(true);
    });

    it("treats a hash-route change as a new page", () => {
        expect(isSamePage({href: `${A}#/one`, key: "k1"}, {href: `${A}#/two`, key: "k2"})).toBe(false);
    });

    it("treats an identical URL as a new page only when the entry key changes", () => {
        expect(isSamePage({href: A, key: "k1"}, {href: A, key: "k1"})).toBe(true);
        expect(isSamePage({href: A, key: "k1"}, {href: A, key: "k2"})).toBe(false);
    });

    it("treats a path or query change as a new page", () => {
        expect(isSamePage({href: A, key: "k1"}, {href: "https://journal.example/article/2?v=2", key: "k1"})).toBe(false);
        expect(isSamePage({href: A, key: "k1"}, {href: "https://journal.example/article/1?v=3#ref-1", key: "k1"})).toBe(false);
    });
});
