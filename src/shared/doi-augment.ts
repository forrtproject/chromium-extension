import type {DoiString, DoiAugmentRequest} from "./types";
import {normaliseDOI} from "./doi-normalise";
import {getSettings} from "./settings";
import {BlobCache} from "./blob-cache";
import {debugLog, debugWarn, isDebugEnabled} from "./debug";
import {RequestGate} from "./request-gate";

const OPENALEX_BASE = "https://api.openalex.org/works";
const CROSSREF_BASE = "https://api.crossref.org/works";

// A reference list can hold dozens of titles without a DOI; fired all at once,
// both platforms answer 429 within the second. Crossref's polite pool allows
// 3 concurrent requests at 3/s; OpenAlex allows 10/s but charges a title
// search 10 credits against a free budget of 1000/day per client, and answers
// 429 with a Retry-After of "midnight UTC" once that is spent.
const crossrefGate = new RequestGate("Crossref", 3, 400);
const openalexGate = new RequestGate("OpenAlex", 3, 100);
const MATCH_THRESHOLD_TSR = 88; // token_set_ratio threshold (0–100)
// token_set_ratio scores 100 whenever one title's tokens are a subset of the
// other's, so a 3-word title matches a 7-word one perfectly. Coverage is the
// share of the *queried* title the candidate accounts for, which that ratio
// cannot express. Set below 100 so a candidate missing a subtitle still passes.
const MATCH_THRESHOLD_COVERAGE = 75;
// When page metadata (author/year) is available we accept candidates within this
// many points of the top title score, then let the metadata break the tie.
const METADATA_TITLE_BAND = 5;

const DOI_AUGMENT_CACHE = new BlobCache<CachedDoiResult>({
    storageKey: "flora_doi_blob",
    ttlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    legacyPrefixes: ["flora_doi:"],
});

interface CachedDoiResult {
    found: boolean;
    doi: string | null;
}

// DoiAugmentRequest is defined in types.ts and re-exported for callers that
// import it from this module (preserves the public API surface).
export type { DoiAugmentRequest } from "./types";

interface DoiCandidate {
    doi: DoiString;
    title: string;
    score: number;
    source: "crossref" | "openalex";
    firstAuthor?: string | null;
    year?: number | null;
    urls?: string[];
    containerTitle?: string | null;
    volume?: string | null;
    firstPage?: string | null;
    /** Citation requests only: which candidate fields the citation text confirmed. */
    citationMatches?: CitationMatches;
}

interface CitationMatches {
    year: boolean;
    author: boolean;
    locator: boolean;
}

async function getUserEmail(): Promise<string> {
    const {email} = await getSettings();
    return email;
}

/**
 * Normalize a title for comparison: lowercase, strip non-word chars, collapse spaces.
 */
export function normalizeTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Clean a title for use in API search filters.
 * Strips characters that break filter syntax.
 */
