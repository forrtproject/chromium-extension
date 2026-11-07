import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf-8");

describe("settings page copy", () => {
    // Site categories can switch ORE off on whole groups of sites, so an empty
    // blocklist does not mean ORE runs everywhere.
    it("states only that no sites are blocked when the blocklist is empty", () => {
        const options = read("src/options/options.ts");
        expect(options).toContain('"No sites blocked."');
        expect(options).not.toContain("active on all sites");
    });
});

describe("links to the FLoRA Atlas", () => {
    it("labels and points the settings header and footer links at the Atlas", async () => {
        const {ATLAS_BASE} = await import("../../src/shared/flora-atlas");
        const html = read("src/options/index.html");
        expect(html).not.toMatch(/FReD Explorer|fred_explorer/);
        const atlasLinks = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>\s*FLoRA Atlas<\/a/g)].map((m) => m[1]);
        expect(atlasLinks).toEqual([ATLAS_BASE, ATLAS_BASE]);
    });
});
