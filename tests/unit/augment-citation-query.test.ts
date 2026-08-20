import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

vi.mock("../../src/shared/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ email: "test@example.com" }),
  isSetupComplete: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/shared/request-gate", () => ({
  RequestGate: class {
    fetch(url: string, init?: RequestInit) {
      return fetch(url, init);
    }
  },
}));

import { augmentDOIs, _resetAugmentCachesForTesting } from "../../src/shared/doi-augment";

const OPENALEX_URL = "https://api.openalex.org/works";
const CROSSREF_URL = "https://api.crossref.org/works";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function crossrefReturns(...titles: Array<[doi: string, title: string]>): void {
  server.use(
    http.get(CROSSREF_URL, () =>
      HttpResponse.json({
        message: { items: titles.map(([DOI, title]) => ({ DOI, title: [title] })) },
      })
    ),
    http.get(OPENALEX_URL, () => HttpResponse.json({ results: [] }))
  );
}

describe("augmenting from a whole citation string", () => {
  beforeEach(() => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    _resetAugmentCachesForTesting();
  });

  const CITATION =
    "Andersson, L. M., and C. M. Pearson. 1999. “Tit for tat? The spiraling effect of"
    + " incivility in the workplace.” Academy of Management Review 452–471.";

  it("resolves a reference whose title is buried in authors, journal and pages", async () => {
    crossrefReturns(["10.2307/259136", "Tit for Tat? The Spiraling Effect of Incivility in the Workplace"]);

    const results = await augmentDOIs([{ title: CITATION, titleIsFullCitation: true, year: 1999 }]);

    expect(results.get(CITATION)).toBe("10.2307/259136");
  });

  it("leaves the same citation unresolved when queried as a bare title", async () => {
    crossrefReturns(["10.2307/259136", "Tit for Tat? The Spiraling Effect of Incivility in the Workplace"]);

    const results = await augmentDOIs([CITATION]);

    expect(results.get(CITATION)).toBeNull();
  });

  it("rejects a publisher city the citation happens to name", async () => {
    const citation =
      "Camman, C., M. Fichman, D. Jenkins, and J. Klesh. 1979. “The Michigan organizational"
      + " assessment questionnaire”. Unpublished manuscript, University of Michigan, Ann Arbor.";
    crossrefReturns(["10.1093/mq/lv.3.396", "Ann Arbor, Michigan"]);

    const results = await augmentDOIs([{ title: citation, titleIsFullCitation: true, year: 1979 }]);

    expect(results.get(citation)).toBeNull();
  });

  it("rejects a two-word title that any paper on the topic would match", async () => {
    const citation =
      "Yeung, A., and B. Griffin. 2008. “Workplace incivility: Does it matter in Asia.”"
      + " People and Strategy 31(3): 14–19.";
    crossrefReturns(["10.1097/00005110-200601000-00007", "Workplace Incivility"]);

    const results = await augmentDOIs([{ title: citation, titleIsFullCitation: true, year: 2008 }]);

    expect(results.get(citation)).toBeNull();
  });

  it("picks the cited work over a shorter title the citation also contains", async () => {
    const citation =
      "Kabat-Farr, D., and L. M. Cortina. 2012. “Selective incivility: Gender, race, and the"
      + " discriminatory workplace.” In Gender and the Dysfunctional Workplace, 120–134.";
    crossrefReturns(
      ["10.1037/e518332013-218", "Gender and the Dysfunctional Workplace"],
      ["10.4337/9780857932600.00014", "Selective Incivility: Gender, Race, and the Discriminatory Workplace"]
    );

    const results = await augmentDOIs([{ title: citation, titleIsFullCitation: true, year: 2012 }]);

    expect(results.get(citation)).toBe("10.4337/9780857932600.00014");
  });
});