function cleanTitleForSearch(title: string): string {
    return title
        .replace(/[:?!()\[\]&|\\,;'"]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Reduce an author string to a comparable surname: strip diacritics, drop
 * single-letter initials, and keep the last remaining token.
 */
function normalizeAuthorName(author: string | null | undefined): string {
    if (!author) return "";
    const plain = author
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!plain) return "";
    const tokens = plain.split(/\s+/).filter((token) => token && !/^\p{L}$/u.test(token));
    return tokens[tokens.length - 1] ?? "";
}

function normalizeRequest(input: string | DoiAugmentRequest): DoiAugmentRequest {
    if (typeof input === "string") return {title: input};
    return {
        title: input.title,
        kind: input.kind ?? "title",
        firstAuthor: input.firstAuthor ?? null,
        year: input.year ?? null,
        sourceUrl: input.sourceUrl ?? null,
    };
}

function normalizeHostname(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, "");
}

function urlHostname(rawUrl: string | null | undefined): string {
    try {
        return rawUrl ? normalizeHostname(new URL(rawUrl).hostname) : "";
    } catch {
        return "";
    }
}

/**
 * True when a candidate is corroborated by the request's source URL: either the
 * URL embeds the candidate's DOI, or the URL's host matches one of the
 * candidate's landing/PDF hosts (ignoring doi.org redirectors).
 */
function candidateMatchesSourceUrl(request: DoiAugmentRequest, candidate: DoiCandidate): boolean {
    if (!request.sourceUrl) return false;
    const sourceDoi = normaliseDOI(request.sourceUrl);
    if (sourceDoi && sourceDoi === candidate.doi) return true;

    const sourceHost = urlHostname(request.sourceUrl);
    if (!sourceHost || sourceHost === "doi.org" || sourceHost === "dx.doi.org") return false;
    return (candidate.urls ?? []).some((candidateUrl) => urlHostname(candidateUrl) === sourceHost);
}

function yearsMatch(expected: number | null | undefined, actual: number | null | undefined): boolean {
    return typeof expected === "number" && typeof actual === "number" && Math.abs(expected - actual) <= 1;
}

function authorsMatch(expected: string | null | undefined, actual: string | null | undefined): boolean {
    const expectedAuthor = normalizeAuthorName(expected);
    const actualAuthor = normalizeAuthorName(actual);
    return expectedAuthor.length > 0 && actualAuthor.length > 0 && expectedAuthor === actualAuthor;
}

/** Title score plus small bonuses for corroborating metadata. */
function candidateMerit(request: DoiAugmentRequest, candidate: DoiCandidate): number {
    let merit = candidate.score;
    if (candidateMatchesSourceUrl(request, candidate)) merit += 8;
    if (yearsMatch(request.year, candidate.year)) merit += 3;
    if (authorsMatch(request.firstAuthor, candidate.firstAuthor)) merit += 3;
    // Fields the citation text confirmed outrank ones it merely didn't contradict,
    // so a journal article (volume/pages present in the citation) beats the
    // same-titled preprint that has no locators to check.
    const m = candidate.citationMatches;
    if (m) merit += (m.year ? 3 : 0) + (m.author ? 3 : 0) + (m.locator ? 4 : 0);
    return merit;
}

// ── Citation-string verification ────────────────────────────────────────────
// A reference-list entry ("Wakefield, A. J., … (1998). Ileal-lymphoid-nodular
// hyperplasia … The Lancet, 351(9103), 637–641.") is not parsed: it is reduced
// to a bag of tokens, and each candidate's *structured* fields — which
// Crossref returns already parsed — are checked for presence in that bag.
// That is format-agnostic (APA, Vancouver, Wikipedia's markup all contain the
// same surname, year, volume and page tokens) and mirrors Crossref's own
// search-then-validate reference matching.

/** Share of the candidate title's tokens the citation must contain. */
const CITATION_TITLE_COVERAGE = 80;
/** Share of the journal-name tokens (generic words removed) the citation must contain. */
const CITATION_JOURNAL_COVERAGE = 50;
/** Words too common across journal names to count as evidence for one journal. */
const JOURNAL_STOPWORDS = new Set([
    "the", "of", "and", "for", "in", "on", "de", "la", "le", "der", "und", "des",
    "journal", "journals", "review", "reviews", "annals", "proceedings", "transactions", "letters",
    "bulletin", "archives", "acta", "advances", "reports", "research", "studies", "quarterly",
    "international", "national", "european", "american", "british", "science", "sciences",
]);
/** The first-author surname must sit within this many leading citation tokens. */
const AUTHOR_LEAD_TOKENS = 8;

/**
 * Lowercase, diacritics stripped, split on anything that is not a letter or
 * digit in any script (so en/em dashes split page ranges and CJK runs stay
 * whole). Order-preserving; wrap in a Set for membership tests.
 */
export function citationTokenList(text: string): string[] {
    return text
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean);
}

export function citationTokens(text: string): Set<string> {
    return new Set(citationTokenList(text));
}

function tokenCoverage(needle: string, haystack: Set<string>, ignore?: Set<string>): {covered: number; total: number} {
    const tokens = [...citationTokens(needle)].filter((t) => !ignore?.has(t));
    let covered = 0;
    for (const t of tokens) if (haystack.has(t)) covered++;
    return {covered, total: tokens.length};
}

