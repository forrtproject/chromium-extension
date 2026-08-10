import {describe, expect, it} from "vitest";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

const PAGES = [
    "src/popup/popup.html",
    "src/options/index.html",
    "src/walkthrough/index.html",
];

describe("extension pages load nothing off the network", () => {
    // A render-blocking remote stylesheet leaves the popup blank for as long as
    // the request hangs — a DNS blackhole or captive portal never fails it fast.
    // <a href> is navigation the reader chooses; only subresources can block.
    it.each(PAGES)("%s loads no external subresource", (page) => {
        const html = readFileSync(path.join(ROOT, page), "utf-8");
        const external = [...html.matchAll(/<(?:link|script|img|iframe)\b[^>]*?\b(?:href|src)="(https?:\/\/[^"]+)"/gs)]
            .map((m) => m[1]);
        expect(external).toEqual([]);
    });

    it("ships every font the stylesheet asks for", () => {
        const css = readFileSync(path.join(ROOT, "assets/fonts/fonts.css"), "utf-8");
        const files = [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            expect(existsSync(path.join(ROOT, "assets", file)), file).toBe(true);
        }
    });
});
