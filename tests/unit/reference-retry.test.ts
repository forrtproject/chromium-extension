import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { beginDomScanPass, findReferenceEntries } from "../../src/shared/doi-extractor";
import type { DoiString } from "../../src/shared/types";

const augmentMock = vi.fn();
const pmcMock = vi.fn();

vi.mock("../../src/shared/messages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/shared/messages")>()),
  augmentDOIsViaWorker: (...args: unknown[]) => augmentMock(...args),
  resolvePmcIdsViaWorker: (...args: unknown[]) => pmcMock(...args),
}));

vi.mock("../../src/shared/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({
    email: "test@example.com",
    showDoiPillsOnAllReferences: false,
    citationStyle: "apa",
    cacheQuotaMb: 50,
  }),
  isSetupComplete: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/shared/doi-validate", () => ({
  validateDOIs: vi.fn(async (dois: string[]) => new Map(dois.map((d) => [d, true]))),
}));

const PROCESSED_ATTR = "data-flora-ref-processed";

function loadFixture(): void {
  const html = readFileSync(join(__dirname, "..", "fixtures", "science-org-article.html"), "utf-8");
  document.documentElement.innerHTML = html
    .replace(/^[\s\S]*?<body[^>]*>/i, "")
    .replace(/<\/body>[\s\S]*$/i, "");
}

function augmentTargetElement(): HTMLElement {
  const target = findReferenceEntries(document).find((e) => e.doi === null);
  if (!target) throw new Error("fixture has no DOI-less reference entry");
  return target.element as HTMLElement;
}

function entriesWithMark(): number {
  return document.querySelectorAll(`[${PROCESSED_ATTR}]`).length;
}

describe("reference entries are retried when a lookup never answered", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    augmentMock.mockReset();
    pmcMock.mockReset().mockResolvedValue(new Map());
    loadFixture();
    beginDomScanPass();
  });

  it("releases the entry when the augment lookup answered for nothing", async () => {
    const { resolveReferenceDois } = await import("../../src/content-general/references");
    augmentMock.mockResolvedValue(new Map());

    const target = augmentTargetElement();
    await resolveReferenceDois();

    expect(target.hasAttribute(PROCESSED_ATTR)).toBe(false);
  });

  it("keeps the entry marked when the lookup answered 'no match'", async () => {
    const { resolveReferenceDois } = await import("../../src/content-general/references");
    augmentMock.mockImplementation(async (titles: string[]) =>
      new Map(titles.map((t) => [t, null]))
    );

    const target = augmentTargetElement();
    await resolveReferenceDois();

    expect(target.hasAttribute(PROCESSED_ATTR)).toBe(true);
  });

  it("resolves on a later pass after a failed one", async () => {
    const { resolveReferenceDois } = await import("../../src/content-general/references");
    augmentMock.mockRejectedValueOnce(new Error("worker gone"));

    expect(await resolveReferenceDois()).toEqual(
      expect.arrayContaining([expect.objectContaining({ mode: "hidden" })])
    );

    augmentMock.mockImplementation(async (titles: string[]) =>
      new Map(titles.map((t) => [t, "10.1234/recovered" as DoiString]))
    );
    const second = await resolveReferenceDois();

    expect(second.map((r) => r.mode)).toContain("augment");
  });

  it("does not re-augment entries that already resolved", async () => {
    const { resolveReferenceDois } = await import("../../src/content-general/references");
    augmentMock.mockImplementation(async (titles: string[]) =>
      new Map(titles.map((t) => [t, "10.1234/found" as DoiString]))
    );

    await resolveReferenceDois();
    const markedAfterFirst = entriesWithMark();
    augmentMock.mockClear();

    await resolveReferenceDois();

    expect(augmentMock).not.toHaveBeenCalled();
    expect(entriesWithMark()).toBe(markedAfterFirst);
  });
});