/**
 * Verify a candidate against a citation string. Returns the title coverage
 * (0–100, used as the candidate's score) plus which fields the citation
 * confirmed, or null when the candidate is contradicted or under-supported:
 *  - title: ≥ 80 % of the candidate's title tokens present;
 *  - year: present within ±1 (online-first vs print), if the candidate has one;
 *  - first author: surname among the leading tokens (reference styles put the
 *    first author first), if the candidate has a usable one — this also keeps
 *    a co-author, or the author of a second work in the same entry, from
 *    standing in;
 *  - locator: volume, first page, or half the journal-name tokens (generic
 *    words removed) present, if the candidate has any of those; a token that
 *    served as the year cannot serve as volume or page too.
 * A field the candidate lacks cannot contradict, but at least two of the
 * three must be positively confirmed, and all three for a candidate title of
 * ≤ 3 tokens (generic titles like "Editorial" match anything).
 */
export function verifyAgainstCitation(
    citation: string,
    candidate: {title: string; firstAuthor?: string | null; year?: number | null; containerTitle?: string | null; volume?: string | null; firstPage?: string | null},
): {coverage: number; matches: CitationMatches} | null {
    const tokens = citationTokenList(citation);
    const bag = new Set(tokens);

    // Crossref prefixes the record of a retracted/withdrawn article with its
    // status; the citation was written before that happened.
    const plainTitle = candidate.title.replace(/^\s*(retracted|withdrawn)(\s+article)?\s*[:\-–—]\s*/i, "");
    const title = tokenCoverage(plainTitle, bag);
    if (title.total === 0) return null;
    const coverage = (title.covered / title.total) * 100;
    if (coverage < CITATION_TITLE_COVERAGE) return null;

    let year = false;
    let yearToken: string | null = null;
    if (typeof candidate.year === "number") {
        yearToken = [candidate.year, candidate.year - 1, candidate.year + 1].map(String).find((y) => bag.has(y)) ?? null;
        year = yearToken !== null;
        if (!year) return null;
    }

    let author = false;
    const surname = normalizeAuthorName(candidate.firstAuthor);
    // Skip initials-only or empty names; a two-character non-Latin surname is a real one.
    if (surname.length >= 3 || (surname.length > 0 && /[^\x00-\x7f]/.test(surname))) {
        const lead = tokens.slice(0, AUTHOR_LEAD_TOKENS);
        const last = surname.split(/[\s-]+/).pop() ?? "";
        author = lead.includes(surname) || lead.includes(last);
        if (!author) return null;
    }

    let locator = false;
    const hasLocator = !!(candidate.volume || candidate.firstPage || candidate.containerTitle);
    if (hasLocator) {
        const usable = (v: string | null | undefined): boolean => !!v && v.toLowerCase() !== yearToken && bag.has(v.toLowerCase());
        const volumeHit = usable(candidate.volume);
        const pageHit = usable(candidate.firstPage);
        let journalHit = false;
        if (candidate.containerTitle) {
            const j = tokenCoverage(candidate.containerTitle, bag, JOURNAL_STOPWORDS);
            journalHit = j.total > 0 && (j.covered / j.total) * 100 >= CITATION_JOURNAL_COVERAGE;
        }
        locator = volumeHit || pageHit || journalHit;
        if (!locator) return null;
    }

    const confirmed = [year, author, locator].filter(Boolean).length;
    if (confirmed < 2) return null;
    if (title.total <= 3 && confirmed < 3) return null;
    return {coverage, matches: {year, author, locator}};
}

/**
 * Pick the single best candidate, using page metadata to break ties between
 * similarly-titled works. Returns null when the field can't be narrowed to one
 * DOI — better to show nothing than to guess the wrong paper.
 */
