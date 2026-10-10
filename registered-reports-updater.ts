import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {normaliseDOI} from './src/shared/doi-normalise.ts';
import type {RegisteredReport, RegisteredReportMap} from './src/shared/registered-reports.ts';

const API_URL = 'https://api.zotero.org/groups/5937153/items/top';
const PAGE_SIZE = 100;
const FS_OUTPUT_PATH = './src/registered-reports.json';

export interface ZoteroItem {
    key: string;
    data: {
        key: string;
        DOI?: string;
        url?: string;
        tags?: {tag: string}[];
        relations?: Record<string, string | string[]>;
    };
}

// Same stage rules as the RRDB export (github.com/LukasRoeseler/RRDB): "Stage 1
// Linked" / "Stage 1 Not Found" tag a Stage 2 manuscript, not a Stage 1 one.
export function stageOf(tags: string[]): 1 | 2 | null {
    const lower = tags.map(t => t.toLowerCase());
    if (lower.some(t => t.includes('stage 2 manuscript') || t.includes('stage 1 linked') || t.includes('stage 1 not found'))) return 2;
    if (lower.some(t => t.includes('stage 1'))) return 1;
    return null;
}

const URL_DOI = /(?:doi\.org|\/doi(?:\/(?:abs|full|pdf|epdf))?)\/(10\.\d{4,}\/[^\s?#]+)/i;

export function itemDoi(data: ZoteroItem['data']): string | null {
    return normaliseDOI(data.DOI) ?? normaliseDOI(data.url?.match(URL_DOI)?.[1]);
}

function relatedKeys(data: ZoteroItem['data']): string[] {
    const related = data.relations?.['dc:relation'];
    return (Array.isArray(related) ? related : related ? [related] : [])
        .map(uri => uri.split('/').pop() ?? '')
        .filter(Boolean);
}

function itemLink(data: ZoteroItem['data']): string | undefined {
    const doi = itemDoi(data);
    return doi ? `https://doi.org/${doi}` : data.url || undefined;
}

export function buildRegisteredReportMap(items: ZoteroItem[]): RegisteredReportMap {
    const byKey = new Map(items.map(item => [item.data.key, item.data] as const));
    const reports: Record<string, RegisteredReport> = {};
    for (const item of items) {
        const tags = (item.data.tags ?? []).map(t => t.tag);
        if (tags.some(t => t.toLowerCase() === 'not an rr')) continue;
        const doi = itemDoi(item.data);
        if (!doi) continue;
        const stage = stageOf(tags);
        const companion = stage === null ? undefined : relatedKeys(item.data)
            .map(key => byKey.get(key))
            .find(other => other && stageOf((other.tags ?? []).map(t => t.tag)) === (stage === 1 ? 2 : 1));
        const linked = companion ? itemLink(companion) : undefined;
        const report: RegisteredReport = {key: item.data.key, stage, ...(linked ? {linked} : {})};
        // The library holds untagged duplicates of some tagged items.
        const existing = reports[doi];
        if (!existing || (existing.stage === null && stage !== null) || (!existing.linked && linked)) {
            reports[doi] = report;
        }
    }
    return {reports};
}

async function fetchAllItems(): Promise<ZoteroItem[]> {
    const items: ZoteroItem[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
        const response = await fetch(`${API_URL}?limit=${PAGE_SIZE}&start=${start}`, {
            headers: {'Zotero-API-Version': '3'},
        });
        if (!response.ok) throw new Error(`HTTP ${response.status} at start=${start}`);
        const page = await response.json() as ZoteroItem[];
        items.push(...page);
        const total = Number(response.headers.get('Total-Results') ?? 0);
        if (page.length === 0 || start + PAGE_SIZE >= total) return items;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    fetchAllItems().then(items => {
        const map = buildRegisteredReportMap(items);
        const values = Object.values(map.reports);
        console.error(
            `Fetched ${items.length} items -> ${values.length} DOIs ` +
            `(${values.filter(r => r.stage === 1).length} Stage 1, ${values.filter(r => r.stage === 2).length} Stage 2, ` +
            `${values.filter(r => r.linked).length} linked).`);
        fs.writeFileSync(FS_OUTPUT_PATH, JSON.stringify(map, null, 1) + '\n');
    }).catch(error => {
        console.error('Registered Reports update failed:', error);
        process.exitCode = 1;
    });
}
