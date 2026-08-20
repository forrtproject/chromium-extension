import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";

const manifest = JSON.parse(
    readFileSync(path.resolve(__dirname, "..", "..", "manifest.json"), "utf-8")
) as {content_scripts: {js: string[]; exclude_matches?: string[]}[]};

const generalScript = manifest.content_scripts.find((s) =>
    s.js.includes("dist/content-general.js")
)!;

/** Chrome match pattern → RegExp. Host `*.foo` also matches bare `foo`. */
function patternToRegExp(pattern: string): RegExp {
    const [, scheme, host, pathPart] = pattern.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/)!;
    const schemeRe = scheme === "*" ? "https?" : scheme;
    const hostRe = host === "*"
        ? "[^/]+"
        : host.startsWith("*.")
            ? `(?:[^/]+\\.)?${host.slice(2).replace(/\./g, "\\.")}`
            : host.replace(/\./g, "\\.");
    // `?` is a literal in match patterns, and Chrome matches the pattern's path
    // against path + query string — that is what makes `/?*` mean "the site root
    // with a query" (PubMed search results) but not the bare root.
    const pathRe = pathPart.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${schemeRe}://${hostRe}${pathRe}$`);
}

function isExcluded(url: string): boolean {
    return (generalScript.exclude_matches ?? []).some((p) => patternToRegExp(p).test(url));
}

describe("content-general exclusions", () => {
    it.each([
        "https://www.google.com/maps/@51.5074,-0.1278,12z",
        "https://www.google.com/maps/place/British+Library",
        "https://google.com/maps",
        "https://maps.google.com/",
        "https://www.google.co.uk/maps/@51.5,-0.1,12z",
        "https://scholar.google.com/scholar?q=replication",
        // PubMed search results — content-search annotates these rows, and the
        // rows print DOIs content-general would otherwise annotate a second time.
        "https://pubmed.ncbi.nlm.nih.gov/?term=ego+depletion",
        "https://pubmed.ncbi.nlm.nih.gov/?sort=date&term=ego+depletion",
        "https://pubmed.ncbi.nlm.nih.gov/?linkname=pubmed_pubmed&from_uid=20565167",
    ])("skips %s", (url) => {
        expect(isExcluded(url)).toBe(true);
    });

    it.each([
        // Sheets support runs through this very script — a wildcard google.com
        // exclusion would silently kill it.
        "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0",
        "https://www.google.com/search?q=doi",
        "https://www.nature.com/articles/sdata201618",
        // Article pages and the bare homepage carry no result rows, so they stay
        // with content-general and keep their title pill.
        "https://pubmed.ncbi.nlm.nih.gov/12345678/",
        "https://pubmed.ncbi.nlm.nih.gov/",
    ])("still runs on %s", (url) => {
        expect(isExcluded(url)).toBe(false);
    });
});
