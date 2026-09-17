export function isExcelOnline(url = location.href): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && parsed.hostname.endsWith(".officeapps.live.com")
            && parsed.pathname.toLowerCase().startsWith("/x/_layouts/");
    } catch { return false; }
}

import {debugLog} from "./debug";
import {EXCEL_TEXT_EVENT, EXCEL_REQUEST_EVENT, type CanvasRun} from "../content-docs/canvas";

interface Snapshot {width: number; height: number; runs: CanvasRun[]}

const DOI_ROW = /10\.\d{4,}\//;

const snapshots = new Map<HTMLCanvasElement, Snapshot>();
const MAX_RETAINED_ROWS = 5000;
const retained = new Set<string>();
let installed = false;
let revision = 0;
let textHandler: ((event: Event) => void) | null = null;
let tileObserver: MutationObserver | null = null;

function validSnapshot(raw: unknown): raw is Snapshot {
    if (!raw || typeof raw !== "object") return false;
    const s = raw as Snapshot;
    return Number.isFinite(s.width) && s.width > 0 && Number.isFinite(s.height) && s.height > 0
        && Array.isArray(s.runs) && s.runs.length <= 4000
        && s.runs.every(r => typeof r.text === "string" && r.text.length <= 10000
            && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 0 && r.height > 0);
}

export function excelRows(runs: readonly CanvasRun[]): string[] {
    const rows: CanvasRun[][] = [];
    for (const run of [...runs].sort((a, b) => a.y - b.y)) {
        const row = rows.find(items => Math.abs(items[0].y - run.y) < Math.max(items[0].height, run.height) * .5);
        if (row) row.push(run); else rows.push([run]);
    }
    return rows.map(row => row.sort((a, b) => a.x - b.x).map(r => r.text).join(" ").trim())
        .filter(text => text.length > 0);
}

function retain(rows: readonly string[]): void {
    for (const row of rows) {
        if (!DOI_ROW.test(row) || retained.has(row)) continue;
        if (retained.size >= MAX_RETAINED_ROWS) return;
        retained.add(row);
    }
}

export function excelOnlineText(): string {
    const runs: CanvasRun[] = [];
    for (const [canvas, snapshot] of snapshots) {
        if (canvas.isConnected) runs.push(...snapshot.runs);
    }
    return [...new Set([...excelRows(runs), ...retained])].join("\n");
}

export function excelRetainedRowCount(): number {
    return retained.size;
}

export function excelContentRevision(): number {
    return revision;
}

export function startExcelOnline(onChange: () => void): void {
    if (!isExcelOnline()) return;
    document.dispatchEvent(new Event("flora-excel-start-capture"));
    if (installed) return;
    installed = true;
    debugLog("Excel: starting canvas reader");
    let timer: ReturnType<typeof setTimeout>;
    textHandler = event => {
        const canvas = event.target;
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) return;
        try {
            const detail = (event as CustomEvent).detail;
            if (typeof detail !== "string" || detail.length > 1000000) return;
            const next: unknown = JSON.parse(detail);
            if (!validSnapshot(next)) return;
            if (JSON.stringify(snapshots.get(canvas)) === detail) return;
            snapshots.set(canvas, next);
            retain(excelRows(next.runs));
            revision++;
            clearTimeout(timer);
            timer = setTimeout(onChange, 300);
        } catch { }
    };
    document.addEventListener(EXCEL_TEXT_EVENT, textHandler);
    tileObserver = new MutationObserver(() => {
        for (const canvas of snapshots.keys()) {
            if (!canvas.isConnected) { snapshots.delete(canvas); revision++; }
        }
    });
    tileObserver.observe(document.body, {childList: true, subtree: true});
    document.dispatchEvent(new Event(EXCEL_REQUEST_EVENT));
}

export function _resetExcelForTesting(): void {
    if (textHandler) document.removeEventListener(EXCEL_TEXT_EVENT, textHandler);
    textHandler = null;
    tileObserver?.disconnect();
    tileObserver = null;
    snapshots.clear();
    retained.clear();
    installed = false;
    revision = 0;
}
