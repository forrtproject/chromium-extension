// A Meta Report as portable data: the panel builds one, the print view and the
// shared web page both render it. Nothing is uploaded — a shared report travels
// entirely inside the link's fragment, which browsers never send to a server.

import type {NoticeKind} from "@shared/types";

// The docs site's canonical host. forrtproject.github.io/* 301-redirects here,
// so linking to the github.io form would ship a redirect in every shared link.
export const REPORT_PAGE_URL = "https://forrt.org/chromium-extension/report.html";
export const INSTALL_URL = "https://forrt.org/chromium-extension/";

export interface ReportEntry {
    title: string;
    doi?: string | null;
    url?: string | null;
    authors?: string | null;
    year?: number | null;
    journal?: string | null;
    outcome?: string | null;
}

export interface ReportReference {
    title: string;
    doi: string;
    replications?: number;
    reproductions?: number;
    inAtlas?: boolean;
    notice?: NoticeKind | null;
    comments?: number;
}

export interface ReportPayload {
    v: 1;
    title: string;
    doi?: string | null;
    authors?: string | null;
    year?: number | null;
    sourceUrl?: string | null;
    generated: number;
    notice?: {kind: NoticeKind; doi: string} | null;
    replications: ReportEntry[];
    reproductions: ReportEntry[];
    originals: ReportEntry[];
    references: ReportReference[];
    pubpeer?: {comments: number; url: string} | null;
}

