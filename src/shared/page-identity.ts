/** A page as seen by the Navigation API: its URL and history-entry key. */
export interface PageEntry { href: string; key?: string }

const SHEETS_URL = /^https:\/\/docs\.google\.com\/spreadsheets\//;

/**
 * The href that identifies a page. A plain fragment (`#ref-12`, `#d=gs_cit`) is
 * an in-page position and is dropped. A route-like fragment (`#/…`, `#!…`) is a
 * hash-routed SPA page and is kept. On a Google Sheets spreadsheet the `gid`
 * fragment parameter names the open tab, so only that parameter is kept.
 */
export function pageUrl(href: string): string {
  const at = href.indexOf("#");
  if (at < 0) return href;
  const fragment = href.slice(at + 1);
  if (/^[/!]/.test(fragment)) return href;
  const base = href.slice(0, at);
  const gid = SHEETS_URL.test(base) ? new URLSearchParams(fragment).get("gid") : null;
  return gid === null ? base : `${base}#gid=${gid}`;
}

/** Read at call time: tests and pages may install `navigation` after import. */
export function currentPageEntry(): PageEntry {
  const navigation = (window as Window & {navigation?: {currentEntry?: {key: string}}}).navigation;
  return {href: location.href, key: navigation?.currentEntry?.key};
}

/**
 * A fragment-only URL change stays on the same page, whatever its entry key.
 * An identical URL with a new entry key is a same-URL SPA navigation: a new page.
 */
export function isSamePage(prev: PageEntry, next: PageEntry): boolean {
  if (pageUrl(prev.href) !== pageUrl(next.href)) return false;
  return prev.href !== next.href || prev.key === next.key;
}
