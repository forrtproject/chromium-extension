import {safeSendMessage, type SheetFetchResponse} from "@shared/messages";
import {findDOIsInText} from "@shared/doi-extractor";

export interface SheetTab { spreadsheetId: string; gid: string }

/** Sheets uses both query parameters and fragments; the active fragment wins. */
export function parseSheetsUrl(value: string): SheetTab | null {
    try {
        const url = new URL(value);
        const id = url.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1];
        if (url.hostname !== "docs.google.com" || !id) return null;
        const gid = new URLSearchParams(url.hash.slice(1)).get("gid") ?? url.searchParams.get("gid") ?? "0";
        return /^\d+$/.test(gid) ? {spreadsheetId: id, gid} : null;
    } catch { return null; }
}

export function sheetTabKey(tab: SheetTab | null): string {
    return tab ? `${tab.spreadsheetId}:${tab.gid}` : "";
}

export interface SheetCsv {
    csv: string;
    /** Rows line up with sheet rows (full-tab export, not the gviz fallback). */
    fullTab: boolean;
}

/** Empty CSV is a successful empty tab; absent/error responses are unavailable. */
export async function fetchSheetCsv(tab: SheetTab): Promise<SheetCsv> {
    const response = await safeSendMessage<SheetFetchResponse>({type: "FLORA_SHEET_FETCH", ...tab});
    if (!response || response.error || typeof response.csv !== "string") {
        throw new Error(response?.error ?? "Sheet export unavailable");
    }
    return {csv: response.csv, fullTab: response.fullTab === true};
}

/** RFC 4180-ish CSV rows; quoted fields may contain commas, quotes and newlines. */
function parseCsvRows(csv: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < csv.length; i++) {
        const c = csv[i];
        if (quoted) {
            if (c === '"' && csv[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && csv[i + 1] === "\n") i++;
            row.push(field); rows.push(row); row = []; field = "";
        } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}

/**
 * The 1-based sheet row of every DOI in a full-tab CSV export (row 1 of the
 * export is row 1 of the sheet). A DOI on several rows keeps its first row.
 */
export function sheetRowsByDoi(csv: string): Map<string, number> {
    const byDoi = new Map<string, number>();
    parseCsvRows(csv).forEach((cells, index) => {
        // Per row, so the non-logging variant: one debug line per row would
        // flush the recent-log buffer on a large tab.
        for (const doi of findDOIsInText(cells.join(" "))) {
            const key = doi.toLowerCase();
            if (!byDoi.has(key)) byDoi.set(key, index + 1);
        }
    });
    return byDoi;
}
