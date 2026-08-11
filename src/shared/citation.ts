// Formatted citations for a DOI via content negotiation. Crossref's transform
// endpoint renders the CSL styles; doi.org's negotiation service is the fallback
// for DOIs Crossref doesn't own (DataCite: datasets, Zenodo, figshare).
//
// Nothing is fetched until a reader asks for a citation — one lookup per DOI per
// format, then cached — so a page full of references costs no extra requests.

import {debugWarn} from "./debug";

import {getSettings} from "./settings";
import {BlobCache} from "./blob-cache";

export interface CitationFormat {
    id: string;
    label: string;
    /** Content-negotiation Accept header. */
    accept: string;
    /** Reference-manager exports keep their own line breaks and field order. */
    verbatim?: boolean;
}

const csl = (style: string): string => `text/x-bibliography; style=${style}; locale=en-US`;

export const CITATION_FORMATS: readonly CitationFormat[] = [
    {id: "apa", label: "APA", accept: csl("apa")},
    {id: "modern-language-association", label: "MLA", accept: csl("modern-language-association")},
    {id: "chicago-author-date", label: "Chicago", accept: csl("chicago-author-date")},
    {id: "harvard-cite-them-right", label: "Harvard", accept: csl("harvard-cite-them-right")},
    {id: "elsevier-vancouver", label: "Vancouver", accept: csl("elsevier-vancouver")},
    {id: "ieee", label: "IEEE", accept: csl("ieee")},
    {id: "american-medical-association", label: "AMA", accept: csl("american-medical-association")},
    {id: "american-sociological-association", label: "ASA", accept: csl("american-sociological-association")},
    {id: "nature", label: "Nature", accept: csl("nature")},
    {id: "bibtex", label: "BibTeX", accept: "application/x-bibtex", verbatim: true},
    {id: "ris", label: "RIS (EndNote, Zotero)", accept: "application/x-research-info-systems", verbatim: true},
];

export const DEFAULT_CITATION_FORMAT_ID = CITATION_FORMATS[0].id;

/** Resolve a stored format id, falling back to the default for unknown ids. */
export function citationFormat(id: string | null | undefined): CitationFormat {
    return CITATION_FORMATS.find((format) => format.id === id) ?? CITATION_FORMATS[0];
}

/** The reader's preferred format from settings. */
export async function preferredCitationFormat(): Promise<CitationFormat> {
    try {
        const {citationStyle} = await getSettings();
        return citationFormat(citationStyle);
    } catch {
        return CITATION_FORMATS[0];
    }
}

export interface Citation {
    text: string;
    /** Inline HTML carrying the emphasis CSL renders. Null for BibTeX/RIS. */
    html: string | null;
}

const CITATION_CACHE = new BlobCache<{text: string; html?: string | null}>({
    storageKey: "flora_citation_blob",
    ttlMs: 90 * 24 * 60 * 60 * 1000, // 90 days — a published record's citation is stable
});

const inflight = new Map<string, Promise<Citation | null>>();

const ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    "#39": "'",
    nbsp: " ",
};

/** CSL output carries markup (`<i>`, `&amp;`); the clipboard wants plain text. */
function stripMarkup(raw: string): string {
    return raw
        .replace(/<[^>]*>/g, "")
        .replace(/&(#?[a-z0-9]+);/gi, (match, entity: string) => ENTITIES[entity.toLowerCase()] ?? match);
}

// Tags kept from CSL output; every other tag and every attribute is dropped,
// so nothing but plain emphasis reaches the clipboard.
const INLINE_TAGS = new Set(["i", "em", "b", "strong", "sub", "sup"]);

function keepInlineMarkup(raw: string): string {
    return raw.replace(/<(\/?)([a-z0-9]+)[^>]*>/gi, (_match, slash: string, name: string) => {
        const tag = name.toLowerCase();
        return INLINE_TAGS.has(tag) ? `<${slash}${tag}>` : "";
    });
}

/**
 * Crossref stores an empty editor list on many journal articles, which citeproc
 * renders as a dangling "edited by ," / ", ed." in the styles that name editors.
 */
function dropEmptyEditor(text: string): string {
    return text
        .replace(/\.\s*edited by\s*,\s*/gi, ". ")
        .replace(/,?\s*edited by\s*,\s*/gi, ", ")
        .replace(/\s*edited by\s*\.\s*/gi, " ")
        .replace(/\.\s*,\s*ed\.\s+/gi, ". ");
}

function polish(rendered: string): string {
    return dropEmptyEditor(rendered)
        // Numeric styles prefix the entry with its bibliography position.
        .replace(/^(?:\[\d+\]|\d+\.)\s*/, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function tidyCitation(raw: string, format: CitationFormat): string {
    const text = stripMarkup(raw).trim();
    return format.verbatim ? text : polish(text);
}

/** The same entry with its emphasis intact, or null where the format has none. */
export function tidyCitationHtml(raw: string, format: CitationFormat): string | null {
    if (format.verbatim) return null;
    const html = polish(keepInlineMarkup(raw).trim());
    return html || null;
}

function crossrefUrl(doi: string, email: string): string {
    const mailto = email ? `?mailto=${encodeURIComponent(email)}` : "";
    return `https://api.crossref.org/works/${encodeURIComponent(doi)}/transform${mailto}`;
}

function doiOrgUrl(doi: string): string {
    return `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`;
}

async function requestCitation(doi: string, format: CitationFormat): Promise<Citation | null> {
    let email = "";
    try {
        email = (await getSettings()).email;
    } catch {
        // Polite-pool contact is optional for content negotiation.
    }

    for (const url of [crossrefUrl(doi, email), doiOrgUrl(doi)]) {
        try {
            const response = await fetch(url, {headers: {Accept: format.accept}});
            if (!response.ok) continue;
            const raw = await response.text();
            const text = tidyCitation(raw, format);
            if (text) return {text, html: tidyCitationHtml(raw, format)};
        } catch (err) {
            debugWarn(`Citation: ${url} failed for ${doi} —`, err);
        }
    }
    return null;
}

/**
 * Render `doi` in the given format, cached in chrome.storage.local. Returns null
 * when neither Crossref nor doi.org can render the DOI — failures are not cached
 * so a transient outage doesn't suppress the citation for the cache TTL.
 */
export async function fetchCitation(doi: string, formatId: string): Promise<Citation | null> {
    const format = citationFormat(formatId);
    const key = `${doi}|${format.id}`;

    // Entries cached before rich text shipped carry no `html`.
    const cached = await CITATION_CACHE.get(key);
    if (cached) return {text: cached.text, html: cached.html ?? null};

    const existing = inflight.get(key);
    if (existing) return existing;

    const pending = requestCitation(doi, format)
        .then(async (citation) => {
            if (citation) await CITATION_CACHE.set(key, citation);
            return citation;
        })
        .finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
}

/** Test-only: drop in-memory cache state so each case starts fresh. */
export function _resetCitationCacheForTesting(): void {
    CITATION_CACHE.resetForTesting();
    inflight.clear();
}
