import {afterEach, describe, expect, it, vi} from "vitest";

const KEY = "flora_hidden_pubpeer_commenters";

describe("pubpeer commenter filter", () => {
  afterEach(() => {
    vi.resetModules();
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockReset();
    (chrome.storage.sync.set as ReturnType<typeof vi.fn>).mockReset();
  });

  it("defaults to muting FORRT when nothing is stored", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const {getHiddenCommenters} = await import("../../src/shared/pubpeer-filter");

    await expect(getHiddenCommenters()).resolves.toEqual(["FORRT"]);
  });

  it("returns the stored list when the user has customised it", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [KEY]: ["FORRT", "Noisy Reviewer"],
    });

    const {getHiddenCommenters} = await import("../../src/shared/pubpeer-filter");

    await expect(getHiddenCommenters()).resolves.toEqual(["FORRT", "Noisy Reviewer"]);
  });

  it("honours an explicitly empty list instead of re-applying the default", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({[KEY]: []});

    const {getHiddenCommenters} = await import("../../src/shared/pubpeer-filter");

    await expect(getHiddenCommenters()).resolves.toEqual([]);
  });

  it("caches reads within a module lifecycle", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({[KEY]: ["FORRT"]});

    const {getHiddenCommenters} = await import("../../src/shared/pubpeer-filter");

    await getHiddenCommenters();
    await getHiddenCommenters();
    expect(chrome.storage.sync.get).toHaveBeenCalledTimes(1);
  });

  it("updates the cache when the list is saved", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({[KEY]: ["FORRT"]});
    (chrome.storage.sync.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const {getHiddenCommenters, saveHiddenCommenters} = await import(
      "../../src/shared/pubpeer-filter"
    );

    await saveHiddenCommenters(["Someone Else"]);
    await expect(getHiddenCommenters()).resolves.toEqual(["Someone Else"]);
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({[KEY]: ["Someone Else"]});
  });

  describe("isHiddenCommenter", () => {
    it("matches regardless of case or surrounding whitespace", async () => {
      const {isHiddenCommenter} = await import("../../src/shared/pubpeer-filter");

      expect(isHiddenCommenter("forrt", ["FORRT"])).toBe(true);
      expect(isHiddenCommenter("  FORRT  ", ["forrt"])).toBe(true);
    });

    it("does not match unrelated commenters", async () => {
      const {isHiddenCommenter} = await import("../../src/shared/pubpeer-filter");

      expect(isHiddenCommenter("Anolis Jacare", ["FORRT"])).toBe(false);
    });

    it("is false for a blank id and for an empty list", async () => {
      const {isHiddenCommenter} = await import("../../src/shared/pubpeer-filter");

      expect(isHiddenCommenter("   ", ["FORRT"])).toBe(false);
      expect(isHiddenCommenter("FORRT", [])).toBe(false);
    });
  });
});
