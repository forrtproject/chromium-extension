import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { renderResolvedReferences, type ResolvedReference } from "../../src/content-general/references";
import { INDICATOR_PILL_CLASS } from "../../src/shared/indicator-pill";
import type { DoiString } from "../../src/shared/types";

/**
 * End-to-end placement: drives the real renderResolvedReferences path against
 * markup trimmed from live publisher pages, with the hostname stubbed, and
 * checks where the pill actually lands in the DOM.
 */
function loadIntoDocument(fixture: string): void {
  const html = readFileSync(join(__dirname, "..", "fixtures", fixture), "utf-8");
  document.documentElement.innerHTML = html
    .replace(/^[\s\S]*?<body[^>]*>/i, "")
    .replace(/<\/body>[\s\S]*$/i, "");
}

function setHostname(hostname: string): void {
  Object.defineProperty(window, "location", {
    value: { hostname, href: `https://${hostname}/doi/10.1234/x` },
    writable: true,
    configurable: true,
  });
}

function entriesFromDocument(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('div[role="listitem"]'));
}

describe("reference pill placement (integration)", () => {
  const realLocation = window.location;

  beforeEach(() => {
    // Keep the pill's async lookups from touching the network.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "location", {
      value: realLocation,
      writable: true,
      configurable: true,
    });
    document.documentElement.innerHTML = "";
  });

  for (const [hostname, fixture, container] of [
    ["www.science.org", "science-org-article.html", ".citation"],
    ["journals.sagepub.com", "sagepub-article.html", ".citation"],
  ] as const) {
    it(`puts the pill in ${container} on ${hostname}`, () => {
      setHostname(hostname);
      loadIntoDocument(fixture);

      const entry = entriesFromDocument()[0];
      const resolved: ResolvedReference[] = [
        { entry: { element: entry, dois: ["10.1/a" as DoiString], pmcid: null, text: "ref" }, doi: "10.1/a" as DoiString, mode: "page" },
      ];

      renderResolvedReferences(resolved, new Map(), new Map());

      const placed = entry.querySelector(`.${INDICATOR_PILL_CLASS}`);
      expect(placed).not.toBeNull();
      expect(entry.querySelector(container)!.contains(placed!)).toBe(true);
      expect(entry.querySelector(".external-links")!.contains(placed!)).toBe(false);
    });
  }

  it("falls back to generic placement on an unregistered site", () => {
    setHostname("example.com");
    loadIntoDocument("science-org-article.html");

    const entry = entriesFromDocument()[0];
    const resolved: ResolvedReference[] = [
      { entry: { element: entry, dois: ["10.1/a" as DoiString], pmcid: null, text: "ref" }, doi: "10.1/a" as DoiString, mode: "page" },
    ];

    renderResolvedReferences(resolved, new Map(), new Map());

    const placed = entry.querySelector(`.${INDICATOR_PILL_CLASS}`);
    expect(placed).not.toBeNull();
    const row = placed!.parentElement!;
    expect(row.classList.contains("flora-pill-row")).toBe(true);
    expect(row.parentElement).toBe(entry.querySelector(".citation"));
    expect(row.parentElement!.lastElementChild).toBe(row);
    expect(entry.querySelector(".external-links")!.contains(placed!)).toBe(false);
  });

  it("still places the pill when the adapter's selector no longer matches", () => {
    // Simulates the publisher renaming .citation-content out from under us:
    // the pill must degrade to generic placement, never vanish.
    setHostname("www.science.org");
    loadIntoDocument("science-org-article.html");

    const entry = entriesFromDocument()[0];
    for (const el of entry.querySelectorAll(".citation-content, .citation")) {
      el.className = "renamed-by-publisher";
    }

    const resolved: ResolvedReference[] = [
      { entry: { element: entry, dois: ["10.1/a" as DoiString], pmcid: null, text: "ref" }, doi: "10.1/a" as DoiString, mode: "page" },
    ];

    renderResolvedReferences(resolved, new Map(), new Map());

    expect(entry.querySelector(`.${INDICATOR_PILL_CLASS}`)).not.toBeNull();
  });
});

