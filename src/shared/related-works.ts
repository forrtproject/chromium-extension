const RELATED_NAME_RE = /(?:^|[-_\s])(?:recommend(?:ed|ations?)?|related|similar|more-?like-?this|also-?read|trending|most-?(?:read|cited|viewed|popular|downloaded)|trendmd|cited-?by|citing)(?:$|[-_\s])/i;
const OWN_REFERENCES_RE = /(?:^|[-_\s])(?:references|reflist|ref-list|bibliograph(?:y|ies)|works-cited)(?:$|[-_\s])/i;
const RELATED_LABEL_RE = /^(?:recommended|we\s+recommend|related(?!\s+(?:research\s+)?(?:data|datasets?|materials?|software|code)\b)|similar|more\s+like\s+this|you\s+may\s+(?:also\s+)?(?:like|be\s+interested)|(?:people|readers)\s+also|also\s+read|trending|most\s+(?:read|cited|viewed|popular|downloaded|shared)|cited\s+by|citing)\b/i;
// OJS Citations plugin: a Crossref/Scopus cited-by list, not the article's references.
const RELATED_WIDGET_SELECTOR = "#citation-plugin, [data-citations-url]";
const MAX_LABEL_CHARS = 60;

function names(el: Element): string {
    const cls = typeof el.className === "string" ? el.className : "";
    return `${cls} ${el.id}`.replace(/([a-z])([A-Z])/g, "$1-$2");
}

function hasRelatedLabel(node: Element, inner: Element): boolean {
    const label = node.firstElementChild;
    if (!label || label.contains(inner)) return false;
    const text = (label.textContent ?? "").replace(/\s+/g, " ").trim();
    return text.length <= MAX_LABEL_CHARS && RELATED_LABEL_RE.test(text);
}

export function isInRelatedWorks(el: Element, article: Element | null): boolean {
    for (let node: Element | null = el; node && node !== el.ownerDocument.body; node = node.parentElement) {
        if (article && node.contains(article)) return false;
        const name = names(node);
        if (OWN_REFERENCES_RE.test(name)) return false;
        if (node.matches(RELATED_WIDGET_SELECTOR) || RELATED_NAME_RE.test(name) || hasRelatedLabel(node, el)) return true;
        if (node.matches('main, [role="main"]')) return false;
    }
    return false;
}
