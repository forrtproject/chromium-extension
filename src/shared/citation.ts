import {fetchWithDeadline} from "@shared/work-cancellation";
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

interface CachedCitation {
    text: string;
    html?: string | null;
    normalized?: true;
}

const CITATION_CACHE = new BlobCache<CachedCitation>({
    storageKey: "flora_citation_blob",
    ttlMs: 90 * 24 * 60 * 60 * 1000, // 90 days — a published record's citation is stable
    maxEntries: 1500,
});

const inflight = new Map<string, Promise<CitationOutcome>>();

const ENTITIES = new Map<string, string>([
    ["amp", "&"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
    ["ndash", "–"],
    ["mdash", "—"],
    ["hellip", "…"],
    ["lsquo", "‘"],
    ["rsquo", "’"],
    ["ldquo", "“"],
    ["rdquo", "”"],
]);

// Decoded `<` and `>` stand in as private-use characters until the end, so an
// encoded comparison ("p &lt; 0.05") can never be mistaken for markup.
const LT = "";
const GT = "";

const TAG_NAME = String.raw`[a-z][\w.-]*(?::[a-z][\w.-]*)?`;
const TAG = new RegExp(String.raw`<(\/?)(${TAG_NAME})(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?>`, "gi");
// Valueless attributes count only when HTML defines them as boolean, so
// "a &lt;b and c&gt; d" is still read as a comparison rather than as <b>.
const BOOLEAN_ATTRS = "hidden|inert|itemscope|nowrap|open|disabled|reversed|compact";
const ESCAPED_ATTR = String.raw`\s+(?:[a-z_:][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=${LT}${GT}]+)|(?:${BOOLEAN_ATTRS})(?![\w:.-]))`;
const ESCAPED_ATTRS = String.raw`(?:${ESCAPED_ATTR})*\s*\/?`;
const ESCAPED_TAG = new RegExp(`${LT}(\\/?)(${TAG_NAME})(${ESCAPED_ATTRS})${GT}`, "gi");

// Crossref titles sometimes arrive with their markup escaped (`&lt;i&gt;`),
// at times twice over; only these elements are restored from that form.
const CITATION_ELEMENTS = new Set([
    "i", "b", "u", "em", "strong", "sub", "sup", "sc", "scp", "small", "span", "div", "p", "a", "br", "font",
]);

const isCitationElement = (name: string): boolean =>
    name.includes(":") || CITATION_ELEMENTS.has(name.toLowerCase());

function decodeCodePoint(code: number, match: string, verbatim: boolean): string {
    if (code === 0x3c) return LT;
    if (code === 0x3e) return GT;
    if (!(code > 0 && code <= 0x10ffff)) return match;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return verbatim ? match : " ";
    return String.fromCodePoint(code);
}

function decodeEntities(text: string, verbatim: boolean): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
        const lower = entity.toLowerCase();
        if (lower.startsWith("#x")) return decodeCodePoint(parseInt(lower.slice(2), 16), match, verbatim);
        if (lower.startsWith("#")) return decodeCodePoint(parseInt(lower.slice(1), 10), match, verbatim);
        if (lower === "lt") return LT;
        if (lower === "gt") return GT;
        return ENTITIES.get(lower) ?? match;
    });
}

/** Decode entities (repeatedly, for double escaping) and turn escaped citation elements back into tags. */
function parseMarkup(raw: string, verbatim = false): string {
    let text = raw;
    for (let pass = 0; pass < 3; pass++) {
        const next = decodeEntities(text, verbatim);
        if (next === text) break;
        text = next;
    }
    return text.replace(ESCAPED_TAG, (match, slash: string, name: string, attrs: string) =>
        isCitationElement(name) ? `<${slash}${name}${attrs}>` : match);
}

const literalBrackets = (text: string): string => text.replaceAll(LT, "<").replaceAll(GT, ">");

/** CSL output carries markup (`<i>`, `&amp;`), sometimes escaped; the clipboard wants plain text. */
function plainText(parsed: string): string {
    return literalBrackets(parsed.replace(TAG, ""));
}

// Tags kept from CSL output; every other tag and every attribute is dropped,
// so nothing but plain emphasis reaches the clipboard.
const INLINE_TAGS = new Set(["i", "em", "b", "strong", "sub", "sup"]);

