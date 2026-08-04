import { describe, it, expect, beforeEach } from "vitest";
import type { DoiString, LookupState } from "../../src/shared/types";
import { renderMatchedBanner, removeBanner } from "../../src/content-general/injector";
import { doi, mockResult } from "../helpers";

const MOCK_RESULT = mockResult();
const BANNER_ID = "flora-banner-host";

describe("injector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.style.removeProperty("padding-top");
  });

  describe("renderMatchedBanner", () => {
    it("removes banner when matched array is empty", () => {
      renderMatchedBanner([]);
      expect(document.getElementById(BANNER_ID)).toBeNull();
    });

    it("removes banner when result has no replications or reproductions", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 0, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);
      expect(document.getElementById(BANNER_ID)).toBeNull();
    });

    it("renders banner when replications exist", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 2, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);

      expect(document.getElementById(BANNER_ID)).not.toBeNull();
    });

    it("renders banner when reproductions exist", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 0, n_reproductions_total: 1 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);

      expect(document.getElementById(BANNER_ID)).not.toBeNull();
    });

    it("shows replication count in banner text", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 3, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);

      const banner = document.getElementById(BANNER_ID);
      expect(banner?.textContent).toContain("3 replications");
    });

    it("uses singular label for one replication", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 1, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);

      const banner = document.getElementById(BANNER_ID);
      expect(banner?.textContent).toContain("1 replication");
      expect(banner?.textContent).not.toContain("replications");
    });

    it("shows View details link pointing to FORRT Atlas with encoded DOI", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 1, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);

      const banner = document.getElementById(BANNER_ID);
      const link = banner?.querySelector<HTMLAnchorElement>('a[href*="forrt.org"]');
      expect(link).not.toBeNull();
      expect(link?.href).toContain("10.1038%2Fnature12373");
    });

    it("shows multi-DOI summary text when multiple DOIs match", () => {
      const result1 = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 2, n_reproductions_total: 0 },
        },
      });
      const result2 = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 1, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([
        { doi: "10.1038/nature12373", result: result1 },
        { doi: "10.1000/other.doi", result: result2 },
      ]);

      const banner = document.getElementById(BANNER_ID);
      expect(banner?.textContent).toContain("2 DOIs");
    });

    it("replaces existing banner instead of stacking", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 1, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);
      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);

      expect(document.querySelectorAll(`#${BANNER_ID}`)).toHaveLength(1);
    });
  });

  describe("removeBanner", () => {
    it("removes the banner element", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 1, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);
      expect(document.getElementById(BANNER_ID)).not.toBeNull();

      removeBanner();
      expect(document.getElementById(BANNER_ID)).toBeNull();
    });

    it("does not throw when no banner is present", () => {
      expect(() => removeBanner()).not.toThrow();
    });
  });
});
