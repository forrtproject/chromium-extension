import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/shared/settings", () => ({
    getSettings: vi.fn().mockResolvedValue({
        email: "test@example.com",
        cacheQuotaMb: 50,
    }),
    isSetupComplete: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/shared/doi-validate", () => ({
    validateDOIs: vi.fn(async (dois: string[]) => new Map(dois.map((d) => [d, true]))),
}));

import { resolveReferenceDois } from "../../src/content-general/references";
import { beginDomScanPass } from "../../src/shared/doi-extractor";

const PRINTED = "10.1234/printed.in.the.text";
const IN_HREF = "10.5678/only.in.the.href";

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    document.documentElement.innerHTML = `<head></head><body>
        <ol class="references">
          <li>Smith J. A cited paper. Journal. 2020. https://doi.org/${PRINTED}</li>
          <li>Jones K. Another cited paper. Journal. 2021.
            <a href="https://www.crossref.org/openurl?doi=${IN_HREF}">Crossref</a>
          </li>
        </ol>
      </body>`;
    beginDomScanPass();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("every reference gets a pill", () => {
    it("resolves the entry that prints its DOI as well as the one that hides it", async () => {
        const resolved = await resolveReferenceDois();

        expect(resolved.map((r) => r.doi).sort()).toEqual([PRINTED, IN_HREF].sort());
        expect(resolved.every((r) => r.mode === "page")).toBe(true);
    });

    it("asks the settings for nothing to decide it", async () => {
        const { getSettings } = await import("../../src/shared/settings");

        await resolveReferenceDois();

        expect(getSettings).not.toHaveBeenCalled();
    });
});
