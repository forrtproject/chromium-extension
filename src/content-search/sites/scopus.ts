// Scopus document search (www.scopus.com/results/results.uri?… and
// /pages/search/publications?searchId=…, which render the same components).
// DOM checked 2026-08. The page offers two layouts, both covered here:
//
//   List view  — `ul > li` per result; `li > div.content` holds two flex rows
//     of columns: the first with the checkbox, a text column (title
//     `a[href^="/pages/publications/<scopusId>"]`, `div[data-testid="author-list"]`
//     "Huang X., Teng L., …", and a source line "<journal>, 2027, 94, 105005"
//     as the author list's next sibling), an empty spacer column and the
//     citation count; the second with the Show abstract / View at Publisher
//     footer.
//   Table view — three consecutive `tr` per result; the middle one carries the
//     title link in its own `td`, the author list, and
//     `div[data-testid="document-publication-year"]`.
//
// Class names are hashed CSS modules that change between deployments
// (`TableItems-module__m0Z0b`, `ListItems_column__bxqyj`), so only structure
// and `data-testid` hooks are used. The page is a React app: paging, sorting
// and the view toggle replace the rows, which the observer's "new rows"
// trigger covers.
//
// Rows print no DOI, so the Scopus record id carries them: resolveSiteIds
// batches the ids through Scopus's own search gateway (see
// @shared/scopus-resolve). content-general also runs on scopus.com on purpose:
// abstract pages print the DOI, which that script annotates, and result rows
// print none for it to pick up.

import {debugLog} from "@shared/debug";
import {normaliseScopusId, resolveScopusIds} from "@shared/scopus-resolve";
import type {RowExtraction, SearchSiteAdapter} from "./types";
import css from "./scopus.css";

const TITLE_LINK = 'a[href^="/pages/publications/"]';

export const SCOPUS: SearchSiteAdapter = {
    id: "scopus",
    label: "Scopus",
    hostnames: ["scopus.com"],
    // The one element per result that holds the title link, in either layout.
    resultRow: `li:has(${TITLE_LINK}), tr:has(${TITLE_LINK})`,
    css,
    extractRow,
    panelPlacement: [
        // List view: the result's first row of columns (the one holding the
        // text column); the stylesheet floats the panel to its right edge.
        {selector: ':scope > div > div:has([data-testid="author-list"])', position: "append"},
        // Table view: the foot of the title cell.
        {selector: `td:has(> * ${TITLE_LINK}), td:has(> ${TITLE_LINK})`, position: "append"},
    ],
    resolveSiteIds: (ids) => resolveScopusIds(ids),
};

function extractRow(row: HTMLElement): RowExtraction | null {
    const titleLink = row.querySelector<HTMLAnchorElement>(TITLE_LINK);
    const title = titleLink?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!title) return null;

    const authorList = row.querySelector<HTMLElement>('[data-testid="author-list"]');
    const siteId = normaliseScopusId(titleLink?.getAttribute("href") ?? "") ?? undefined;
    if (!siteId) debugLog(`Scopus: no record id on "${title}"`);

    return {
        title,
        firstAuthor: firstAuthorSurname(authorList),
        year: publicationYear(row, authorList),
        sourceUrl: titleLink?.href ?? null,
        doi: null,
        confident: false,
        siteId,
    };
}

/** "Huang X., Teng L." (list view) and "Rich, H.M. , Pokorny, V.J." (table
 *  view) both name the first author before the first comma-plus-initials. */
function firstAuthorSurname(authorList: HTMLElement | null): string | null {
    const authors = authorList?.textContent?.replace(/\s+/g, " ") ?? "";
    const first = authors.split(",")[0]?.trim() ?? "";
    const tokens = first.split(/\s+/).filter((token) => token && !/^[A-Z]\.?([A-Z]\.?)*$/.test(token));
    return tokens.join(" ") || null;
}

/** Table view prints the year in its own cell; list view puts it first in the
 *  source line ("Journal of Retailing and Consumer Services, 2027, 94, 105005"),
 *  which follows the author list. */
function publicationYear(row: HTMLElement, authorList: HTMLElement | null): number | null {
    const yearCell = row.querySelector<HTMLElement>('[data-testid="document-publication-year"]');
    const text = yearCell?.textContent ?? authorList?.nextElementSibling?.textContent ?? "";
    const match = text.match(/\b((?:19|20)\d{2})\b/);
    return match ? Number(match[1]) : null;
}
