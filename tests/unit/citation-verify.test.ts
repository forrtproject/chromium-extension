import {describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach} from "vitest";
import {http, HttpResponse} from "msw";
import {setupServer} from "msw/node";

vi.mock("../../src/shared/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({email: "test@example.com"}),
  isSetupComplete: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../src/shared/request-gate", () => ({
  RequestGate: class {
    fetch(url: string, init?: RequestInit) {
      return fetch(url, init);
    }
  },
}));

import {verifyAgainstCitation, citationTokens, augmentDOIs, _resetAugmentCachesForTesting} from "../../src/shared/doi-augment";

const WAKEFIELD =
  "Wakefield, A. J., Murch, S. H., Anthony, A., et al. (1998). Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children. The Lancet, 351(9103), 637–641.";

describe("verifyAgainstCitation", () => {
  it("tokenises across styles: dashes split page ranges, diacritics are stripped", () => {
    const t = citationTokens("Müller-Lyer, F. (1889). Optische Urteilstäuschungen. Arch. 2, 263–270.");
    for (const tok of ["muller", "lyer", "1889", "263", "270"]) expect(t.has(tok)).toBe(true);
  });

  it("accepts the cited article and ignores Crossref's RETRACTED: prefix", () => {
    const v = verifyAgainstCitation(WAKEFIELD, {
      title: "RETRACTED: Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children",
      firstAuthor: "Wakefield", year: 1998, containerTitle: "The Lancet", volume: "351", firstPage: "637",
    });
    expect(v).not.toBeNull();
    expect(v!.coverage).toBe(100);
    expect(v!.matches).toEqual({year: true, author: true, locator: true});
  });

  it("rejects the retraction notice (wrong year) and a same-titled letter (wrong author)", () => {
    expect(verifyAgainstCitation(WAKEFIELD, {
      title: "Retraction—Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children",
      firstAuthor: "The Editors of The Lancet", year: 2010, containerTitle: "The Lancet", volume: "375", firstPage: "445",
    })).toBeNull();
    expect(verifyAgainstCitation(WAKEFIELD, {
      title: "Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children",
      firstAuthor: "Sabra", year: 1998, containerTitle: "The Lancet", volume: "352", firstPage: "234",
    })).toBeNull();
  });

  it("lets a subtitle-less candidate title through above 80 % coverage, and blocks below", () => {
    const cite = "Bem, D. J. (2011). Feeling the future: Experimental evidence for anomalous retroactive influences on cognition and affect. Journal of Personality and Social Psychology, 100(3), 407–425.";
    expect(verifyAgainstCitation(cite, {title: "Feeling the future: Experimental evidence for anomalous retroactive influences on cognition and affect", firstAuthor: "Bem", year: 2011, volume: "100"})).not.toBeNull();
    expect(verifyAgainstCitation(cite, {title: "Feeling the future of quantum gravity in curved spacetime models", firstAuthor: "Bem", year: 2011, volume: "100"})).toBeNull();
  });

  it("requires year, author and locator all confirmed for a generic short title", () => {
    const cite = "Smith, J. (2011). Editorial. Journal of Mock Studies, 12(1), 1–2.";
    expect(verifyAgainstCitation(cite, {title: "Editorial", firstAuthor: "Smith", year: 2011, containerTitle: "Journal of Mock Studies", volume: "12"})).not.toBeNull();
    // Same generic title, different volume and journal → cannot be confirmed.
    expect(verifyAgainstCitation(cite, {title: "Editorial", firstAuthor: "Smith", year: 2011, containerTitle: "Annals of Something Else", volume: "40"})).toBeNull();
    // No locator fields at all on the candidate: a generic title is not enough.
    expect(verifyAgainstCitation(cite, {title: "Editorial", firstAuthor: "Smith", year: 2011})).toBeNull();
  });

  it("does not let a field the candidate lacks contradict, but needs two confirmed fields", () => {
    const title = "Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children";
    // No locator fields on the candidate (a preprint, say): year + author carry it.
    const v = verifyAgainstCitation(WAKEFIELD, {title, firstAuthor: "Wakefield", year: 1998});
    expect(v).not.toBeNull();
    expect(v!.matches).toEqual({year: true, author: true, locator: false});
    // Title alone, nothing to corroborate: not enough.
    expect(verifyAgainstCitation(WAKEFIELD, {title, firstAuthor: null, year: null})).toBeNull();
  });

  it("binds the first author to the start of the entry, so the author of a second work cannot stand in", () => {
    const two = "Smith, J., Jones, R. (2020). Alpha beta gamma delta. Journal of Tests, 12, 56–60. Brown, T. (2021). Epsilon zeta eta theta. Other Journal, 20, 77–80.";
    expect(verifyAgainstCitation(two, {title: "Alpha beta gamma delta", firstAuthor: "Brown", year: 2021, volume: "20", firstPage: "77"})).toBeNull();
    expect(verifyAgainstCitation(two, {title: "Alpha beta gamma delta", firstAuthor: "Smith", year: 2020, volume: "12", firstPage: "56"})).not.toBeNull();
  });

  it("does not let one number serve as year and volume, and ignores generic journal words", () => {
    const cite = "Smith, J. (2020). Alpha beta gamma delta. Journal of Chemistry, 12(1), 2021–2025.";
    // Year matched by the page token, volume by the year token: nothing left for the locator.
    expect(verifyAgainstCitation(cite, {title: "Alpha beta gamma delta", firstAuthor: "Smith", year: 2021, volume: "2021", firstPage: "9"})).toBeNull();
    // "Journal of Biology" shares only the generic word "journal" with the citation.
    expect(verifyAgainstCitation(cite, {title: "Alpha beta gamma delta", firstAuthor: "Smith", year: 2020, containerTitle: "Journal of Biology", volume: "99", firstPage: "999"})).toBeNull();
    expect(verifyAgainstCitation(cite, {title: "Alpha beta gamma delta", firstAuthor: "Smith", year: 2020, containerTitle: "Journal of Chemistry", volume: "99", firstPage: "999"})).not.toBeNull();
  });

  it("handles non-Latin scripts: mixed-script wrong titles are rejected, CJK titles remain matchable", () => {
    const cite = "Li, X. (2020). A study 机器学习模型. Journal of Tests, 12, 10.";
    expect(verifyAgainstCitation(cite, {title: "A study 金融市场", firstAuthor: "Li", year: 2020, volume: "12", firstPage: "10"})).toBeNull();
    expect(verifyAgainstCitation("李明 (2020). 机器学习模型研究. 计算机学报, 43, 1–10.", {title: "机器学习模型研究", firstAuthor: "李明", year: 2020, volume: "43", firstPage: "1"})).not.toBeNull();
  });
});

