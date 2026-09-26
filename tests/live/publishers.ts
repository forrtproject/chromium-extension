import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, ".cache");
const HANDLE_CACHE = path.join(CACHE_DIR, "doi-landing-urls.json");
const OUTPUT = path.join(HERE, "publishers.json");
const FLORA_CSV = "https://raw.githubusercontent.com/forrtproject/FReD-data/main/output/flora.csv";
const CONCURRENCY = 4;
const LOOKUP_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DOI = /^10\.\d{4,9}\/\S+$/;

const RESOLVER_HOSTS: Record<string, string> = {
    "linkinghub.elsevier.com": "www.sciencedirect.com",
    "doi.apa.org": "psycnet.apa.org",
    "doi.wiley.com": "onlinelibrary.wiley.com",
    "dx.plos.org": "journals.plos.org",
    "journal.frontiersin.org": "www.frontiersin.org",
    "www.mitpressjournals.org": "direct.mit.edu",
    "www.blackwell-synergy.com": "onlinelibrary.wiley.com",
    "www.degruyter.com": "www.degruyterbrill.com",
    "www.ssrn.com": "papers.ssrn.com",
    "sociologicalscience.com": "www.sociologicalscience.com",
    "rips-irsp.com": "www.rips-irsp.com",
    "account.rips-irsp.com": "www.rips-irsp.com",
    "account.journalofcognition.org": "www.journalofcognition.org",
};

export interface Entry {
    id: string;
    publisher: string;
    url: string;
    domain: string;
    doi: string;
    doisInFred: number;
    source: "fred" | "manual";
}

function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(field); rows.push(row); row = []; field = "";
        } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}

async function download(url: string): Promise<string> {
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await fetch(url, {signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } catch (err) {
            if (attempt >= 3) throw new Error(`Could not download ${url}: ${(err as Error).message}`);
            await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        }
    }
}

async function loadRows(csvPath?: string): Promise<Record<string, string>[]> {
    if (!csvPath) console.log(`Downloading ${FLORA_CSV} …`);
    const text = csvPath ? readFileSync(csvPath, "utf8") : await download(FLORA_CSV);
    const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));
    return rows.filter((r) => r.length === header.length)
        .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function readCache(): Record<string, string | null> {
    try { return JSON.parse(readFileSync(HANDLE_CACHE, "utf8")); } catch { return {}; }
}

async function landingUrl(doi: string): Promise<string | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(`https://doi.org/api/handles/${encodeURIComponent(doi).replace(/%2F/g, "/")}?type=URL`,
                {signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)});
            if (response.status === 404) return null;
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const body = await response.json() as {values?: {type: string; data: {value: string}}[]};
            return body.values?.find((v) => v.type === "URL")?.data.value ?? null;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
    return null;
}

async function resolveAll(dois: string[]): Promise<Record<string, string | null>> {
    const cache = readCache();
    const missing = dois.filter((d) => !(d in cache));
    console.log(`${dois.length} DOIs, ${dois.length - missing.length} already cached, resolving ${missing.length}…`);
    let done = 0;
    const queue = [...missing];
    await Promise.all(Array.from({length: CONCURRENCY}, async () => {
        for (let doi = queue.shift(); doi; doi = queue.shift()) {
            cache[doi] = await landingUrl(doi);
            if (++done % 250 === 0) {
                console.log(`  ${done}/${missing.length}`);
                writeFileSync(HANDLE_CACHE, JSON.stringify(cache));
            }
        }
    }));
    writeFileSync(HANDLE_CACHE, JSON.stringify(cache));
    return cache;
}

function domainOf(url: string | null): string | null {
    if (!url) return null;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return RESOLVER_HOSTS[host] ?? host;
    } catch {
        return null;
    }
}

function publisherName(bibtex: string): string | null {
    return bibtex.match(/publisher\s*=\s*\{([^}]+)\}/i)?.[1]?.trim() ?? null;
}

function slug(domain: string, used: Set<string>): string {
    const base = domain.replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
}

function mostCommon(values: string[]): string | undefined {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

export async function refreshPublishers(csvPath?: string): Promise<void> {
    mkdirSync(CACHE_DIR, {recursive: true});
    const rows = await loadRows(csvPath);
    const replications = new Map<string, number>();
    const publishers = new Map<string, string>();
    for (const row of rows) {
        for (const role of ["o", "r"] as const) {
            const doi = (row[`doi_${role}`] ?? "").trim().toLowerCase();
            if (!DOI.test(doi)) continue;
            if (!replications.has(doi)) replications.set(doi, 0);
            if (role === "o") replications.set(doi, replications.get(doi)! + 1);
            const name = publisherName(row[`bibtex_ref_${role}`] ?? "") ?? row[`journal_${role}`];
            if (name && name !== "NA" && !publishers.has(doi)) publishers.set(doi, name);
        }
    }
    const dois = [...replications.keys()].sort();
    const landing = await resolveAll(dois);

    const bySite = new Map<string, {hosts: string[]; dois: string[]}>();
    let unresolved = 0;
    for (const doi of dois) {
        const host = domainOf(landing[doi]);
        if (!host) { unresolved++; continue; }
        const site = bySite.get(host.replace(/^www\./, "")) ?? {hosts: [], dois: []};
        site.hosts.push(host);
        site.dois.push(doi);
        bySite.set(host.replace(/^www\./, ""), site);
    }

    const used = new Set<string>();
    const entries: Entry[] = [...bySite.values()]
        .map(({hosts, dois: list}) => {
            const sample = [...list].sort((a, b) => replications.get(b)! - replications.get(a)!)[0];
            const domain = mostCommon(hosts)!;
            const publisher = mostCommon(list.map((d) => publishers.get(d)).filter((n): n is string => Boolean(n)));
            return {publisher: publisher ?? domain, url: `https://doi.org/${sample}`,
                domain, doi: sample, doisInFred: list.length, source: "fred" as const};
        })
        .sort((a, b) => b.doisInFred - a.doisInFred || a.domain.localeCompare(b.domain))
        .map((entry) => ({id: slug(entry.domain, used), ...entry}));

    const previous: Partial<Entry>[] = existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT, "utf8")) : [];
    for (const old of previous) {
        if (old.source === "fred" || !old.url || !old.id) continue;
        const domain = new URL(old.url).hostname.toLowerCase();
        if (bySite.has(domain.replace(/^www\./, ""))) continue;
        entries.push({id: slug(domain, used), publisher: old.publisher ?? domain, url: old.url, domain,
            doi: old.doi ?? "", doisInFred: 0, source: "manual"});
    }

    writeFileSync(OUTPUT, JSON.stringify(entries, null, 2) + "\n");
    console.log(`\n${rows.length} FReD rows → ${dois.length} DOIs → ${bySite.size} websites (${unresolved} DOIs did not resolve).`);
    console.log(`Wrote ${entries.length} entries to ${path.relative(process.cwd(), OUTPUT)}.`);
    console.log("Top domains:", entries.slice(0, 12).map((e) => `${e.domain} (${e.doisInFred})`).join(", "));
}
