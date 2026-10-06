import {resolveSiteAdapter} from "./site-adapters";

const EXCLUDED = 'nav, [role="navigation"], .breadcrumb, .breadcrumbs, footer, dialog, [role="dialog"], .modal, [hidden], .sr-only, .visually-hidden, .screen-reader-text, .pkp_screen_reader, [data-flora-ui], [id^="flora-"]';
const CANDIDATES = 'h1, h2, h3, h4, [role="heading"], [class*="title" i], [id*="title" i], [itemprop="headline"], [data-testid*="title" i], .h1, .h2, p > b, p > strong';
const STRONG_TITLE_META = ["citation_title", "dc.title", "bepress_citation_title", "prism.title"];
const WEAK_TITLE_META = ["og:title", "twitter:title"];
const SITE_NAME_META = ["citation_journal_title", "og:site_name", "prism.publicationname", "citation_publisher", "dc.publisher"];
const MIN_TITLE_CHARS = 12;
const HEADING_MATCH = 0.6;
const BLOCK_MATCH = 0.85;
const MAX_CANDIDATE_CHILDREN = 40;
const INLINE_TAGS = new Set(["A", "B", "STRONG", "EM", "I", "SPAN", "SMALL", "FONT", "CITE"]);
const BLOCK_TAGS = new Set(["DIV", "P", "SECTION", "HEADER", "HGROUP", "ARTICLE"]);
const STICKY_HINT_RE = /(?:^|[-_\s])(?:sticky|affix|headroom)(?:$|[-_\s])/i;

