import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, ".cache");
const HANDLE_CACHE = path.join(CACHE_DIR, "doi-landing-urls.json");
const OUTPUT = path.join(HERE, "publishers.json");
const FLORA_CSV = "https://raw.githubusercontent.com/forrtproject/FReD-data/main/output/flora.csv";
const CONCURRENCY = 4;
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

async function loadRows(csvPath?: string): Promise<Record<string, string>[]> {
    if (!csvPath) console.log(`Downloading ${FLORA_CSV} …`);
    const text = csvPath ? readFileSync(csvPath, "utf8") : await (await fetch(FLORA_CSV)).text();
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
            const response = await fetch(`https://doi.org/api/handles/${encodeURIComponent(doi).replace(/%2F/g, "/")}?type=URL`);
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

function slug(domain: string): string {
    return domain.replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

    const byDomain = new Map<string, string[]>();
    let unresolved = 0;
    for (const doi of dois) {
        const domain = domainOf(landing[doi]);
        if (!domain) { unresolved++; continue; }
        byDomain.set(domain, [...(byDomain.get(domain) ?? []), doi]);
    }

    const entries: Entry[] = [...byDomain.entries()].map(([domain, list]) => {
        const sample = [...list].sort((a, b) => replications.get(b)! - replications.get(a)!)[0];
        const names = list.map((d) => publishers.get(d)).filter((n): n is string => Boolean(n));
        const common = [...new Set(names)].sort((a, b) =>
            names.filter((n) => n === b).length - names.filter((n) => n === a).length)[0];
        return {
            id: slug(domain), publisher: common ?? domain, url: `https://doi.org/${sample}`,
            domain, doi: sample, doisInFred: list.length, source: "fred",
        };
    }).sort((a, b) => b.doisInFred - a.doisInFred || a.domain.localeCompare(b.domain));

    const previous: Partial<Entry>[] = existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT, "utf8")) : [];
    const covered = new Set(entries.map((e) => e.domain.replace(/^www\./, "")));
    for (const old of previous) {
        if (old.source === "fred" || !old.url || !old.id) continue;
        const domain = new URL(old.url).hostname.toLowerCase();
        if (covered.has(domain.replace(/^www\./, ""))) continue;
        entries.push({id: old.id, publisher: old.publisher ?? domain, url: old.url, domain,
            doi: old.doi ?? "", doisInFred: 0, source: "manual"});
    }

    writeFileSync(OUTPUT, JSON.stringify(entries, null, 2) + "\n");
    console.log(`\n${rows.length} FReD rows → ${dois.length} DOIs → ${byDomain.size} domains (${unresolved} DOIs did not resolve).`);
    console.log(`Wrote ${entries.length} entries to ${path.relative(process.cwd(), OUTPUT)}.`);
    console.log("Top domains:", entries.slice(0, 12).map((e) => `${e.domain} (${e.doisInFred})`).join(", "));
}
