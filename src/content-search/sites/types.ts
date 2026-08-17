// Contract for one search-results site (Google Scholar, OpenAlex, …).
//
// The pipeline in ../pipeline.ts is the same for every site: read each result
// row, resolve its DOI (from the row, from a site-native id, or by title
// search), look the DOI up, and place one indicator panel per row. What
// differs per site is captured here: how to find rows, how to read them, and
// where the panel goes. See ./index.ts for how to add a site.

import type {DoiString} from "@shared/types";
import type {PlacementRule} from "@shared/site-adapters";

/** What one result row tells us before any network call. */
export interface RowExtraction {
    title: string;
    firstAuthor: string | null;
    year: number | null;
    /** The row's outbound link — a title-search tie-breaker for augmentation. */
    sourceUrl: string | null;
    /** DOI printed or linked in the row itself, if any. */
    doi: DoiString | null;
    /** True when `doi` came from a doi.org URL or an explicit DOI field and
     *  needs no further validation. */
    confident: boolean;
    /** Site-native record id (e.g. OpenAlex "W2142773606") that the adapter's
     *  resolveSiteIds can turn into a DOI in one batched call. */
    siteId?: string;
}

export interface SearchSiteAdapter {
    id: string;
    /** Human name for logs and the progress toast ("Reading 10 OpenAlex results…"). */
    label: string;
    /** Bare hostnames; subdomains and www. match too. */
    hostnames: string[];
    /** Selector for one result row. Rows are processed once and then marked. */
    resultRow: string;
    /** Stylesheet injected once per page: panel placement, sizing and any
     *  site-CSS overrides. Import the site's .css file (bundled as text). */
    css: string;
    /** Read a row. Return null to skip it (e.g. Scholar's [CITATION] entries). */
    extractRow(row: HTMLElement): RowExtraction | null;
    /** Where the panel goes, searched within the row; first match wins.
     *  Falls back to appending to the row when nothing matches. */
    panelPlacement: PlacementRule[];
    /** Optional hook run before placement, for rows that lack the target
     *  container (Scholar rows without a PDF column). */
    preparePanelTarget?(row: HTMLElement): void;
    /** Element that receives a retraction/concern notice for a row whose DOI
     *  turned out invalid (no panel exists to carry it). */
    noticeTarget(row: HTMLElement): HTMLElement | null;
    /** Batch-resolve site-native ids (RowExtraction.siteId) to DOIs. Ids the
     *  site has no DOI for map to null; ids missing from the map failed. */
    resolveSiteIds?(ids: string[]): Promise<Map<string, DoiString | null>>;
}