function normaliseTitle(s: string | null | undefined): string {
    return (s ?? "")
        .replace(/<[^>]*>/g, "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

function metaValues(doc: Document, names: string[]): string[] {
    const values: string[] = [];
    for (const name of names) {
        for (const el of doc.querySelectorAll<HTMLMetaElement>(`meta[name="${name}" i], meta[property="${name}" i]`)) {
            if (el.content) values.push(el.content);
        }
    }
    return values;
}

function titleRefs(values: string[], siteNames: Set<string>): string[] {
    const refs = new Set<string>();
    for (const value of values) {
        for (const candidate of [value, ...value.split(/\s+[|–—-]\s+/)]) {
            const normalised = normaliseTitle(candidate);
            if (normalised.length >= MIN_TITLE_CHARS && !siteNames.has(normalised)) refs.add(normalised);
        }
    }
    return [...refs];
}

function matchScore(text: string, refs: string[]): number {
    let best = 0;
    for (const ref of refs) {
        if (text === ref) return 1;
        const [shorter, longer] = text.length < ref.length ? [text, ref] : [ref, text];
        if (shorter.length >= MIN_TITLE_CHARS && longer.includes(shorter)) {
            best = Math.max(best, shorter.length / longer.length);
        }
    }
    return best;
}

function headingRank(el: Element): number {
    const m = /^H([1-4])$/.exec(el.tagName);
    return m ? Number(m[1]) : 5;
}

function isShown(el: HTMLElement): boolean {
    return !el.closest(EXCLUDED) && (typeof el.checkVisibility !== "function" || el.checkVisibility());
}

function blockAnchor(el: HTMLElement): HTMLElement | null {
    const heading = el.closest<HTMLElement>("h1, h2, h3, h4, h5, h6");
    if (heading) return heading;
    let node: HTMLElement = el;
    while (INLINE_TAGS.has(node.tagName) && node.parentElement) node = node.parentElement;
    return BLOCK_TAGS.has(node.tagName) ? node : null;
}

export function findMatchedArticleTitle(doc: Document): HTMLElement | null {
    const siteNames = new Set(metaValues(doc, SITE_NAME_META).map(normaliseTitle));
    const strong = titleRefs(metaValues(doc, STRONG_TITLE_META), siteNames);
    const weak = titleRefs([...metaValues(doc, WEAK_TITLE_META), doc.title], siteNames);
    let best = null as HTMLElement | null;
    let bestRank = 6;
    let bestScore = 0;
    for (const el of doc.body?.querySelectorAll<HTMLElement>(CANDIDATES) ?? []) {
        if (el.childElementCount > MAX_CANDIDATE_CHILDREN || !isShown(el)) continue;
        const text = normaliseTitle(el.textContent);
        if (!text) continue;
        const rank = headingRank(el);
        const score = rank < 5 ? Math.max(matchScore(text, strong), matchScore(text, weak)) : matchScore(text, strong);
        if (score < (rank < 5 ? HEADING_MATCH : BLOCK_MATCH)) continue;
        if (rank < bestRank || (rank === bestRank && (score > bestScore || (score === bestScore && best?.contains(el))))) {
            best = el;
            bestRank = rank;
            bestScore = score;
        }
    }
    return best && blockAnchor(best);
}

function fallbackHeading(doc: Document): HTMLElement | null {
    const siteNames = new Set(metaValues(doc, SITE_NAME_META).map(normaliseTitle));
    for (const h1 of doc.body?.querySelectorAll<HTMLElement>("h1") ?? []) {
        if (!isShown(h1)) continue;
        const banner = h1.closest('header, [role="banner"]');
        if (banner && !banner.closest("article, main")) continue;
        const text = normaliseTitle(h1.textContent);
        if (text.length < MIN_TITLE_CHARS || siteNames.has(text)) continue;
        return h1;
    }
    return null;
}

export function siteArticleTitle(doc: Document): HTMLElement | null {
    for (const selector of resolveSiteAdapter(doc.location?.hostname ?? "")?.articleTitle ?? []) {
        const el = doc.querySelector<HTMLElement>(selector);
        if (el && isShown(el)) return el;
    }
    return null;
}

export function findArticleTitle(doc: Document): HTMLElement | null {
    return siteArticleTitle(doc) ?? findMatchedArticleTitle(doc) ?? fallbackHeading(doc);
}

function isRowLayout(el: Element): boolean {
    const {display, flexDirection} = getComputedStyle(el);
    return display.includes("grid") || (display.includes("flex") && flexDirection !== "column");
}

function startInset(el: Element): string {
    const style = getComputedStyle(el);
    const side = style.direction === "rtl" ? "Right" : "Left";
    const total = [style[`margin${side}`], style[`padding${side}`], style[`border${side}Width`]]
        .reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0);
    return total > 0 ? `${total}px` : "0";
}

export function titleContainsText(title: HTMLElement, text: string): boolean {
    const ref = normaliseTitle(title.textContent);
    return ref.length >= MIN_TITLE_CHARS && normaliseTitle(text).includes(ref);
}

function px(value: string): number {
    return Number.parseFloat(value) || 0;
}

function hasBottomRule(style: CSSStyleDeclaration): boolean {
    return style.borderBottomStyle !== "none" && px(style.borderBottomWidth) > 0;
}

function inStickyLayer(el: HTMLElement): boolean {
    for (let node: HTMLElement | null = el; node && node !== el.ownerDocument.body; node = node.parentElement) {
        const {position} = getComputedStyle(node);
        if (position === "fixed" || position === "sticky") return true;
        const name = `${typeof node.className === "string" ? node.className : ""} ${node.id}`;
        if (node.hasAttribute("data-sticky-header") || node.hasAttribute("data-sticky") || STICKY_HINT_RE.test(name)) return true;
    }
    return false;
}

export function placeTitlePill(pill: HTMLElement, title: HTMLElement): void {
    const style = getComputedStyle(title);
    const inside = (!!title.parentElement && isRowLayout(title.parentElement)) || (hasBottomRule(style) && !isRowLayout(title));
    if (inside) title.appendChild(pill);
    else title.insertAdjacentElement("afterend", pill);
    const trailing = inside || style.display.startsWith("inline") || inStickyLayer(title) ? 0 : px(style.marginBottom);
    const centred = /center$/.test(style.textAlign);
    pill.style.setProperty("display", "block");
    pill.style.setProperty("width", "fit-content");
    pill.style.setProperty("max-width", "100%");
    pill.style.setProperty("top", "0");
    pill.style.setProperty("margin-top", `${trailing > 6 ? 6 - trailing : 6}px`, "important");
    pill.style.setProperty("margin-bottom", `${Math.max(6, trailing)}px`, "important");
    pill.style.setProperty("margin-inline-start", centred ? "auto" : inside ? "0" : startInset(title), "important");
    pill.style.setProperty("margin-inline-end", centred ? "auto" : "0", "important");
}
