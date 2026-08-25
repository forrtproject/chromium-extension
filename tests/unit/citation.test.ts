import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
  CITATION_FORMATS,
  citationFormat,
  fetchCitation,
  tidyCitation,
  tidyCitationHtml,
  _resetCitationCacheForTesting,
} from "../../src/shared/citation";

const DOI = "10.1037/0003-066X.59.1.29";

function okText(body: string): Response {
  return {ok: true, status: 200, text: () => Promise.resolve(body)} as unknown as Response;
}

function notFound(): Response {
  return {ok: false, status: 404, text: () => Promise.resolve("")} as unknown as Response;
}

describe("citation formats", () => {
  it("falls back to APA for an unknown or missing style id", () => {
    expect(citationFormat("apa").id).toBe("apa");
    expect(citationFormat("no-such-style").id).toBe("apa");
    expect(citationFormat(undefined).id).toBe("apa");
  });

  it("asks for each CSL style by name, and exports by content type", () => {
    expect(citationFormat("ieee").accept).toContain("style=ieee");
    expect(citationFormat("bibtex").accept).toBe("application/x-bibtex");
    expect(citationFormat("ris").accept).toBe("application/x-research-info-systems");
  });
});

describe("tidyCitation", () => {
  const apa = citationFormat("apa");

  it("reduces CSL markup to the plain text that goes on the clipboard", () => {
    expect(tidyCitation("Pelletier, A. (2023). <i>pathseq</i> &amp; friends.", apa))
      .toBe("Pelletier, A. (2023). pathseq & friends.");
  });

  it("drops the bibliography number numeric styles prefix the entry with", () => {
    expect(tidyCitation("[1]O. Ray, “Title,” Journal, 2004.", citationFormat("ieee")))
      .toBe("O. Ray, “Title,” Journal, 2004.");
    expect(tidyCitation("1.Ray O. Title. Journal. 2004.", citationFormat("american-medical-association")))
      .toBe("Ray O. Title. Journal. 2004.");
  });

  it("removes the dangling editor phrase left by records with an empty editor list", () => {
    expect(tidyCitation("Ray, O. “Title.” American Psychologist, edited by , vol. 59, 2004.", apa))
      .toBe("Ray, O. “Title.” American Psychologist, vol. 59, 2004.");
    expect(tidyCitation("Ray, O. (2004) “Title,” American Psychologist. Edited by , 59(1).", apa))
      .toBe("Ray, O. (2004) “Title,” American Psychologist. 59(1).");
    expect(tidyCitation("Ray, O. 2004. “Title.” edited by . American Psychologist 59(1).", apa))
      .toBe("Ray, O. 2004. “Title.” American Psychologist 59(1).");
    expect(tidyCitation("Ray O. Title. , ed. American Psychologist. 2004.", apa))
      .toBe("Ray O. Title. American Psychologist. 2004.");
  });

  it("keeps reference-manager exports byte-for-byte apart from markup", () => {
    const ris = "TY  - JOUR\nTI  - Title\nAU  - Ray, Oakley\nER  - ";
    expect(tidyCitation(ris, citationFormat("ris"))).toBe(ris.trim());
  });
});

