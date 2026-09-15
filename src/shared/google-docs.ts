import { fetchGoogleDocsText, googleDocsExportUrl } from "./google-docs-source";
import { debugLog } from "./debug";
import type { CanvasRun } from "../content-docs/canvas";
import { DOCS_TEXT_EVENT, DOCS_REQUEST_EVENT } from "../content-docs/canvas";
import type { DoiString } from "./types";
export function isGoogleDocs(url = location.href): boolean {
    try {
        const u = new URL(url);
        return u.protocol === "https:" && u.hostname === "docs.google.com" && /^\/document\/(?:u\/\d+\/)?d\/[\w-]+\//.test(u.pathname);
    }
    catch {
        return false;
    }
}
interface Paragraph {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
interface Snapshot {
    width: number;
    height: number;
    runs: CanvasRun[];
}
interface Entry {
    canvas: HTMLCanvasElement;
    copy: HTMLElement;
    box: Paragraph;
    snapshot: Snapshot;
    row?: HTMLElement;
}
const snapshots = new Map<HTMLCanvasElement, Snapshot>();
const entries = new Map<HTMLCanvasElement, Entry[]>();
const byCopy = new WeakMap<Element, Entry>();
let installed = false;
let contentRevision = 0;
let exportedEntries: HTMLElement[] = [];
let exportKey = '';
let exportText: string | undefined;
let exportPending = false;
let exportCheckedAt = 0;
/** Detached reference entries persist when Docs recycles offscreen canvases. */
export function setGoogleDocsText(text: string, doc: Document = document): void {
    const key = googleDocsExportUrl(doc.URL);
    if (exportKey !== key || exportText !== text) contentRevision++;
    exportKey = key;
    exportText = text;
    const previous = new Map(exportedEntries.map(element => [element.getAttribute('data-flora-source-text'), element]));
    exportedEntries = text.split(/\r?\n/).map(line => line.trim()).filter(line =>
        /10\.\d{4,}\//.test(line) || line.length > 60 && /\b(?:18|19|20)\d{2}\b/.test(line) && /^[A-ZÀ-Ž][\p{L}'’\-]+,/u.test(line)
    ).map(line => {
        const existing = previous.get(line);
        if (existing) return existing;
        const copy = doc.createElement('p');
        copy.textContent = line;
        copy.setAttribute('data-flora-source-text', line);
        return copy;
    });
}
function showExportStatus(unavailable: boolean): void {
    let status = document.getElementById('flora-docs-scan-status');
    if (!unavailable) { status?.remove(); return; }
    if (!status) {
        status = document.createElement('div');
        status.id = 'flora-docs-scan-status';
        status.setAttribute('data-flora-ui', '');
        status.setAttribute('role', 'status');
        status.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:100000;background:white;color:#663447;padding:8px 12px;border:1px solid #c9b9bf;border-radius:6px;font:13px system-ui;max-width:340px';
        document.body.append(status);
    }
    status.textContent = exportText !== undefined
        ? 'ORE: Full-document refresh unavailable. The report retains the last successful scan and may miss recent edits. Retrying automatically.'
        : 'ORE: Full-document scan unavailable. Only visible pages have been checked. Retrying automatically.';
}
async function refreshGoogleDocsText(onChange: () => void): Promise<void> {
    const key = googleDocsExportUrl(location.href);
    if (key !== exportKey) {
        contentRevision++;
        const hadExport = exportedEntries.length > 0;
        exportKey = key;
        exportedEntries = [];
        exportText = undefined;
        exportCheckedAt = 0;
        if (hadExport) onChange();
    }
    if (exportPending || Date.now() - exportCheckedAt < 60000) return;
    exportPending = true;
    exportCheckedAt = Date.now();
    try {
        const text = await fetchGoogleDocsText(location.href, AbortSignal.timeout(20000));
        if (googleDocsExportUrl(location.href) !== key) return;
        showExportStatus(false);
        if (text !== exportText) {
            setGoogleDocsText(text);
            debugLog('Google Docs: full-document export loaded', exportedEntries.length, 'reference candidates');
            onChange();
        }
    } catch {
        if (googleDocsExportUrl(location.href) === key) {
            // Retain same-document evidence, explicitly labelled as stale.
            showExportStatus(true);
        }
    } finally { exportPending = false; }
}
/** Reassemble text runs, then wrapped lines, using their rendered geometry. */
export function docsParagraphs(runs: CanvasRun[]): Paragraph[] {
    const groups: CanvasRun[][] = [];
    // Canvas strings include invisible bidi delimiters around links. They are
    // rendering controls, not part of citation text or DOI identifiers.
    const cleanRuns = runs.map(run => ({...run, text: run.text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "")}));
    for (const run of cleanRuns.sort((a, b) => a.y - b.y)) {
        const group = groups.find(items => {
            const first = items[0];
            return Math.abs(first.y + first.height / 2 - run.y - run.height / 2)
                < Math.max(first.height, run.height) * .45;
        });
        if (group) group.push(run);
        else groups.push([run]);
    }
    // Font changes alter glyph ascent. Sort within each visual line by x,
    // rather than allowing italic or superscript runs to precede its author.
    const lines: Paragraph[] = groups.map(group => {
        const sorted = group.sort((a, b) => a.x - b.x);
        let text = "";
        let right = sorted[0].x;
        for (const run of sorted) {
            if (text && run.x - right > Math.max(1, run.height * .12)
                && !/\s$/.test(text) && !/^\s/.test(run.text)) text += " ";
            text += run.text;
            right = Math.max(right, run.x + run.width);
        }
        const x = sorted[0].x;
        const y = Math.min(...group.map(run => run.y));
        return {text, x, y, width: right - x,
            height: Math.max(...group.map(run => run.y + run.height)) - y};
    });
    const paragraphs: Paragraph[] = [];
    const authorStart = /^[A-ZÀ-Ž][\p{L}'’\-]+,\s*(?:[A-Z](?:\.|[a-z]))/u;
    let lastLine: Paragraph | undefined;
    for (const line of lines.sort((a, b) => a.y - b.y)) {
        const prev = paragraphs.at(-1);
        const gap = prev ? line.y - (prev.y + prev.height) : Infinity;
        // APA hanging indents and author-led entries separate references even
        // in double-spaced bibliographies; continuation lines preserve DOIs.
        if (!prev || gap > line.height * 1.8 || authorStart.test(line.text) && line.x <= prev.x + 2
            || lastLine && line.x < lastLine.x - line.height * .5
            || /^(References|Bibliography)$/i.test(prev.text.trim())) {
            paragraphs.push({ ...line });
            lastLine = line;
            continue;
        }
        const separator = /10\.\d{4,}\/\S*$/.test(prev.text) && /^[a-z0-9][a-z0-9./_\-]+[.;)]?$/i.test(line.text.trim()) ? "" : " ";
        prev.text += separator + line.text;
        prev.width = Math.max(prev.x + prev.width, line.x + line.width) - Math.min(prev.x, line.x);
        prev.x = Math.min(prev.x, line.x);
        prev.height = line.y + line.height - prev.y;
        lastLine = line;
    }
    return paragraphs;
}
function validSnapshot(raw: unknown): raw is Snapshot {
    if (!raw || typeof raw !== "object")
        return false;
    const s = raw as Snapshot;
    return Number.isFinite(s.width) && s.width > 0 && Number.isFinite(s.height) && s.height > 0 && Array.isArray(s.runs) && s.runs.length <= 4000 && s.runs.every(r => typeof r.text === "string" && r.text.length <= 10000 && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 0 && r.height > 0);
}
export function startGoogleDocs(onChange: () => void): void {
    if (isGoogleDocs()) document.dispatchEvent(new Event("flora-docs-start-capture"));
    if (installed || !isGoogleDocs())
        return;
    installed = true;
    debugLog("Google Docs: starting canvas reader");
    void refreshGoogleDocsText(onChange);
    setInterval(() => {
        if (!document.hidden && isGoogleDocs()) void refreshGoogleDocsText(onChange);
    }, 2000);
    let timer: ReturnType<typeof setTimeout>;
    document.addEventListener(DOCS_TEXT_EVENT, (event) => {
        const canvas = event.target;
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.matches('.kix-canvas-tile-content') || !canvas.isConnected)
            return;
        try {
            const detail = (event as CustomEvent).detail;
            if (typeof detail !== "string" || detail.length > 1000000)
                return;
            const next: unknown = JSON.parse(detail);
            if (!validSnapshot(next))
                return;
            const previous = snapshots.get(canvas);
            if (previous && JSON.stringify(previous) === detail) return;
            debugLog("Google Docs: received canvas snapshot", next.runs.length, "text runs");
            snapshots.set(canvas, next);
            if (exportText === undefined) contentRevision++;
            clearTimeout(timer);
            timer = setTimeout(onChange, 300);
        }
        catch { }
    });
    let queued = false;
    const schedule = () => { if (queued)
        return; queued = true; requestAnimationFrame(() => { queued = false; positionGoogleDocsAnnotations(); }); };
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) {
        clearTimeout(timer);
        timer = setTimeout(onChange, 300);
    } });
    new MutationObserver(() => {
        for (const canvas of snapshots.keys())
            if (!canvas.isConnected) {
                snapshots.delete(canvas);
                if (exportText === undefined) contentRevision++;
                for (const entry of entries.get(canvas) ?? [])
                    entry.row?.remove();
                entries.delete(canvas);
                clearTimeout(timer);
                timer = setTimeout(onChange, 300);
            }
        schedule();
    }).observe(document.querySelector('.kix-appview') ?? document.body, { childList: true, subtree: true, attributes: true });
    document.dispatchEvent(new Event(DOCS_REQUEST_EVENT));
}
export function googleDocsReferenceElements(doc: Document): HTMLElement[] {
    if (!isGoogleDocs(doc.URL))
        return [];
    const all: HTMLElement[] = exportKey === googleDocsExportUrl(doc.URL) ? [...exportedEntries] : [];
    for (const [canvas, snapshot] of snapshots) {
        if (!canvas.isConnected)
            continue;
        const previous = entries.get(canvas) ?? [];
        const next: Entry[] = [];
        for (const box of docsParagraphs(snapshot.runs)) {
            const text = box.text.trim();
            if (!/10\.\d{4,}\//.test(text) && !(text.length > 60 && /\b(?:18|19|20)\d{2}\b/.test(text) && /^[A-ZÀ-Ž][\p{L}'’\-]+,/u.test(text)))
                continue;
            let entry = previous.find(e => e.copy.textContent === text && !next.includes(e));
            if (!entry) {
                const copy = doc.createElement('p');
                copy.textContent = text;
                entry = { canvas, copy, box, snapshot };
                byCopy.set(copy, entry);
            }
            entry.box = box;
            entry.snapshot = snapshot;
            next.push(entry);
            all.push(entry.copy);
        }
        for (const entry of previous)
            if (!next.includes(entry))
                entry.row?.remove();
        entries.set(canvas, next);
    }
    positionGoogleDocsAnnotations();
    return all;
}
export function googleDocsAnnotationTarget(copy: Element): HTMLElement | null {
    const entry = byCopy.get(copy);
    if (!entry || !entry.canvas.isConnected || !entries.get(entry.canvas)?.includes(entry))
        return null;
    if (!entry.row?.isConnected) {
        entry.row = document.createElement('div');
        entry.row.className = 'flora-docs-annotation';
        entry.row.setAttribute('data-flora-ui', '');
        entry.row.style.cssText = 'position:fixed;z-index:100000;width:32px;height:32px;display:flex;';
        document.body.append(entry.row);
    }
    positionGoogleDocsAnnotations();
    return entry.row;
}
export function positionGoogleDocsAnnotations(): void {
    const viewport = document.querySelector('.kix-appview-editor')?.getBoundingClientRect();
    for (const group of entries.values())
        for (const entry of group) {
            if (!entry.row)
                continue;
            const rect = entry.canvas.getBoundingClientRect(), sy = rect.height / entry.snapshot.height;
            const top = rect.top + entry.box.y * sy;
            // Anchor every marker to the page margin, independent of citation length.
            const right = rect.left + rect.width;
            entry.row.style.left = `${Math.max(0, Math.min(right + 12, window.innerWidth - 36))}px`;
            entry.row.style.top = `${top}px`;
            entry.row.style.visibility = !entry.canvas.isConnected || !rect.height || top < (viewport?.top ?? 0) || top + 23 > (viewport?.bottom ?? window.innerHeight) ? 'hidden' : 'visible';
        }
}
export function googleDocsAnnotatedReferences(): {
    doi: DoiString;
    title: string;
}[] {
    const refs = new Map<DoiString, {
        doi: DoiString;
        title: string;
    }>();
    for (const group of entries.values())
        for (const e of group) {
            const doi = e.row?.querySelector('[data-flora-doi]')?.getAttribute('data-flora-doi') as DoiString | null;
            if (doi && e.canvas.isConnected)
                refs.set(doi, { doi, title: e.copy.textContent ?? doi });
        }
    for (const entry of exportKey === googleDocsExportUrl(location.href) ? exportedEntries : []) {
        const doi = entry.querySelector('[data-flora-doi]')?.getAttribute('data-flora-doi') as DoiString | null;
        if (doi) refs.set(doi, {doi, title: entry.getAttribute('data-flora-source-text') ?? doi});
    }
    return [...refs.values()];
}

/** Compare revisions in O(1); successful exports make scroll/zoom irrelevant. */
export function googleDocsContentSnapshot(): number {
    return contentRevision;
}