function selectBestCandidate(request: DoiAugmentRequest, candidates: DoiCandidate[]): DoiCandidate | null {
    const threshold = request.kind === "citation" ? CITATION_TITLE_COVERAGE : MATCH_THRESHOLD_TSR;
    const eligible = candidates.filter((candidate) => candidate.score >= threshold);
    if (eligible.length === 0) {
        debugLog(`Augment: no candidate cleared ${threshold} for "${request.title.slice(0, 80)}"`);
        return null;
    }

    const highestScore = Math.max(...eligible.map((candidate) => candidate.score));
    const titleBand = request.kind === "citation" || request.firstAuthor || request.year
        ? eligible.filter((candidate) => candidate.score >= highestScore - METADATA_TITLE_BAND)
        : eligible.filter((candidate) => candidate.score === highestScore);

    let narrowed = titleBand;
    if (request.sourceUrl && narrowed.some((candidate) => candidateMatchesSourceUrl(request, candidate))) {
        narrowed = narrowed.filter((candidate) => candidateMatchesSourceUrl(request, candidate));
    }
    if (request.year && narrowed.some((candidate) => yearsMatch(request.year, candidate.year))) {
        narrowed = narrowed.filter((candidate) => yearsMatch(request.year, candidate.year));
    }
    if (request.firstAuthor && narrowed.some((candidate) => authorsMatch(request.firstAuthor, candidate.firstAuthor))) {
        narrowed = narrowed.filter((candidate) => authorsMatch(request.firstAuthor, candidate.firstAuthor));
    }

    const highestMerit = Math.max(...narrowed.map((candidate) => candidateMerit(request, candidate)));
    const best = narrowed.filter((candidate) => candidateMerit(request, candidate) === highestMerit);
    const bestDois = new Set(best.map((candidate) => candidate.doi));
    if (bestDois.size !== 1) {
        // Ambiguity resolves to no DOI, which otherwise looks like "not found".
        debugLog(
            `Augment: tie between ${[...bestDois].join(", ")} at merit ${highestMerit.toFixed(1)}`
            + ` for "${request.title.slice(0, 80)}" — resolving to no DOI`
        );
        return null;
    }

    const winner = best[0];
    const reasons = [
        candidateMatchesSourceUrl(request, winner) ? "source-url" : null,
        yearsMatch(request.year, winner.year) ? `year=${winner.year}` : null,
        authorsMatch(request.firstAuthor, winner.firstAuthor) ? `author=${winner.firstAuthor}` : null,
    ].filter(Boolean);
    debugLog(
        `Augment: "${request.title.slice(0, 80)}" → ${winner.doi} via ${winner.source.toUpperCase()}`
        + ` (title ${winner.score.toFixed(1)}, merit ${highestMerit.toFixed(1)}`
        + `${reasons.length > 0 ? ", corroborated by " + reasons.join(" + ") : ", title only"})`
        + ` from ${eligible.length} candidate(s) across ${new Set(eligible.map((c) => c.source)).size} platform(s)`
    );
    return winner;
}

function extractCrossrefYear(item: {
    issued?: {"date-parts"?: number[][]};
    "published-print"?: {"date-parts"?: number[][]};
    "published-online"?: {"date-parts"?: number[][]};
    published?: {"date-parts"?: number[][]};
}): number | null {
    const dateParts =
        item.issued?.["date-parts"] ??
        item["published-print"]?.["date-parts"] ??
        item["published-online"]?.["date-parts"] ??
        item.published?.["date-parts"];
    const year = dateParts?.[0]?.[0];
    return typeof year === "number" ? year : null;
}

function compactUrls(urls: Array<string | null | undefined>): string[] {
    return [...new Set(urls.filter((url): url is string => !!url))];
}

/**
 * Levenshtein-based similarity score between two strings (0 to 1).
 * 1.0 = identical, 0.0 = completely different.
 */
export function similarity(s1: string, s2: string): number {
    const longer = s1.length >= s2.length ? s1 : s2;

    if (longer.length === 0) return 1.0;

    const costs: number[] = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }

    return (longer.length - costs[s2.length]) / longer.length;
}

/**
 * Token-set-ratio fuzzy matching (pure JS port of fuzzywuzzy's token_set_ratio).
 * Tokenizes both strings, computes intersection/difference sets, and returns
 * the max Levenshtein similarity across three comparison pairs.
 * Returns a score from 0 to 100.
 */
export function tokenSetRatio(s1: string, s2: string): number {
    const tokens1 = new Set(normalizeTitle(s1).split(/\s+/).filter(Boolean));
    const tokens2 = new Set(normalizeTitle(s2).split(/\s+/).filter(Boolean));

    const intersection = [...tokens1].filter((t) => tokens2.has(t));
    const diff1 = [...tokens1].filter((t) => !tokens2.has(t));
    const diff2 = [...tokens2].filter((t) => !tokens1.has(t));

    const sortedIntersection = intersection.sort().join(" ");
    const combined1 = [sortedIntersection, ...diff1.sort()].join(" ").trim();
    const combined2 = [sortedIntersection, ...diff2.sort()].join(" ").trim();

    const r1 = similarity(sortedIntersection, combined1);
    const r2 = similarity(sortedIntersection, combined2);
    const r3 = similarity(combined1, combined2);

    return Math.max(r1, r2, r3) * 100;
}