describe("tidyCitationHtml", () => {
  const apa = citationFormat("apa");

  it("keeps the emphasis a style depends on and drops everything else", () => {
    expect(tidyCitationHtml(
      `<div class="csl-entry">Ray, O. <i>American Psychologist</i>, <b>59</b>.</div>`, apa
    )).toBe("Ray, O. <i>American Psychologist</i>, <b>59</b>.");
  });

  it("strips attributes rather than passing them to the clipboard", () => {
    expect(tidyCitationHtml(`Ray, O. <i style="color:red" onclick="x()">Title</i>.`, apa))
      .toBe("Ray, O. <i>Title</i>.");
    expect(tidyCitationHtml(`Ray, O. <span style="font-variant:small-caps">Title</span>.`, apa))
      .toBe("Ray, O. Title.");
  });

  it("leaves entities encoded, since the clipboard flavour is HTML", () => {
    expect(tidyCitationHtml("Pelletier, A. <i>pathseq</i> &amp; friends.", apa))
      .toBe("Pelletier, A. <i>pathseq</i> &amp; friends.");
  });

  it("restores journal and volume italics when the resolver returns plain text", () => {
    expect(tidyCitationHtml(
      "Ray, O. (2004). How the Mind Hurts and Heals the Body. American Psychologist, 59(1), 29–40.",
      apa
    )).toBe(
      "Ray, O. (2004). How the Mind Hurts and Heals the Body. " +
      "<i>American Psychologist</i>, <i>59</i>(1), 29–40."
    );
  });

  it("italicises the journal occurrence rather than a matching title phrase", () => {
    expect(tidyCitationHtml(
      "Ray, O. (2004). American Psychologist reveals how the field changed. American Psychologist, 59(1), 29–40.",
      apa
    )).toBe(
      "Ray, O. (2004). American Psychologist reveals how the field changed. " +
      "<i>American Psychologist</i>, <i>59</i>(1), 29–40."
    );
  });

  it("skips the publication year when italicising Vancouver and AMA volumes", () => {
    expect(tidyCitationHtml(
      "Ray O. How the Mind Hurts and Heals the Body. American Psychologist 2004;59:29–40.",
      citationFormat("elsevier-vancouver")
    )).toBe(
      "Ray O. How the Mind Hurts and Heals the Body. " +
      "<i>American Psychologist</i> 2004;<i>59</i>:29–40."
    );
    expect(tidyCitationHtml(
      "Ray O. How the Mind Hurts and Heals the Body. American Psychologist. 2004;59(1):29-40.",
      citationFormat("american-medical-association")
    )).toBe(
      "Ray O. How the Mind Hurts and Heals the Body. " +
      "<i>American Psychologist</i>. 2004;<i>59</i>(1):29-40."
    );
  });

  it("uses the selected style's journal punctuation to preserve its emphasis", () => {
    expect(tidyCitationHtml(
      "[1]O. Ray, “How the Mind Hurts and Heals the Body.,” American Psychologist, vol. 59, no. 1, pp. 29–40, 2004, doi: x.",
      citationFormat("ieee")
    )).toContain("<i>American Psychologist</i>");
    expect(tidyCitationHtml(
      "Ray, Oakley. “How the Mind Hurts and Heals the Body.” American Psychologist, vol. 59, no. 1, 2004, pp. 29–40.",
      citationFormat("modern-language-association")
    )).toBe(
      "Ray, Oakley. “How the Mind Hurts and Heals the Body.” " +
      "<i>American Psychologist</i>, vol. 59, no. 1, 2004, pp. 29–40."
    );
  });

  it("drops the bibliography number, wrapper and all", () => {
    expect(tidyCitationHtml(`<div class="csl-entry">[1]O. Ray, "Title," 2004.</div>`, citationFormat("ieee")))
      .toBe(`O. Ray, "Title," 2004.`);
  });

  it("has no rich flavour to offer for BibTeX or RIS", () => {
    expect(tidyCitationHtml("@article{ray2004}", citationFormat("bibtex"))).toBeNull();
    expect(tidyCitationHtml("TY  - JOUR", citationFormat("ris"))).toBeNull();
  });
});

describe("fetchCitation", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetCitationCacheForTesting();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders via Crossref's transform endpoint, asking for the chosen style", async () => {
    fetchMock.mockResolvedValue(okText("Ray, O. (2004). Title. American Psychologist."));

    await expect(fetchCitation(DOI, "chicago-author-date"))
      .resolves.toMatchObject({text: "Ray, O. (2004). Title. American Psychologist."});

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("api.crossref.org/works/");
    expect(url).toContain("/transform");
    expect(init.headers.Accept).toContain("style=chicago-author-date");
  });

  it("caches a rendered citation per DOI and format", async () => {
    fetchMock.mockResolvedValue(okText("Ray, O. (2004). Title."));

    await fetchCitation(DOI, "apa");
    await fetchCitation(DOI, "apa");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await fetchCitation(DOI, "ieee");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent requests for the same citation", async () => {
    fetchMock.mockResolvedValue(okText("Ray, O. (2004). Title."));

    await Promise.all([fetchCitation(DOI, "apa"), fetchCitation(DOI, "apa")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to doi.org for DOIs Crossref does not own", async () => {
    // DataCite DOIs (Zenodo, figshare, datasets) 404 at Crossref.
    fetchMock
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(okText("Pelletier, A. (2023). pathseq. Zenodo."));

    await expect(fetchCitation("10.5281/zenodo.7942546", "apa"))
      .resolves.toMatchObject({text: "Pelletier, A. (2023). pathseq. Zenodo."});
    expect(fetchMock.mock.calls[1][0]).toBe("https://doi.org/10.5281/zenodo.7942546");
  });

  it("does not cache a failure, so an outage doesn't suppress the citation", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(fetchCitation(DOI, "apa")).resolves.toBeNull();

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okText("Ray, O. (2004). Title."));
    await expect(fetchCitation(DOI, "apa")).resolves.toMatchObject({text: "Ray, O. (2004). Title."});
  });

  it("carries both flavours of the entry, so a paste keeps its italics", async () => {
    fetchMock.mockResolvedValue(okText(
      `<div class="csl-entry">Ray, O. (2004). Title. <i>American Psychologist</i>, 59(1).</div>`
    ));

    await expect(fetchCitation(DOI, "apa")).resolves.toEqual({
      text: "Ray, O. (2004). Title. American Psychologist, 59(1).",
      html: "Ray, O. (2004). Title. <i>American Psychologist</i>, 59(1).",
    });
  });

  it("offers no rich flavour for reference-manager exports", async () => {
    fetchMock.mockResolvedValue(okText("TY  - JOUR\nTI  - Title\nER  - "));
    await expect(fetchCitation(DOI, "ris")).resolves.toMatchObject({html: null});
  });

  it("offers the styles Google Scholar does, plus BibTeX and RIS", () => {
    const labels = CITATION_FORMATS.map((format) => format.label);
    for (const expected of ["APA", "MLA", "Chicago", "Harvard", "Vancouver", "BibTeX"]) {
      expect(labels).toContain(expected);
    }
  });
});
