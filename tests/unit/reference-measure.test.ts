import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const REFERENCES_SRC = readFileSync(
    join(__dirname, "..", "..", "src", "content-general", "references.ts"),
    "utf-8"
);

vi.mock("../../src/shared/settings", () => ({
    getSettings: vi.fn().mockResolvedValue({ email: "t@example.com", showDoiPillsOnAllReferences: false, citationStyle: "apa" }),
    isSetupComplete: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../src/shared/pubpeer-api", () => ({
    lookupPubPeerForDoi: vi.fn(() => new Promise(() => {})),
}));

import { renderResolvedReferences } from "../../src/content-general/references";
import type { DoiString } from "../../src/shared/types";

describe("reference pill placement does not force layout", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    });

    it("never reads innerText while choosing where a pill goes", () => {
        expect(REFERENCES_SRC).not.toMatch(/\binnerText\b/);
    });

    it("places a pill without touching innerText at runtime", () => {
        const entry = document.createElement("li");
        entry.innerHTML = "<span>Smith, J. (2020). A paper worth citing here. Journal of Things.</span>";
        document.body.appendChild(entry);

        let innerTextReads = 0;
        const proto = Object.getPrototypeOf(entry) as object;
        Object.defineProperty(entry, "innerText", {
            get() {
                innerTextReads++;
                return this.textContent;
            },
            configurable: true,
        });
        void proto;

        renderResolvedReferences(
            [{ entry: { element: entry, doi: "10.1000/x" as DoiString, doiInText: false, pmcid: null, text: entry.textContent ?? "" }, doi: "10.1000/x" as DoiString, mode: "augment" }],
            new Map(),
            new Map()
        );

        expect(innerTextReads).toBe(0);
        expect(entry.querySelector(".flora-indicator-pill")).not.toBeNull();
    });
});
