import { fetchGoogleDocsText, googleDocsExportUrl } from "./google-docs-source";
import { debugLog } from "./debug";
import type { CanvasRun } from "../content-docs/canvas";
import { DOCS_TEXT_EVENT, DOCS_REQUEST_EVENT } from "../content-docs/canvas";
import type { DoiString } from "./types";
import { markerColumnLeft } from "./editor-marker";
import { findDOIsInText } from "./doi-extractor";
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
const TYPING_IDLE_MS = 1500;
const MAX_RETIRED_ENTRIES = 200;
let retired: Entry[] = [];
const DOI_CANDIDATE = /10\.\d{4,}\//;
const CITATION_YEAR = /\b(?:18|19|20)\d{2}[a-z]?\b/;
const CITATION_START = /^(?:(?:\[\d{1,3}\]|\d{1,3}[.)])\s*)?[A-ZÀ-Ž][\p{L}'’\-]+(?:,|\s[A-Z]{1,3}[,.])/u;
export function isReferenceCandidate(text: string): boolean {
    return DOI_CANDIDATE.test(text) || text.length > 60 && CITATION_YEAR.test(text) && CITATION_START.test(text);
}
function identity(text: string): string {
    const dois = findDOIsInText(text);
    return dois.length > 0 ? `doi:${dois.sort().join(' ')}` : `text:${text}`;
}
function matchKeys(text: string): string[] {
    const key = identity(text);
    return key.startsWith('doi:') ? [`text:${text}`, key] : [key];
}
class ReusePool<T> {
    private byKey = new Map<string, T[]>();
    private taken = new Set<T>();
    constructor(items: readonly T[], text: (item: T) => string) {
        for (const item of items)
            for (const key of matchKeys(text(item))) {
                const list = this.byKey.get(key);
                if (list) list.push(item);
                else this.byKey.set(key, [item]);
            }
    }
    take(text: string, prefer: (item: T) => boolean = () => false): T | undefined {
        for (const key of matchKeys(text)) {
            const free = this.byKey.get(key)?.filter(item => !this.taken.has(item)) ?? [];
            const item = free.find(prefer) ?? free[0];
            if (item) {
                this.taken.add(item);
                return item;
            }
        }
        return undefined;
    }
    isTaken(item: T): boolean {
        return this.taken.has(item);
    }
}
let contentKey = '';
let scannedKey: string | null = null;
function referenceKey(): string {
    const keys: string[] = [];
    for (const group of entries.values())
        for (const entry of group)
            if (entry.canvas.isConnected) keys.push(`canvas ${identity(entry.copy.textContent ?? '')}`);
    if (exportKey === googleDocsExportUrl(location.href))
        for (const element of exportedEntries) keys.push(`export ${identity(element.getAttribute('data-flora-source-text') ?? '')}`);
    return keys.sort().join('\n');
}
function noteContent(): void {
    const key = referenceKey();
    if (key === contentKey) return;
    contentKey = key;
    contentRevision++;
}
function rescanIfChanged(onChange: () => void): void {
    if (!document.hidden && contentKey !== scannedKey) onChange();
}
/** Detached reference entries persist when Docs recycles offscreen canvases. */
export function setGoogleDocsText(text: string, doc: Document = document): void {
    const key = googleDocsExportUrl(doc.URL);
    exportKey = key;
    exportText = text;
    const sourceText = (element: HTMLElement) => element.getAttribute('data-flora-source-text') ?? '';
    const pool = new ReusePool(exportedEntries, sourceText);
    exportedEntries = text.split(/\r?\n/).map(line => line.trim()).filter(isReferenceCandidate).map(line => {
        const existing = pool.take(line);
        if (existing) {
            if (sourceText(existing) !== line) {
                existing.setAttribute('data-flora-source-text', line);
                if (existing.firstChild?.nodeType === Node.TEXT_NODE) existing.firstChild.textContent = line;
                else existing.prepend(line);
            }
            return existing;
        }
        const copy = doc.createElement('p');
        copy.textContent = line;
        copy.setAttribute('data-flora-source-text', line);
        return copy;
    });
    noteContent();
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
        ? 'ORE: Could not recheck the whole document. The report uses the last complete scan and may miss recent edits. Retrying automatically.'
        : 'ORE: Full-document scan unavailable. Only visible pages have been checked. Retrying automatically.';
}
async function refreshGoogleDocsText(onChange: () => void): Promise<void> {
    const key = googleDocsExportUrl(location.href);
    if (key !== exportKey) {
        exportKey = key;
        exportedEntries = [];
        exportText = undefined;
        exportCheckedAt = 0;
        noteContent();
        rescanIfChanged(onChange);
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
            rescanIfChanged(onChange);
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
    const heading = /^(References|Bibliography)$/i;
    const midAuthorList = /(?:[,;:&]|\band)$/;
    const endsInDoi = /10\.\d{4,}\/\S*$/;
    const doiTail = /^[a-z0-9][a-z0-9./_\-]+[.;)]?$/i;
    const startsDoi = /^10\.\d{4,}\//;
    const orderedLines = lines.sort((a, b) => a.y - b.y);
    const lineGaps = orderedLines.slice(1).map((line, i) => line.y - (orderedLines[i].y + orderedLines[i].height)).sort((a, b) => a - b);
    const typicalGap = lineGaps[Math.floor((lineGaps.length - 1) / 2)] ?? 0;
    let lastLine: Paragraph | undefined;
    let firstLineX = 0;
    for (const line of orderedLines) {
        const prev = paragraphs.at(-1);
        const gap = prev ? line.y - (prev.y + prev.height) : Infinity;
        const lineText = line.text.trim();
        const continuesDoi = !!prev && endsInDoi.test(prev.text) && doiTail.test(lineText) && !startsDoi.test(lineText);
        // APA hanging indents and author-led entries separate references even
        // in double-spaced bibliographies; continuation lines preserve DOIs.
        if (!prev || gap > Math.min(line.height * 1.8, typicalGap + line.height * .4)
            || authorStart.test(line.text) && line.x <= firstLineX + 2 && !midAuthorList.test(lastLine?.text.trim() ?? "")
            || lastLine && line.x < lastLine.x - line.height * .5
            || heading.test(lineText) || heading.test(prev.text.trim())
            || endsInDoi.test(prev.text) && !continuesDoi) {
            paragraphs.push({ ...line });
            lastLine = line;
            firstLineX = line.x;
            continue;
        }
        const separator = continuesDoi ? "" : " ";
        prev.text += separator + line.text;
        prev.width = Math.max(prev.x + prev.width, line.x + line.width) - Math.min(prev.x, line.x);
        prev.x = Math.min(prev.x, line.x);
        prev.height = line.y + line.height - prev.y;
        lastLine = line;
    }
    return paragraphs;
}
const compact = (text: string): string => text.replace(/\s+/g, "");
const MIN_PAGE_FRAGMENT_LENGTH = 20;

function acrossPageBreak(text: string, opensPage: boolean, closesPage: boolean): string | null {
    const fragment = compact(text);
    if ((!opensPage && !closesPage) || fragment.length < MIN_PAGE_FRAGMENT_LENGTH) return text;
    for (const entry of exportedEntries) {
        const whole = entry.getAttribute('data-flora-source-text') ?? "";
        const wholeCompact = compact(whole);
        if (wholeCompact.length <= fragment.length) continue;
        if (closesPage && wholeCompact.startsWith(fragment)) return whole;
        if (opensPage && wholeCompact.endsWith(fragment)) return null;
    }
    return text;
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
    const refreshWhenIdle = (delay = TYPING_IDLE_MS) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            rebuildEntries(document);
            rescanIfChanged(onChange);
        }, delay);
    };
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
            refreshWhenIdle(previous ? TYPING_IDLE_MS : 0);
        }
        catch { }
    });
    let queued = false;
    const schedule = () => { if (queued)
        return; queued = true; requestAnimationFrame(() => { queued = false; positionGoogleDocsAnnotations(); }); };
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshWhenIdle(300); });
    new MutationObserver(() => {
        for (const canvas of snapshots.keys())
            if (!canvas.isConnected) {
                snapshots.delete(canvas);
                refreshWhenIdle(0);
            }
        schedule();
    }).observe(document.querySelector('.kix-appview') ?? document.body, { childList: true, subtree: true, attributes: true });
    document.dispatchEvent(new Event(DOCS_REQUEST_EVENT));
}
export function googleDocsReferenceElements(doc: Document): HTMLElement[] {
    if (!isGoogleDocs(doc.URL))
        return [];
    const exportCurrent = exportKey === googleDocsExportUrl(doc.URL);
    const all = [...(exportCurrent ? exportedEntries : []), ...rebuildEntries(doc)];
    scannedKey = contentKey;
    return all;
}
function rebuildEntries(doc: Document): HTMLElement[] {
    const exportCurrent = exportKey === googleDocsExportUrl(doc.URL);
    const available = [...[...entries.values()].flat(), ...retired];
    const pool = new ReusePool(available, e => e.copy.textContent ?? '');
    const next = new Map<HTMLCanvasElement, Entry[]>();
    const all: HTMLElement[] = [];
    for (const [canvas, snapshot] of snapshots) {
        if (!canvas.isConnected)
            continue;
        const group: Entry[] = [];
        const paragraphs = docsParagraphs(snapshot.runs);
        for (const [index, box] of paragraphs.entries()) {
            const rendered = box.text.trim();
            const text = exportCurrent ? acrossPageBreak(rendered, index === 0, index === paragraphs.length - 1) : rendered;
            if (text === null)
                continue;
            if (!isReferenceCandidate(text))
                continue;
            let entry = pool.take(text, e => e.canvas === canvas);
            if (entry) {
                if (entry.row && !entry.row.isConnected) doc.body.append(entry.row);
                if (entry.copy.textContent !== text) entry.copy.textContent = text;
                entry.canvas = canvas;
            } else {
                const copy = doc.createElement('p');
                copy.textContent = text;
                entry = { canvas, copy, box, snapshot };
                byCopy.set(copy, entry);
            }
            entry.box = box;
            entry.snapshot = snapshot;
            group.push(entry);
            all.push(entry.copy);
        }
        next.set(canvas, group);
    }
    const unused = available.filter(e => !pool.isTaken(e));
    for (const entry of unused)
        entry.row?.remove();
    retired = unused.slice(0, MAX_RETIRED_ENTRIES);
    entries.clear();
    for (const [canvas, group] of next)
        entries.set(canvas, group);
    positionGoogleDocsAnnotations();
    noteContent();
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
        entry.row.style.cssText = 'position:fixed;z-index:100000;display:flex;align-items:center;height:23px;';
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
            entry.row.style.left = `${markerColumnLeft(right + 12, entry.row.offsetWidth)}px`;
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