function inlineHtml(parsed: string): string {
    let html = "";
    let cursor = 0;
    for (const match of parsed.matchAll(TAG)) {
        const name = match[2].toLowerCase();
        html += escapeText(literalBrackets(parsed.slice(cursor, match.index)));
        if (INLINE_TAGS.has(name)) html += `<${match[1]}${name}>`;
        cursor = match.index + match[0].length;
    }
    return html + escapeText(literalBrackets(parsed.slice(cursor)));
}

const hasTag = (parsed: string): boolean => new RegExp(TAG.source, "i").test(parsed);

interface CitationRange {
    start: number;
    end: number;
}

/** Add a CSL capture group's final occurrence to the ranges to italicise. */
function addMatchRange(ranges: CitationRange[], match: RegExpExecArray, group: number): void {
    const value = match[group];
    if (!value || match.index === undefined) return;
    const offset = match[0].lastIndexOf(value);
    if (offset < 0) return;
    ranges.push({start: match.index + offset, end: match.index + offset + value.length});
}

/**
 * Crossref's text/x-bibliography response is deliberately plain text. That is
 * useful for a terminal, but it means a rich clipboard write would otherwise
 * lose the italics required by journal styles. Recover the journal and volume
 * spans from the stable punctuation emitted by the CSL styles. This is only a
 * fallback: markup supplied by a resolver remains authoritative.
 */