/**
 * Share (0–100) of the queried title's tokens the candidate contains. Guards
 * against a short generic title scoring 100 against a longer specific one.
 */
export function titleCoverage(query: string, candidate: string): number {
    const queryTokens = new Set(normalizeTitle(query).split(/\s+/).filter(Boolean));
    if (queryTokens.size === 0) return 0;
    const candidateTokens = new Set(normalizeTitle(candidate).split(/\s+/).filter(Boolean));
    let covered = 0;
    for (const token of queryTokens) if (candidateTokens.has(token)) covered++;
    return (covered / queryTokens.size) * 100;
}

function logQueryOutcome(
    source: "crossref" | "openalex",
    title: string,
    returned: number,
    accepted: DoiCandidate[],
    rejected: Array<{score: number; coverage: number; title: string}>
): void {
    if (!isDebugEnabled()) return;
    const head = `Augment [${source}] "${title.slice(0, 80)}": ${returned} result(s), ${accepted.length} usable`;
    if (accepted.length > 0) {
        const list = accepted
            .map((c) => `${c.doi} (${c.score.toFixed(1)}) "${c.title.slice(0, 60)}"`)
            .join("; ");
        debugLog(`${head} — ${list}`);
        return;
    }
    const best = rejected.sort((a, b) => b.score - a.score)[0];
    debugLog(best
        ? `${head} — best was "${best.title.slice(0, 60)}"`
          + ` (title ${best.score.toFixed(1)}/${MATCH_THRESHOLD_TSR},`
          + ` coverage ${best.coverage.toFixed(0)}%/${MATCH_THRESHOLD_COVERAGE}%), rejected`
        : `${head} — nothing usable`);
}

/**
 * Query Crossref for a title, returning every candidate that clears the title
 * threshold (with author/year/URL metadata for later tie-breaking).
 */
