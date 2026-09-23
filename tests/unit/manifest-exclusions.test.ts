import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";
import {patternToRegExp} from "../helpers";

const manifest = JSON.parse(
    readFileSync(path.resolve(__dirname, "..", "..", "manifest.json"), "utf-8")
) as {content_scripts: {js: string[]; exclude_matches?: string[]}[]};

const generalScript = manifest.content_scripts.find((s) =>
    s.js.includes("dist/content-general.js")
)!;

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
    ])("skips %s", (url) => {
        expect(isExcluded(url)).toBe(true);
    });

    it.each([
        // Sheets support runs through this very script — a wildcard google.com
        // exclusion would silently kill it.
        "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0",
        "https://www.google.com/search?q=doi",
        "https://www.nature.com/articles/sdata201618",
    ])("still runs on %s", (url) => {
        expect(isExcluded(url)).toBe(false);
    });
});
