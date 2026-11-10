import {afterEach, beforeEach, expect, it, vi} from "vitest";

const SHARED = "10.1234/printed.and.matched";

vi.mock("../../src/shared/settings", () => ({
    getSettings: vi.fn().mockResolvedValue({email: "test@example.com", cacheQuotaMb: 50}),
    isSetupComplete: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/shared/doi-validate", () => ({
    validateDOIs: vi.fn(async (dois: string[]) => new Map(dois.map((doi) => [doi, false]))),
}));

vi.mock("../../src/shared/messages", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/shared/messages")>()),
    augmentDOIsViaWorker: vi.fn(async (inputs: Array<string | {title: string}>) =>
        new Map(inputs.map((input) => [typeof input === "string" ? input : input.title, SHARED]))),
    resolvePmcIdsViaWorker: vi.fn().mockResolvedValue(new Map()),
}));

import {resolveReferenceDois} from "../../src/content-general/references";
import {beginDomScanPass} from "../../src/shared/doi-extractor";

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    document.documentElement.innerHTML = `<head></head><body>
        <ol class="references">
          <li>Smith J. A cited paper with its DOI printed. Journal of Tests. 2020. https://doi.org/${SHARED}</li>
          <li>Jones K. A cited paper without any identifier at all. Journal of Tests. 2021;12:34-56.</li>
        </ol>
      </body>`;
    beginDomScanPass();
});

afterEach(() => vi.unstubAllGlobals());

it("keeps a printed DOI on an ordinary page even when doi.org rejects the same DOI found by title search", async () => {
    const resolved = await resolveReferenceDois();
    expect(resolved.map((r) => [r.doi, r.mode])).toEqual([[SHARED, "page"]]);
});