async function queryCrossref(request: DoiAugmentRequest, email: string): Promise<DoiCandidate[]> {
    const {title} = request;
    const isCitation = request.kind === "citation";
    const cleaned = cleanTitleForSearch(title);
    // `query.bibliographic` is Crossref's field for whole reference strings;
    // `query.title` for a bare title.
    const query = isCitation
        ? `query.bibliographic=${encodeURIComponent(cleaned)}`
        : `query.title=${encodeURIComponent(cleaned)}`;
    const url = `${CROSSREF_BASE}?${query}&rows=5&select=DOI,title,author,issued,published-print,published-online,published,URL,link,container-title,volume,page&mailto=${encodeURIComponent(email)}`;
    debugLog(`Augment [crossref] ${isCitation ? "citation" : "query"}: "${cleaned}"`);
    const response = await crossrefGate.fetch(url);
    if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`);

    const data = (await response.json()) as {
        message?: {
            items?: Array<{
                DOI?: string;
                title?: string[];
                author?: Array<{family?: string; given?: string; name?: string}>;
                issued?: {"date-parts"?: number[][]};
                "published-print"?: {"date-parts"?: number[][]};
                "published-online"?: {"date-parts"?: number[][]};
                published?: {"date-parts"?: number[][]};
                URL?: string;
                link?: Array<{URL?: string}>;
                "container-title"?: string[];
                volume?: string;
                page?: string;
            }>;
        };
    };

    const items = data.message?.items ?? [];
    const candidates: DoiCandidate[] = [];
    const rejected: Array<{score: number; coverage: number; title: string}> = [];

    for (const item of items) {
        if (!item.DOI || !item.title?.[0]) continue;
        const doi = normaliseDOI(item.DOI);
        if (!doi) continue;
        const fields = {
            title: item.title[0],
            firstAuthor: item.author?.[0]?.family ?? item.author?.[0]?.name ?? null,
            year: extractCrossrefYear(item),
            urls: compactUrls([item.URL, ...(item.link ?? []).map((link) => link.URL)]),
            containerTitle: item["container-title"]?.[0] ?? null,
            volume: item.volume ?? null,
            firstPage: item.page?.split(/[-–—]/)[0]?.trim() || null,
        };

        if (isCitation) {
            const verdict = verifyAgainstCitation(title, fields);
            if (verdict) {
                candidates.push({doi, score: verdict.coverage, source: "crossref", citationMatches: verdict.matches, ...fields});
            } else {
                rejected.push({score: 0, coverage: 0, title: fields.title});
            }
            continue;
        }

        const tsr = tokenSetRatio(title, fields.title);
        const coverage = titleCoverage(title, fields.title);
        if (tsr >= MATCH_THRESHOLD_TSR && coverage >= MATCH_THRESHOLD_COVERAGE) {
            candidates.push({doi, score: tsr, source: "crossref", ...fields});
        } else {
            rejected.push({score: tsr, coverage, title: fields.title});
        }
    }

    logQueryOutcome("crossref", title, items.length, candidates, rejected);
    return candidates;
}

/**
 * Query OpenAlex for a title, returning every candidate that clears the title
 * threshold (with author/year/URL metadata for later tie-breaking).
 */
async function queryOpenAlex(request: DoiAugmentRequest, email: string): Promise<DoiCandidate[]> {
    const {title} = request;
    const cleaned = cleanTitleForSearch(title);
    const url = `${OPENALEX_BASE}?filter=title.search:${encodeURIComponent(cleaned)}&select=id,doi,title,publication_year,authorships,primary_location,locations&per_page=5&mailto=${encodeURIComponent(email)}`;

    debugLog(`Augment [openalex] query: "${cleaned}"`);
    const response = await openalexGate.fetch(url);
    if (!response.ok) throw new Error(`OpenAlex HTTP ${response.status}`);

    const data = (await response.json()) as {
        results?: Array<{
            doi?: string;
            title?: string;
            publication_year?: number | null;
            authorships?: Array<{author?: {display_name?: string | null} | null}>;
            primary_location?: {landing_page_url?: string | null; pdf_url?: string | null} | null;
            locations?: Array<{landing_page_url?: string | null; pdf_url?: string | null}>;
        }>;
    };

    const works = data.results ?? [];
    const candidates: DoiCandidate[] = [];
    const rejected: Array<{score: number; coverage: number; title: string}> = [];

    for (const work of works) {
        if (!work.doi || !work.title) continue;

        const tsr = tokenSetRatio(title, work.title);
        const coverage = titleCoverage(title, work.title);
        if (tsr < MATCH_THRESHOLD_TSR || coverage < MATCH_THRESHOLD_COVERAGE) {
            rejected.push({score: tsr, coverage, title: work.title});
        }
        if (tsr >= MATCH_THRESHOLD_TSR && coverage >= MATCH_THRESHOLD_COVERAGE) {
            const doi = normaliseDOI(work.doi);
            if (doi) {
                candidates.push({
                    doi,
                    title: work.title,
                    score: tsr,
                    source: "openalex",
                    firstAuthor: work.authorships?.[0]?.author?.display_name ?? null,
                    year: work.publication_year ?? null,
                    urls: compactUrls([
                        work.primary_location?.landing_page_url,
                        work.primary_location?.pdf_url,
                        ...(work.locations ?? []).flatMap((location) => [
                            location.landing_page_url,
                            location.pdf_url,
                        ]),
                    ]),
                });
            }
        }
    }

    logQueryOutcome("openalex", title, works.length, candidates, rejected);
    return candidates;
}

/**
 * Augment DOIs for article titles that don't have a DOI.
 * Queries both Crossref and OpenAlex APIs in parallel, then picks
 * the best-matching candidate using token-set-ratio fuzzy scoring.
 * Returns a Map of original title -> resolved DoiString (or null if not found).
 */
export async function augmentDOIs(
    inputs: Array<string | DoiAugmentRequest>
): Promise<Map<string, DoiString | null>> {
    const detailed = await augmentDOIsDetailed(inputs);
    return new Map([...detailed].map(([title, r]) => [title, r.doi] as const));
}

/** Where a resolved DOI came from. "cache" means no platform was queried. */
export type AugmentSource = "crossref" | "openalex" | "both" | "cache";
type AugmentPlatform = "crossref" | "openalex";

export interface AugmentOutcome {
    doi: DoiString | null;
    source: AugmentSource | null;
    answered: boolean;
}

/** As `augmentDOIs`, but reports which platform produced each DOI. */
export async function augmentDOIsDetailed(
    inputs: Array<string | DoiAugmentRequest>
): Promise<Map<string, AugmentOutcome>> {
    const results = new Map<string, AugmentOutcome>();
    if (inputs.length === 0) return results;
    const requests = inputs.map(normalizeRequest).filter((request) => request.title.trim());
    if (requests.length === 0) return results;

    // Check cache first — single-blob lookup keyed by normalized title. The
    // cache stays title-keyed; page metadata only influences candidate choice,
    // not the cache identity.
    // Citation requests get their own key space: a whole-citation miss cached
    // under the title-matching rules must not answer for the field-verified path.
    const keyByTitle = new Map(requests.map((r) => [
        r.title,
        (r.kind === "citation" ? "cite:" : "") + normalizeTitle(r.title),
    ] as const));
    const cached = await DOI_AUGMENT_CACHE.getMany([...new Set(keyByTitle.values())]);

    // Group cache misses by their normalized key so titles that only differ in
    // punctuation/whitespace/case (same key) are queried once, not once each.
    const uncachedByKey = new Map<string, DoiAugmentRequest[]>();
    for (const request of requests) {
        const key = keyByTitle.get(request.title)!;
        const entry = cached.get(key);
        if (entry) {
            const cachedDoi = entry.found && entry.doi ? normaliseDOI(entry.doi) : null;
            debugLog(
                `Augment: "${request.title.slice(0, 80)}" → ${cachedDoi ?? "no match"} from cache`
                + " (no platform queried; clear flora_doi_blob to re-resolve)"
            );
            results.set(request.title, {doi: cachedDoi, source: cachedDoi ? "cache" : null, answered: true});
        } else {
            const group = uncachedByKey.get(key);
            if (group) group.push(request);
            else uncachedByKey.set(key, [request]);
        }
    }

    if (uncachedByKey.size === 0) return results;

    // No email means we can't query the APIs at all. Resolve every uncached
    // title to null but DO NOT write the cache: a cached no-match would
    // suppress these titles for the cache TTL (30 days) even after the user
    // configures their email.
    const email = await getUserEmail();
    if (!email) {
        debugWarn(
            `Augment: no contact email configured — skipping ${uncachedByKey.size} title(s);`
            + " neither Crossref nor OpenAlex will be queried"
        );
        for (const group of uncachedByKey.values()) {
            for (const request of group) results.set(request.title, {doi: null, source: null, answered: false});
        }
        return results;
    }

    // Query each distinct title on one platform first — titles alternate
    // between Crossref and OpenAlex so the load (and OpenAlex's daily credit
    // budget) is split — and ask the other only when the first fails, finds
    // nothing, or returns several DOIs (a preprint/journal pair, say) whose
    // tie the second platform's metadata may break. Then use the page
    // metadata to pick the single best candidate. Cache writes are
    // accumulated and flushed once at the end.
    const updates: Array<[string, CachedDoiResult]> = [];
    const lookupPromises = [...uncachedByKey.entries()].map(async ([key, group], index) => {
        const request = group[0];
        // OpenAlex's title search needs every query token in the title, so a
        // whole citation string returns nothing there; citations go to Crossref
        // alone (its `query.bibliographic` is built for them).
        const order: AugmentPlatform[] = request.kind === "citation"
            ? ["crossref"]
            : index % 2 === 0 ? ["crossref", "openalex"] : ["openalex", "crossref"];
        const outcomes: Partial<Record<AugmentPlatform, PromiseSettledResult<DoiCandidate[]>>> = {};
        for (const platform of order) {
            const [outcome] = await Promise.allSettled([
                platform === "crossref" ? queryCrossref(request, email) : queryOpenAlex(request, email),
            ]);
            outcomes[platform] = outcome;
            if (outcome.status === "fulfilled" && new Set(outcome.value.map((c) => c.doi)).size === 1) break;
        }
        const crossrefResult = outcomes.crossref ?? {status: "skipped"} as const;
        const openalexResult = outcomes.openalex ?? {status: "skipped"} as const;

        const candidates: DoiCandidate[] = [];
        if (crossrefResult.status === "fulfilled") candidates.push(...crossrefResult.value);
        else if (crossrefResult.status === "rejected") debugWarn(`Augment [crossref] query threw for "${request.title.slice(0, 80)}" —`, crossrefResult.reason);
        if (openalexResult.status === "fulfilled") candidates.push(...openalexResult.value);
        else if (openalexResult.status === "rejected") debugWarn(`Augment [openalex] query threw for "${request.title.slice(0, 80)}" —`, openalexResult.reason);

        // Deduplicate by DOI, merging metadata across the two sources so a
        // candidate seen by both keeps the author/year/urls either provided.
        const byDoi = new Map<string, DoiCandidate>();
        for (const c of candidates) {
            const existing = byDoi.get(c.doi);
            if (!existing) {
                byDoi.set(c.doi, c);
            } else {
                debugLog(
                    `Augment: ${c.doi} returned by both platforms`
                    + ` (crossref/openalex scores ${existing.score.toFixed(1)}/${c.score.toFixed(1)})`
                );
                byDoi.set(c.doi, {
                    ...(c.score > existing.score ? c : existing),
                    firstAuthor: existing.firstAuthor ?? c.firstAuthor,
                    year: existing.year ?? c.year,
                    urls: compactUrls([...(existing.urls ?? []), ...(c.urls ?? [])]),
                });
            }
        }

        const best = selectBestCandidate(request, [...byDoi.values()]);
        const doi = best?.doi ?? null;
        const seenIn = new Set(candidates.filter((c) => c.doi === doi).map((c) => c.source));
        const source: AugmentSource | null = !best
            ? null
            : seenIn.size > 1 ? "both" : best.source;
        const answered =
            crossrefResult.status === "fulfilled" || openalexResult.status === "fulfilled";
        for (const r of group) results.set(r.title, {doi, source, answered});

        if (answered) {
            updates.push([key, {found: doi !== null, doi}]);
        } else {
            debugWarn(
                `Augment: neither platform answered for "${request.title.slice(0, 80)}"`
                + " — not caching the no-match so it retries next time"
            );
        }
    });

    await Promise.allSettled(lookupPromises);

    if (updates.length > 0) await DOI_AUGMENT_CACHE.setMany(updates);

    // Defensive: set null for any titles a rejected lookup left unresolved.
    for (const request of requests) {
        if (!results.has(request.title)) results.set(request.title, {doi: null, source: null, answered: false});
    }

    return results;
}


const TITLE_CACHE = new BlobCache<{ title: string | null }>({
    storageKey: "flora_title_blob",
    ttlMs: 90 * 24 * 60 * 60 * 1000, // 90 days — published titles are stable.
    legacyPrefixes: ["flora_title:"],
});

/**
 * Resolve a paper's canonical title from its DOI. Tries Crossref first, then
 * OpenAlex. Cached in chrome.storage.local since a published title never
 * changes. Returns null when neither service has the DOI.
 */
export async function fetchTitleByDoi(doi: string): Promise<string | null> {
    const cached = await TITLE_CACHE.get(doi);
    if (cached) return cached.title;

    const encodedDoi = doi.split("/").map(encodeURIComponent).join("/");

    let title: string | null = null;
    let crossrefAnswered = false;
    let openalexAnswered = false;

    try {
        const email = await getUserEmail();
        const mailto = email ? `?mailto=${encodeURIComponent(email)}` : "";
        const response = await crossrefGate.fetch(`${CROSSREF_BASE}/${encodedDoi}${mailto}`);
        crossrefAnswered = response.ok || response.status === 404;
        if (response.ok) {
            const data = (await response.json()) as { message?: { title?: string[] } };
            title = data.message?.title?.[0] ?? null;
        }
    } catch {
        // Crossref failed — fall through to OpenAlex
    }

    if (!title) {
        try {
            const response = await openalexGate.fetch(`${OPENALEX_BASE}/doi:${encodedDoi}?select=title`);
            openalexAnswered = response.ok || response.status === 404;
            if (response.ok) {
                const data = (await response.json()) as { title?: string };
                title = data.title ?? null;
            }
        } catch (err) {
            debugWarn(`Title lookup: OpenAlex failed for ${doi} —`, err);
        }
    }

    if (title !== null || (crossrefAnswered && openalexAnswered)) {
        void TITLE_CACHE.set(doi, {title});
    }
    return title;
}

/** Test-only: drop in-memory cache state so each case starts fresh. */
export function _resetAugmentCachesForTesting(): void {
    DOI_AUGMENT_CACHE.resetForTesting();
    TITLE_CACHE.resetForTesting();
}
