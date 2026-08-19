import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const REFERENCES_SRC = readFileSync(
    join(__dirname, "..", "..", "src", "content-general", "references.ts"),
    "utf-8"
);

describe("reference pill placement does not force layout", () => {
    // innerText is a layout-forcing read: on a long bibliography it turns pill
    // placement into a reflow per entry. textContent costs nothing.
    it("never reads innerText while choosing where a pill goes", () => {
        expect(REFERENCES_SRC).not.toMatch(/\binnerText\b/);
    });
});