function plainCitationRanges(text: string, format: CitationFormat): CitationRange[] {
    const ranges: CitationRange[] = [];
    let journalMatch: RegExpExecArray | null = null;

    switch (format.id) {
        case "apa":
            journalMatch = /^(.*\(\d{4}[a-z]?\)\.\s+).+\.\s+(.+?),\s+\d+(?=\(\d+\)|,|\s|\.|$)/.exec(text);
            break;
        case "modern-language-association":
            journalMatch = /^(.+?[”"](?:\s*,)?\s+)(.+?),\s+(?=vol\.)/.exec(text);
            break;
        case "chicago-author-date":
            journalMatch = /^(.+?[”"]\s+)(.+?)\s+\d+(?:\s+\(\d+\))?\s*:/.exec(text);
            break;
        case "harvard-cite-them-right":
            journalMatch = /^(.+?[”"](?:,|\.)?\s+)(.+?)\.\s+(?=\d+\(|\d{4})/.exec(text);
            break;
        case "ieee":
            journalMatch = /^(.+?[”"](?:\s*,)?\s+)(.+?),\s+vol\./.exec(text);
            break;
        case "elsevier-vancouver":
        case "american-medical-association":
            journalMatch = /^(.+)\.\s+(.+?)(?:\.)?\s+\d{4}[.;]/.exec(text);
            break;
        case "american-sociological-association":
            journalMatch = /^(.+?[”"](?:\s*,)?\s+)(.+?)\s+\d+(?:\(\d+\))?:/.exec(text);
            break;
        case "nature":
            journalMatch = /^(.+)\.\s+(.+?)\s+\d+,/.exec(text);
            break;
    }

    if (!journalMatch) return ranges;
    addMatchRange(ranges, journalMatch, 2);

    // APA, Chicago, Harvard, IEEE, Vancouver, AMA, ASA and Nature italicise
    // the volume alongside the journal. MLA is the exception in this list.
    const volumeStyles = new Set([
        "apa",
        "chicago-author-date",
        "harvard-cite-them-right",
        "elsevier-vancouver",
        "ieee",
        "american-medical-association",
        "american-sociological-association",
        "nature",
    ]);
    if (volumeStyles.has(format.id)) {
        const journalEnd = journalMatch.index! + journalMatch[0].lastIndexOf(journalMatch[2]) + journalMatch[2].length;
        const volumePattern = format.id === "elsevier-vancouver" || format.id === "american-medical-association"
            ? /\b\d{4}[.;]\s*(\d+)(?=\(\d+\)|\s*\(|[,;:]|\s*,)/
            : /\b\d+(?=\(\d+\)|\s*\(|[,;:]|\s*,)/;
        const volume = volumePattern.exec(text.slice(journalEnd));
        if (volume && volume.index !== undefined) {
            const volumeText = volume[1] ?? volume[0];
            const volumeOffset = volume[1] ? volume[0].lastIndexOf(volume[1]) : 0;
            const volumeStart = journalEnd + volume.index + volumeOffset;
            ranges.push({start: volumeStart, end: volumeStart + volumeText.length});
        }
    }
    return ranges;
}

/** Escape a plain-text citation before inserting it into clipboard HTML. */
function escapeText(text: string): string {
    return text.replace(/[&<>]/g, (character) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[character] ?? character));
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[character] ?? character));
}

/** Reconstruct the inline emphasis omitted by plain text/x-bibliography output. */
function formatPlainCitationHtml(text: string, format: CitationFormat): string {
    const ranges = plainCitationRanges(text, format)
        .sort((a, b) => a.start - b.start)
        .filter((range, index, all) => index === 0 || range.start >= all[index - 1].end);
    if (ranges.length === 0) return escapeHtml(text);

    let html = "";
    let cursor = 0;
    for (const range of ranges) {
        html += escapeHtml(text.slice(cursor, range.start));
        html += `<i>${escapeHtml(text.slice(range.start, range.end))}</i>`;
        cursor = range.end;
    }
    return html + escapeHtml(text.slice(cursor));
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
    const text = plainText(parseMarkup(raw, format.verbatim)).trim();
    return format.verbatim ? text : polish(text);
}

/** The same entry with its emphasis intact, or null where the format has none. */
export function tidyCitationHtml(raw: string, format: CitationFormat): string | null {
    if (format.verbatim) return null;
    const parsed = parseMarkup(raw);
    const html = hasTag(parsed)
        ? polish(inlineHtml(parsed).trim())
        : formatPlainCitationHtml(polish(plainText(parsed)), format);
    return html || null;
}

/** Entries cached before normalization shipped may still hold escaped or double-escaped markup. */
function upgradeLegacyEntry(cached: CachedCitation, format: CitationFormat): Citation {
    if (format.verbatim) return {text: cached.text, html: null};
    return {
        text: plainText(parseMarkup(cached.text)),
        html: cached.html ? inlineHtml(parseMarkup(cached.html)) : null,
    };
}

function crossrefUrl(doi: string, email: string): string {
    const mailto = email ? `?mailto=${encodeURIComponent(email)}` : "";
    return `https://api.crossref.org/works/${encodeURIComponent(doi)}/transform${mailto}`;
}

function doiOrgUrl(doi: string): string {
    return `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`;
}

export interface CitationOutcome {
    citation: Citation | null;
    reachable: boolean;
}

async function requestCitation(doi: string, format: CitationFormat): Promise<CitationOutcome> {
    let email = "";
    try {
        email = (await getSettings()).email;
    } catch {
        // Polite-pool contact is optional for content negotiation.
    }

    let reachable = false;
    for (const url of [crossrefUrl(doi, email), doiOrgUrl(doi)]) {
        try {
            const response = await fetchWithDeadline(url, {signal: null, headers: {Accept: format.accept}});
            if (response.status < 500) reachable = true;
            if (!response.ok) continue;
            const raw = await response.text();
            const text = tidyCitation(raw, format);
            if (text) return {citation: {text, html: tidyCitationHtml(raw, format)}, reachable: true};
        } catch (err) {
            debugWarn(`Citation: ${url} failed for ${doi} —`, err);
        }
    }
    return {citation: null, reachable};
}

/**
 * Render `doi` in the given format, cached in chrome.storage.local. Returns null
 * when neither Crossref nor doi.org can render the DOI — failures are not cached
 * so a transient outage doesn't suppress the citation for the cache TTL.
 */
export async function fetchCitationDetailed(doi: string, formatId: string): Promise<CitationOutcome> {
    const format = citationFormat(formatId);
    const key = `${doi}|${format.id}`;

    const cached = await CITATION_CACHE.get(key);
    if (cached) {
        const citation = cached.normalized ? {text: cached.text, html: cached.html ?? null} : upgradeLegacyEntry(cached, format);
        return {citation, reachable: true};
    }

    const existing = inflight.get(key);
    if (existing) return existing;

    const pending = requestCitation(doi, format)
        .then(async (outcome) => {
            if (outcome.citation) await CITATION_CACHE.set(key, {...outcome.citation, normalized: true});
            return outcome;
        })
        .finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
}

export async function fetchCitation(doi: string, formatId: string): Promise<Citation | null> {
    return (await fetchCitationDetailed(doi, formatId)).citation;
}

/** Test-only: drop in-memory cache state so each case starts fresh. */
export function _resetCitationCacheForTesting(): void {
    CITATION_CACHE.resetForTesting();
    inflight.clear();
}
