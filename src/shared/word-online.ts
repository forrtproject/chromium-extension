/** Word renders its document in an Office iframe. Keep all annotation DOM
 * outside its editing and pagination surfaces so it cannot enter saved text. */
export function isWordOnline(url = location.href): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && parsed.hostname.endsWith(".officeapps.live.com")
            && parsed.pathname.toLowerCase() === "/we/wordeditorframe.aspx";
    } catch { return false; }
}

const copies = new WeakMap<HTMLElement, {text: string; copy: HTMLElement}>();
const sources = new WeakMap<Element, HTMLElement>();
const rows = new Map<HTMLElement, HTMLElement>();
let observing = false;

/** Detached reference copies let the existing resolver keep its scan markers
 * without touching Word's paragraphs. Only citation-like paragraphs qualify. */
export function wordReferenceElements(doc: Document): HTMLElement[] {
    if (!isWordOnline(doc.URL)) return [];
    const result: HTMLElement[] = [];
    const active = new Set<HTMLElement>();
    const ids = new Set<string>();
    for (const source of doc.querySelectorAll<HTMLElement>("#WACViewPanel .Paragraph")) {
        if (source.closest('[aria-hidden="true"]')) continue;
        const id = source.getAttribute("paraid");
        if (id && ids.has(id)) continue;
        if (id) ids.add(id);
        const text = source.textContent ?? "";
        if (!/10\.\d{4,}\//.test(text) && !source.querySelector('a[href*="doi.org/10."]')) {
            // A bibliography entry needs author/title text, a year and a
            // publication cue; a prose paragraph merely mentioning a year is insufficient.
            if (text.length < 60 || !/\b(?:18|19|20)\d{2}\b/.test(text)
                || !/[‘“'"]|\b\d+\s*\(\d+\)|\bpp?\./.test(text)) continue;
        }
        let cached = copies.get(source);
        if (!cached || cached.text !== source.outerHTML) {
            rows.get(source)?.remove();
            rows.delete(source);
            const copy = source.cloneNode(true) as HTMLElement;
            cached = {text: source.outerHTML, copy};
            copies.set(source, cached);
            sources.set(copy, source);
        }
        result.push(cached.copy);
        active.add(source);
    }
    for (const [source, row] of rows) {
        if (active.has(source)) continue;
        row.remove();
        rows.delete(source);
        copies.delete(source);
    }
    return result;
}

/** A body-level overlay beside the paragraph, never a child of Word content. */
export function wordAnnotationTarget(target: Element): HTMLElement | null {
    const source = sources.get(target) ?? target.closest<HTMLElement>("#WACViewPanel .Paragraph");
    if (!source || !isWordOnline(source.ownerDocument.URL)) return null;
    if (!source.isConnected || sources.has(target) && copies.get(source)?.copy !== target) return null;
    let row = rows.get(source);
    if (row?.isConnected) return row;
    row = source.ownerDocument.createElement("div");
    row.setAttribute("data-flora-ui", "");
    row.className = "flora-word-annotation";
    row.style.cssText = "position:fixed;z-index:100000;display:flex;align-items:center;width:32px;height:32px;";
    source.ownerDocument.body.appendChild(row);
    rows.set(source, row);
    if (!observing) {
        observing = true;
        let queued = false;
        const schedule = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; positionWordAnnotations(); });
        };
        document.addEventListener("scroll", schedule, true);
        window.addEventListener("resize", schedule);
        new MutationObserver(schedule).observe(document.getElementById("WACViewPanel")!, {
            childList: true, subtree: true, characterData: true, attributes: true,
        });
    }
    positionWordAnnotations();
    return row;
}

export function positionWordAnnotations(): void {
    const viewport = document.getElementById("WACViewPanel")?.getBoundingClientRect();
    for (const [source, row] of rows) {
        if (!source.isConnected) { row.remove(); rows.delete(source); continue; }
        const rect = source.getBoundingClientRect();
        row.hidden = !rect.height || !!source.closest('[aria-hidden="true"]')
            || !!viewport && (rect.bottom <= viewport.top || rect.top >= viewport.bottom);
        row.style.visibility = row.hidden ? "hidden" : "visible";
        row.style.left = `${Math.max(0, Math.min(rect.right + 12, window.innerWidth - 36))}px`;
        row.style.top = `${Math.max(rect.top, viewport?.top ?? 0)}px`;
    }
}

/** Current rendered references, including DOI-less citations resolved by title. */
export function wordAnnotatedReferences(): {doi: import("./types").DoiString; title: string}[] {
    const found = new Map<string, {doi: import("./types").DoiString; title: string}>();
    for (const [source, row] of rows) {
        if (!source.isConnected || !row.isConnected) continue;
        const doi = row.querySelector("[data-flora-doi]")?.getAttribute("data-flora-doi") as import("./types").DoiString | null;
        if (doi) found.set(doi, {doi, title: source.textContent?.trim() || doi});
    }
    return [...found.values()];
}