// ──────────────────────────────────────────────
// Encoding — deflate + base64url, so a report of any realistic size fits in a
// fragment. Chrome's URL bar tolerates far more than this produces in practice.
// ──────────────────────────────────────────────

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function pipeThrough(bytes: Uint8Array, stream: TransformStream): Promise<Uint8Array> {
    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
    const chunks: Uint8Array[] = [];
    const reader = source.pipeThrough(stream).getReader();
    for (;;) {
        const {done, value} = await reader.read() as {done: boolean; value?: Uint8Array};
        if (done) break;
        if (value) chunks.push(value);
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

export async function encodeReport(payload: ReportPayload): Promise<string> {
    const json = new TextEncoder().encode(JSON.stringify(payload));
    const deflated = await pipeThrough(json, new CompressionStream("deflate-raw"));
    return toBase64Url(deflated);
}

export async function decodeReport(encoded: string): Promise<ReportPayload | null> {
    try {
        const inflated = await pipeThrough(
            fromBase64Url(encoded),
            new DecompressionStream("deflate-raw")
        );
        const payload = JSON.parse(new TextDecoder().decode(inflated)) as ReportPayload;
        return payload.v === 1 && typeof payload.title === "string" ? payload : null;
    } catch {
        return null;
    }
}

export async function reportUrl(payload: ReportPayload): Promise<string> {
    return `${REPORT_PAGE_URL}#${await encodeReport(payload)}`;
}

// ──────────────────────────────────────────────
// Rendering
// ──────────────────────────────────────────────

function esc(value: string): string {
    return value.replace(/[&<>"']/g, (c) => (
        {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c] ?? c
    ));
}

function outcomeTone(outcome: string): string {
    const lower = outcome.toLowerCase();
    if (lower.includes("success") || lower.includes("replicated") || lower === "yes") {
        return "background:#d1fae5;color:#065f46;";
    }
    if (lower.includes("fail") || lower === "no") return "background:#fee2e2;color:#991b1b;";
    return "background:#fef8e8;color:#b8860b;";
}

function entryHtml(entry: ReportEntry): string {
    const href = entry.url ?? (entry.doi ? `https://doi.org/${entry.doi}` : null);
    const heading = href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(entry.title)}</a>`
        : esc(entry.title);
    const meta = [entry.authors, entry.year ? String(entry.year) : null, entry.journal]
        .filter((part): part is string => !!part)
        .join(" · ");
    const badge = entry.outcome
        ? `<span class="badge" style="${outcomeTone(entry.outcome)}">${esc(entry.outcome)}</span>`
        : "";
    return `<li><div class="entry-head">${heading}${badge}</div>${
        meta ? `<div class="meta">${esc(meta)}</div>` : ""
    }</li>`;
}

function sectionHtml(title: string, entries: ReportEntry[]): string {
    if (entries.length === 0) return "";
    return `<section>
      <h2>${esc(title)} <span class="count">${entries.length}</span></h2>
      <ul class="entries">${entries.map(entryHtml).join("")}</ul>
    </section>`;
}

function referenceHtml(reference: ReportReference): string {
    const tags: string[] = [];
    if (reference.replications) {
        tags.push(`<span class="tag tag-repl">${reference.replications} replication${reference.replications === 1 ? "" : "s"}</span>`);
    }
    if (reference.reproductions) {
        tags.push(`<span class="tag tag-repro">${reference.reproductions} reproduction${reference.reproductions === 1 ? "" : "s"}</span>`);
    }
    if (reference.inAtlas) tags.push(`<span class="tag tag-atlas">In the Atlas</span>`);
    if (reference.notice === "retraction") tags.push(`<span class="tag tag-retracted">Retracted</span>`);
    if (reference.notice === "concern") tags.push(`<span class="tag tag-concern">Concern</span>`);
    if (reference.comments) {
        tags.push(`<span class="tag tag-pubpeer">${reference.comments} PubPeer comment${reference.comments === 1 ? "" : "s"}</span>`);
    }
    if (tags.length === 0) return "";
    return `<li>
      <div class="entry-head"><a href="https://doi.org/${esc(reference.doi)}" target="_blank" rel="noopener">${esc(reference.title)}</a></div>
      <div class="tags">${tags.join("")}</div>
    </li>`;
}

function noticeHtml(payload: ReportPayload): string {
    if (!payload.notice) return "";
    const isRetraction = payload.notice.kind === "retraction";
    return `<a class="notice ${isRetraction ? "notice-retracted" : "notice-concern"}"
      href="https://doi.org/${esc(payload.notice.doi)}" target="_blank" rel="noopener">
      <strong>${isRetraction ? "This article has been retracted." : "This article has an expression of concern."}</strong>
      <span>Read the notice ↗</span>
    </a>`;
}

export const REPORT_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px 64px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1f2328; background: #f6f7f9; line-height: 1.5;
  }
  .sheet { max-width: 760px; margin: 0 auto; background: #fff; border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden; }
  .masthead { background: linear-gradient(135deg,#853953,#612D53); color: #fff;
    padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  .masthead .brand { background: rgba(255,255,255,0.2); font-weight: 700; font-size: 13px;
    padding: 3px 9px; border-radius: 5px; letter-spacing: 0.3px; }
  .masthead .what { font-size: 14px; font-weight: 500; }
  .head { padding: 24px; border-bottom: 1px solid #e8e8e8; }
  .head h1 { margin: 0 0 6px; font-size: 22px; line-height: 1.3; color: #853953; }
  .head h1 a { color: inherit; text-decoration: none; }
  .head .byline { font-size: 13px; color: #5f6368; }
  .head .doi { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; color: #5f6368; margin-top: 6px; }
  .stats { display: flex; gap: 12px; padding: 20px 24px; flex-wrap: wrap; }
  .stat { flex: 1; min-width: 120px; background: #f9f0f4; border: 1px solid #d4a5b8;
    border-radius: 8px; padding: 14px; text-align: center; }
  .stat b { display: block; font-size: 24px; font-weight: 600; color: #853953; line-height: 1; }
  .stat span { font-size: 11px; color: #612D53; font-weight: 500; }
  .notice { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    margin: 0 24px 20px; padding: 12px 14px; border-radius: 8px; text-decoration: none;
    font-size: 13px; }
  .notice-retracted { background: #fdecef; border: 1px solid #f5a3b4; border-left: 4px solid #FF1744; color: #a30d2d; }
  .notice-concern { background: #fff7ed; border: 1px solid #fdba74; border-left: 4px solid #ea580c; color: #9a3412; }
  section { border-top: 1px solid #e8e8e8; padding: 18px 24px; }
  section h2 { margin: 0 0 12px; font-size: 12px; font-weight: 600; color: #5f6368;
    text-transform: uppercase; letter-spacing: 0.5px; }
  section h2 .count { color: #853953; }
  .entries { list-style: none; margin: 0; padding: 0; }
  .entries li { padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
  .entries li:last-child { border-bottom: 0; }
  .entry-head { display: flex; align-items: flex-start; gap: 8px; }
  .entry-head a { font-size: 13px; font-weight: 500; color: #853953; text-decoration: none; }
  .badge { flex-shrink: 0; font-size: 10px; font-weight: 600; padding: 1px 8px; border-radius: 10px; }
  .meta { font-size: 11px; color: #5f6368; margin-top: 2px; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .tag { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 10px; }
  .tag-repl { background: #e0f2fe; color: #0369a1; }
  .tag-repro { background: #ede9fe; color: #6d28d9; }
  .tag-atlas { background: #fef9c3; color: #854d0e; }
  .tag-retracted { background: #FF1744; color: #fff; }
  .tag-concern { background: #fff7ed; color: #9a3412; border: 1px solid #ea580c; }
  .tag-pubpeer { background: #e6efec; color: #446058; }
  .colophon { padding: 18px 24px; border-top: 1px solid #e8e8e8; font-size: 11px; color: #5f6368; }
  .colophon a { color: #853953; }
  .install { display: block; margin: 20px auto 0; max-width: 760px; text-align: center;
    padding: 14px; background: #fff; border: 1px solid #d4a5b8; border-radius: 10px;
    font-size: 13px; color: #853953; text-decoration: none; font-weight: 600; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; max-width: none; }
    .install { display: none; }
    a { text-decoration: none; color: inherit; }
    section { break-inside: avoid; }
  }
`;

/** The report's body, shared by the printable view and the web page. */
export function renderReportBody(payload: ReportPayload): string {
    const replications = payload.replications.length;
    const reproductions = payload.reproductions.length;
    const originals = payload.originals.length;
    const flaggedRefs = payload.references.filter((r) => referenceHtml(r) !== "");

    const stats = [
        replications ? {n: replications, label: `Replication${replications === 1 ? "" : "s"}`} : null,
        reproductions ? {n: reproductions, label: `Reproduction${reproductions === 1 ? "" : "s"}`} : null,
        originals ? {n: originals, label: `Original stud${originals === 1 ? "y" : "ies"}`} : null,
        payload.pubpeer?.comments
            ? {n: payload.pubpeer.comments, label: `PubPeer comment${payload.pubpeer.comments === 1 ? "" : "s"}`}
            : null,
    ].filter((stat): stat is {n: number; label: string} => stat !== null);

    const heading = payload.sourceUrl
        ? `<a href="${esc(payload.sourceUrl)}" target="_blank" rel="noopener">${esc(payload.title)}</a>`
        : esc(payload.title);
    const byline = [payload.authors, payload.year ? String(payload.year) : null]
        .filter((part): part is string => !!part).join(" · ");

    return `<div class="sheet">
    <div class="masthead">
      <span class="brand">FORRT ORE</span>
      <span class="what">Meta Report</span>
    </div>
    <div class="head">
      <h1>${heading}</h1>
      ${byline ? `<div class="byline">${esc(byline)}</div>` : ""}
      ${payload.doi ? `<div class="doi">${esc(payload.doi)}</div>` : ""}
    </div>
    ${noticeHtml(payload)}
    ${stats.length ? `<div class="stats">${stats.map((s) =>
        `<div class="stat"><b>${s.n}</b><span>${esc(s.label)}</span></div>`
    ).join("")}</div>` : ""}
    ${sectionHtml("Replications", payload.replications)}
    ${sectionHtml("Reproductions", payload.reproductions)}
    ${sectionHtml("Original papers", payload.originals)}
    ${flaggedRefs.length ? `<section>
      <h2>Flagged references <span class="count">${flaggedRefs.length}</span></h2>
      <ul class="entries">${flaggedRefs.map(referenceHtml).join("")}</ul>
    </section>` : ""}
    <div class="colophon">
      Compiled by <a href="${INSTALL_URL}">FORRT ORE</a> on
      ${esc(new Date(payload.generated).toLocaleDateString(undefined, {dateStyle: "long"}))}
      from the FORRT Replication Database, Retraction Watch, Unpaywall and PubPeer.
      Replication evidence is a starting point for judgement, not a verdict.
    </div>
  </div>`;
}

/** A standalone document, for printing to PDF without a network round trip. */
export function renderReportDocument(payload: ReportPayload): string {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(payload.title)} — FORRT ORE Meta Report</title>
<style>${REPORT_STYLES}</style>
</head><body>${renderReportBody(payload)}</body></html>`;
}