describe("augmentDOIs with citation requests", () => {
  const server = setupServer();
  beforeAll(() => server.listen({onUnhandledRequest: "bypass"}));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  beforeEach(() => {
    _resetAugmentCachesForTesting();
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("queries Crossref alone via query.bibliographic and prefers the journal article over its preprint", async () => {
    const seen: string[] = [];
    server.use(
      http.get("https://api.crossref.org/works", ({request}) => {
        seen.push(request.url);
        return HttpResponse.json({message: {items: [
          {DOI: "10.31234/osf.io/abcde", title: ["Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children"],
            author: [{family: "Wakefield"}], issued: {"date-parts": [[1998]]}},
          {DOI: "10.1016/S0140-6736(97)11096-0", title: ["RETRACTED: Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children"],
            author: [{family: "Wakefield"}], issued: {"date-parts": [[1998, 2]]}, "container-title": ["The Lancet"], volume: "351", page: "637-641"},
        ]}});
      }),
      http.get("https://api.openalex.org/works", ({request}) => {
        seen.push(request.url);
        return HttpResponse.json({results: []});
      }),
    );

    const results = await augmentDOIs([{title: WAKEFIELD, kind: "citation"}]);
    expect(results.get(WAKEFIELD)).toBe("10.1016/s0140-6736(97)11096-0");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("api.crossref.org");
    expect(seen[0]).toContain("query.bibliographic=");
  });

  it("does not reuse a whole-citation miss cached under the title-matching rules", async () => {
    const {normalizeTitle} = await import("../../src/shared/doi-augment");
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      flora_doi_blob: {[normalizeTitle(WAKEFIELD)]: {v: {found: false, doi: null}, t: Date.now()}},
    });
    let crossrefCalls = 0;
    server.use(
      http.get("https://api.crossref.org/works", () => {
        crossrefCalls++;
        return HttpResponse.json({message: {items: [
          {DOI: "10.1016/S0140-6736(97)11096-0", title: ["RETRACTED: Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children"],
            author: [{family: "Wakefield"}], issued: {"date-parts": [[1998, 2]]}, "container-title": ["The Lancet"], volume: "351", page: "637-641"},
        ]}});
      }),
    );
    const results = await augmentDOIs([{title: WAKEFIELD, kind: "citation"}]);
    expect(crossrefCalls).toBe(1);
    expect(results.get(WAKEFIELD)).toBe("10.1016/s0140-6736(97)11096-0");
  });
});
