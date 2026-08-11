import {describe, expect, it} from "vitest";
import {titleCoverage, tokenSetRatio} from "../../src/shared/doi-augment";

const COVERAGE_THRESHOLD = 75;

describe("title coverage guard", () => {
    // research.rug.nl/en/publications/failure-to-replicate-increasing-generosity-by-eyes
    // resolved to a 2022 New Scientist item called simply "Failure to replicate".
    it("rejects a generic title that is a subset of the queried one", () => {
        const query = "Failure to replicate increasing generosity by eyes";
        const candidate = "Failure to replicate";

        expect(tokenSetRatio(query, candidate)).toBe(100);
        expect(titleCoverage(query, candidate)).toBeLessThan(COVERAGE_THRESHOLD);
    });

    it("keeps a candidate that only lacks the subtitle", () => {
        const query = "Estimating the reproducibility of psychological science: a replication";
        const candidate = "Estimating the reproducibility of psychological science";

        expect(titleCoverage(query, candidate)).toBeGreaterThanOrEqual(COVERAGE_THRESHOLD);
    });

    it.each([
        ["The FAIR Guiding Principles for scientific data management and stewardship",
         "The FAIR Guiding Principles for scientific data management and stewardship"],
        ["A manifesto for reproducible science", "A manifesto for reproducible science"],
    ])("keeps an exact match (%s)", (query, candidate) => {
        expect(titleCoverage(query, candidate)).toBe(100);
    });

    it("is unaffected by extra words in the candidate", () => {
        // Supersets still cover the query fully; the tie-break handles those.
        const query = "The FAIR Guiding Principles for scientific data management and stewardship";
        const candidate = "Addendum: The FAIR Guiding Principles for scientific data management and stewardship";

        expect(titleCoverage(query, candidate)).toBe(100);
    });

    it("scores nothing for an unrelated title", () => {
        expect(titleCoverage("Failure to replicate increasing generosity by eyes", "Cell migration in zebrafish"))
            .toBeLessThan(COVERAGE_THRESHOLD);
    });
});
