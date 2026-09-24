const TAB_STORAGE_KEY = "flora_tab_top_v1";
const RIGHT_EDGE_SWEEP_MIN_INTERVAL_MS = 750;

// null = never set by user; number = user-dragged position in px from top
let customTabTop: number | null = (() => {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY)?.trim();
    const top = v ? Number(v) : NaN;
    return Number.isFinite(top) ? top : null;
  } catch { return null; }
})();

let lastSweep = { at: 0, vw: 0, vh: 0, h: 0, top: "" };

export function hasCustomTabTop(): boolean {
  return customTabTop !== null;
}

export function saveCustomTabTop(top: number): void {
  customTabTop = top;
  localStorage.setItem(TAB_STORAGE_KEY, String(top));
}

export function positionTabOnRightEdge(tab: HTMLElement): void {
  if (customTabTop !== null) {
    const clamped = Math.max(0, Math.min(window.innerHeight - (tab.offsetHeight || 80), customTabTop));
    tab.style.top = `${Math.round(clamped)}px`;
    return;
  }

  const now = Date.now();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const TAB_H = tab.offsetHeight || 80;
  if (
    lastSweep.top !== "" &&
    now - lastSweep.at < RIGHT_EDGE_SWEEP_MIN_INTERVAL_MS &&
    lastSweep.vw === vw &&
    lastSweep.vh === vh &&
    Math.abs(lastSweep.h - TAB_H) <= 4
  ) {
    tab.style.top = lastSweep.top;
    return;
  }

  const MARGIN = 16;

  // Collect occupied vertical ranges from ALL elements near the right edge.
  // Use getBoundingClientRect so we catch fixed/sticky/absolute inside fixed containers.
  const occupied: Array<[number, number]> = [];
  for (const el of document.querySelectorAll<HTMLElement>("*")) {
    if (el === tab || tab.contains(el) || el.contains(tab)) continue;
    if (el.closest("[data-flora-tab]")) continue;
    const rect = el.getBoundingClientRect();
    // Element must touch the right edge (right side within 8px of viewport right)
    if (rect.right < vw - 8) continue;
    // Must have real size and be visible in the viewport
    if (rect.width < 4 || rect.height < 4) continue;
    if (rect.bottom < 0 || rect.top > vh) continue;
    // Only count elements that are actually rendered (not hidden)
    const cs = window.getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    occupied.push([rect.top, rect.bottom]);
  }

  occupied.sort((a, b) => a[0] - b[0]);

  // Merge overlapping/adjacent intervals
  const merged: Array<[number, number]> = [];
  for (const [t, b] of occupied) {
    if (merged.length && t <= merged[merged.length - 1][1] + MARGIN) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b);
    } else {
      merged.push([t, b]);
    }
  }

  // Find free vertical gaps
  const gaps: Array<[number, number]> = [];
  let prev = 0;
  for (const [t, b] of merged) {
    if (t - prev >= TAB_H + 2 * MARGIN) gaps.push([prev, t]);
    prev = b;
  }
  if (vh - prev >= TAB_H + 2 * MARGIN) gaps.push([prev, vh]);

  const center = vh / 2;
  let bestTop = center - TAB_H / 2;

  if (gaps.length > 0) {
    gaps.sort((a, b) => Math.abs((a[0] + a[1]) / 2 - center) - Math.abs((b[0] + b[1]) / 2 - center));
    const [gs, ge] = gaps[0];
    bestTop = Math.max(gs + MARGIN, Math.min(center - TAB_H / 2, ge - TAB_H - MARGIN));
  }

  const top = `${Math.round(bestTop)}px`;
  tab.style.top = top;
  lastSweep = { at: Date.now(), vw, vh, h: TAB_H, top };
}