const GENERIC_DOI = "10.1/a" as DoiString;
const LONG = "Author A, Author B. A reasonably long citation title about replication of findings. Journal of Examples 12:34-56 (2019).";

function renderGeneric(html: string, entrySelector: string): HTMLElement {
  setHostname("example.com");
  document.body.innerHTML = html;
  const entry = document.querySelector<HTMLElement>(entrySelector)!;
  const resolved: ResolvedReference[] = [
    { entry: { element: entry, dois: [GENERIC_DOI], pmcid: null, text: "ref" }, doi: GENERIC_DOI, mode: "page" },
  ];
  renderResolvedReferences(resolved, new Map(), new Map());
  return entry;
}

function rowOf(entry: HTMLElement): HTMLElement {
  const pill = entry.querySelector(`.${INDICATOR_PILL_CLASS}`) ?? entry.nextElementSibling!.querySelector(`.${INDICATOR_PILL_CLASS}`);
  const row = pill!.parentElement!;
  expect(row.classList.contains("flora-pill-row")).toBe(true);
  return row;
}

describe("generic reference placement puts the pill on its own row", () => {
  it("HighWire: after .cit-extra inside .cit", () => {
    const entry = renderGeneric(
      `<ol><li id="e"><div class="cit"><div class="cit-metadata">${LONG}</div><div class="cit-extra"><a href="/x">CrossRef</a> <a href="/y">Google Scholar</a></div></div></li></ol>`, "#e");
    const row = rowOf(entry);
    expect(row.parentElement).toBe(entry.querySelector(".cit"));
    expect(row.previousElementSibling).toBe(entry.querySelector(".cit-extra"));
  });

  it("CSHL: at the end of .ref-cit", () => {
    const entry = renderGeneric(
      `<ol><li id="e"><div class="ref-content"><div class="ref-cit">${LONG}<span class="cit-extra"><a href="/x">Abstract</a></span></div></div></li></ol>`, "#e");
    expect(rowOf(entry).parentElement).toBe(entry.querySelector(".ref-cit"));
  });

  it("ref_layer div: at its end", () => {
    const entry = renderGeneric(`<div class="ref_layer" id="e">${LONG}</div>`, "#e");
    expect(rowOf(entry).parentElement).toBe(entry);
  });

  it("JCI: last child of li.reference, after the linkouts", () => {
    const entry = renderGeneric(
      `<ol><li class="reference" id="e"><div class="reference_text">${LONG}</div><div class="reference_linkouts"><a href="/x">PubMed</a> | <a href="/y">Google Scholar</a></div></li></ol>`, "#e");
    const row = rowOf(entry);
    expect(row.parentElement).toBe(entry);
    expect(entry.lastElementChild).toBe(row);
  });

  it("JMIR: at the end of the li when the text lives in an inline span", () => {
    const entry = renderGeneric(`<ol><li id="e"><span id="ref2">${LONG}</span></li></ol>`, "#e");
    expect(rowOf(entry).parentElement).toBe(entry);
  });

  it("Ubiquity: at the end of the paragraph inside the li", () => {
    const entry = renderGeneric(
      `<ul class="reference-list"><li id="e"><p>${LONG} DOI: <a href="https://doi.org/10.1/a">https://doi.org/10.1/a</a></p></li></ul>`, "#e");
    expect(rowOf(entry).parentElement).toBe(entry.querySelector("p"));
  });

  it("OJS: at the end of a paragraph ending in the doi link", () => {
    const entry = renderGeneric(`<p id="e">${LONG} <a href="https://doi.org/10.1/a">https://doi.org/10.1/a</a></p>`, "#e");
    const row = rowOf(entry);
    expect(row.parentElement).toBe(entry);
    expect(entry.lastElementChild).toBe(row);
  });

  it("a table row: in its last cell", () => {
    const entry = renderGeneric(`<table><tbody><tr id="e"><td>1</td><td>${LONG}</td></tr></tbody></table>`, "#e");
    expect(rowOf(entry).parentElement).toBe(entry.querySelectorAll("td")[1]);
  });

  it("an entry with no links at all", () => {
    const entry = renderGeneric(`<ol><li id="e">${LONG}</li></ol>`, "#e");
    expect(rowOf(entry).parentElement).toBe(entry);
  });

  it("a flex entry: the row follows the entry", () => {
    const entry = renderGeneric(
      `<ol><li id="e" style="display:flex"><div>${LONG}</div><div>Google Scholar PubMed links here</div></li></ol>`, "#e");
    expect(entry.nextElementSibling!.classList.contains("flora-pill-row")).toBe(true);
    expect(entry.querySelector(".flora-pill-row")).toBeNull();
  });

  it("replaces a loose pill for the same DOI already inside the entry", () => {
    setHostname("example.com");
    document.body.innerHTML =
      `<ol><li id="e">${LONG} <span class="flora-pill-row" data-flora-ui><span class="${INDICATOR_PILL_CLASS}" data-flora-loose-pill data-flora-doi="${GENERIC_DOI}"></span></span></li></ol>`;
    const entry = document.querySelector<HTMLElement>("#e")!;
    renderResolvedReferences(
      [{ entry: { element: entry, dois: [GENERIC_DOI], pmcid: null, text: "ref" }, doi: GENERIC_DOI, mode: "page" }],
      new Map(), new Map());
    const pills = entry.querySelectorAll(`.${INDICATOR_PILL_CLASS}`);
    expect(pills).toHaveLength(1);
    expect(pills[0].hasAttribute("data-flora-loose-pill")).toBe(false);
    expect(entry.querySelectorAll(".flora-pill-row")).toHaveLength(1);
  });

  it("stacks the DOIs of a multi-DOI entry into one pill", () => {
    setHostname("example.com");
    const other = "10.1/b" as DoiString;
    document.body.innerHTML =
      `<ol><li id="e">${LONG} <span class="flora-pill-row" data-flora-ui><span class="${INDICATOR_PILL_CLASS}" data-flora-loose-pill data-flora-doi="${other}"></span></span></li></ol>`;
    const element = document.querySelector<HTMLElement>("#e")!;
    const entry = { element, dois: [GENERIC_DOI, other], pmcid: null, text: "ref" };
    renderResolvedReferences(
      [{ entry, doi: GENERIC_DOI, mode: "page" }, { entry, doi: other, mode: "page" }],
      new Map(), new Map());
    const stack = rowOf(element).querySelector<HTMLElement>("[data-flora-stack]")!;
    expect([...rowOf(element).children]).toEqual([stack]);
    const pills = [...stack.querySelectorAll(`.${INDICATOR_PILL_CLASS}[data-flora-doi]`)];
    expect(pills.map((p) => p.getAttribute("data-flora-doi"))).toEqual([GENERIC_DOI, other]);
    expect(element.querySelector("[data-flora-loose-pill]")).toBeNull();
    expect(element.querySelectorAll(".flora-pill-row")).toHaveLength(1);
  });

  it("shows a reference's notice on its indicator pill, with no stand-alone notice pill", () => {
    setHostname("example.com");
    document.body.innerHTML = `<ol><li id="e">${LONG}</li></ol>`;
    const entry = document.querySelector<HTMLElement>("#e")!;
    renderResolvedReferences(
      [{ entry: { element: entry, dois: [GENERIC_DOI], pmcid: null, text: "ref" }, doi: GENERIC_DOI, mode: "page" }],
      new Map([[GENERIC_DOI, { originDoi: GENERIC_DOI, doi: "10.9/n" as DoiString, kind: "retraction" }]]), new Map());
    expect(rowOf(entry).querySelector("[data-flora-notice-segment]")).not.toBeNull();
    expect(entry.querySelector(".flora-notice-pill")).toBeNull();
  });
});
