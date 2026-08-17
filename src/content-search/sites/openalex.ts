// OpenAlex works search (openalex.org/works?…). DOM checked 2026-08: rows are
// `.result-item` (display:flex) holding `.result-content`; the title link
// `a.result-title` points at /works/w<id>; `.result-meta` holds "<year> ·
// <authors> · <venue> · <cited-by>" as sibling spans. Rows print no DOI, so
// the work id is resolved to one through the OpenAlex API in one batched call.

import {debugLog} from "@shared/debug";
import {resolveOpenAlexIdsViaWorker} from "@shared/messages";
import {normaliseOpenAlexId} from "@shared/openalex-resolve";
import type {RowExtraction, SearchSiteAdapter} from "./types";
import css from "./openalex.css";

export const OPENALEX: SearchSiteAdapter = {
    id: "openalex",
    label: "OpenAlex",
    hostnames: ["openalex.org"],
    resultRow: ".result-item",
    css,
    extractRow,
    // A sibling of the text column, so the flex row shows the panel on the right.
    panelPlacement: [{selector: ".result-content", position: "after"}],
    noticeTarget: (row) => row.querySelector<HTMLElement>(".result-title-wrap"),
    resolveSiteIds: resolveOpenAlexIdsViaWorker,
};

function extractRow(row: HTMLElement): RowExtraction | null {
    const titleLink = row.querySelector<HTMLAnchorElement>("a.result-title");
    const title = titleLink?.textContent?.trim() ?? "";
    if (!title) return null;

    const meta = [...row.querySelectorAll<HTMLElement>(".result-meta > span")]
        .map((span) => span.textContent?.trim() ?? "")
        .filter((text) => text && text !== "·");
    const yearMatch = meta[0]?.match(/^(?:19|20)\d{2}$/);
    const year = yearMatch ? Number(yearMatch[0]) : null;
    // Authors follow the year: "C. Daryl Cameron, Jazmin L. Brown-Iannuzzi, et al."
    const authorsText = meta[year ? 1 : 0] ?? "";
    const firstAuthorTokens = authorsText.split(",")[0]?.trim().split(/\s+/) ?? [];
    const firstAuthor = firstAuthorTokens.length > 0 && !/^et al\.?$/i.test(authorsText)
        ? firstAuthorTokens[firstAuthorTokens.length - 1] ?? null
        : null;

    const siteId = normaliseOpenAlexId(titleLink?.getAttribute("href") ?? "") ?? undefined;
    if (!siteId) debugLog(`OpenAlex: no work id on "${title}"`);
    return {
        title,
        firstAuthor,
        year,
        sourceUrl: titleLink?.href ?? null,
        doi: null,
        confident: false,
        siteId,
    };
}
