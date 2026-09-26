import {positionTabOnRightEdge} from "./tab-position";

export const PROGRESS_TAB_ID = "flora-progress-tab";
export const NOTHING_FOUND_ID = "flora-nothing-found";

const NOTHING_FOUND_MS = 5_000;
const FADE_MS = 300;

const PURPLE = "linear-gradient(180deg,#853953,#612D53)";
const GREY = "linear-gradient(180deg,#a8a2a6,#8f898d)";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

const PANEL_TAB_ENTER = "flora-tab-enter 0.5s cubic-bezier(0.34,1.4,0.64,1) forwards";
const PANEL_TAB_PULSE = "flora-tab-pulse 1.8s ease-in-out 0s 3";

const KEYFRAMES =
    "@keyframes flora-progress-tab-enter{0%{opacity:0;right:-28px}60%{opacity:1;right:4px}100%{opacity:1;right:0}}" +
    "@keyframes flora-progress-tab-spin{to{transform:rotate(360deg)}}";

const STANDALONE_STYLE =
    "all:unset;box-sizing:border-box;position:fixed;right:0;top:0;z-index:2147483647;" +
    "width:28px;padding:14px 0;border-radius:6px 0 0 6px;" +
    `background:${GREY};` +
    "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;" +
    "box-shadow:-2px 0 10px rgba(0,0,0,0.2);cursor:progress;pointer-events:auto;" +
    "transition:opacity 0.3s ease,right 0.3s cubic-bezier(0.4,0,0.2,1);" +
    "animation:flora-progress-tab-enter 0.5s cubic-bezier(0.34,1.4,0.64,1) forwards;";

const FILL_STYLE =
    "position:absolute;left:0;right:0;bottom:0;height:0;z-index:-1;pointer-events:none;" +
    `background:${PURPLE};border-radius:0 0 0 6px;` +
    "transition:height 0.45s cubic-bezier(0.4,0,0.2,1);";

const EDGE_STYLE =
    "position:absolute;left:0;right:0;bottom:0;height:2px;z-index:-1;pointer-events:none;" +
    "background:rgba(255,255,255,0.55);transition:bottom 0.45s cubic-bezier(0.4,0,0.2,1);";

const SPINNER_STYLE =
    "all:unset;display:block;box-sizing:border-box;width:11px;height:11px;border-radius:50%;" +
    "border:2px solid rgba(255,255,255,0.35);border-top-color:#fff;" +
    "animation:flora-progress-tab-spin 0.8s linear infinite;pointer-events:none;";

const NO_RESULTS_SVG =
    `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.8" ` +
    `stroke-linecap="round" aria-hidden="true" style="display:block;">` +
    `<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/><path d="M5.4 5.4l3.2 3.2M8.6 5.4l-3.2 3.2"/></svg>`;

let busy = false;
let workStarted = false;
let lastFraction = 0;
let lastLabel = "";
let panelTab: HTMLElement | null = null;
let nothingFoundCount: number | null = null;
let noteTimer: ReturnType<typeof setTimeout> | null = null;
const fadeTimers = new Set<ReturnType<typeof setTimeout>>();

function ensureKeyframes(): void {
    if (document.getElementById("flora-progress-tab-style")) return;
    const style = document.createElement("style");
    style.id = "flora-progress-tab-style";
    style.textContent = KEYFRAMES;
    (document.head ?? document.documentElement).appendChild(style);
}

function standalone(): HTMLElement | null {
    return document.getElementById(PROGRESS_TAB_ID);
}

function ensureStandalone(): HTMLElement {
    const existing = standalone();
    if (existing) return existing;
    ensureKeyframes();

    const tab = document.createElement("div");
    tab.id = PROGRESS_TAB_ID;
    tab.setAttribute("data-flora-ui", "");
    tab.setAttribute("data-flora-tab", "");
    tab.style.cssText = STANDALONE_STYLE;

    const grip = document.createElement("span");
    grip.style.cssText =
        "display:grid;grid-template-columns:repeat(2,3px);gap:2px;opacity:0.5;pointer-events:none;";
    for (let i = 0; i < 6; i++) {
        const dot = document.createElement("span");
        dot.style.cssText = "width:3px;height:3px;border-radius:50%;background:#fff;";
        grip.appendChild(dot);
    }

    const label = document.createElement("span");
    label.style.cssText =
        "color:#fff;font-size:10px;font-weight:700;letter-spacing:1.2px;" +
        "writing-mode:vertical-rl;text-orientation:mixed;transform:rotate(180deg);" +
        `font-family:${FONT};pointer-events:none;`;
    label.textContent = "FORRT ORE";

    tab.append(grip, label);
    document.body.appendChild(tab);
    positionTabOnRightEdge(tab);
    return tab;
}

function removeStandalone(): void {
    standalone()?.remove();
}

function paintBusy(tab: HTMLElement, fraction: number, label: string): void {
    if (!tab.hasAttribute("data-flora-tab-busy")) {
        tab.setAttribute("data-flora-tab-busy", "");
        tab.dataset.floraTabBackground = tab.style.background;
        tab.dataset.floraTabCursor = tab.style.cursor;
        tab.dataset.floraTabLabel = tab.getAttribute("aria-label") ?? "";
        tab.style.background = GREY;
        tab.style.cursor = "progress";
        tab.style.overflow = "hidden";
        tab.style.isolation = "isolate";

        const fill = document.createElement("span");
        fill.setAttribute("data-flora-tab-fill", "");
        fill.style.cssText = FILL_STYLE;
        const edge = document.createElement("span");
        edge.setAttribute("data-flora-tab-edge", "");
        edge.style.cssText = EDGE_STYLE;
        const spinner = document.createElement("span");
        spinner.setAttribute("data-flora-tab-spinner", "");
        spinner.style.cssText = SPINNER_STYLE;

        const arrow = tab.querySelector<HTMLElement>("[data-flora-tab-arrow]");
        if (arrow) arrow.style.display = "none";
        tab.prepend(fill, edge);
        tab.append(spinner);
        ensureKeyframes();
    }

    const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
    const fill = tab.querySelector<HTMLElement>("[data-flora-tab-fill]")!;
    const edge = tab.querySelector<HTMLElement>("[data-flora-tab-edge]")!;
    fill.style.height = `${percent}%`;
    fill.style.borderRadius = percent >= 100 ? "6px 0 0 6px" : "0 0 0 6px";
    edge.style.bottom = `${percent}%`;
    edge.style.display = percent > 0 && percent < 100 ? "" : "none";

    const spoken = percent > 0 ? `FORRT ORE is checking this page, ${percent}% done` : "FORRT ORE is checking this page";
    tab.title = label;
    tab.setAttribute("aria-label", spoken);
    if (tab === standalone()) {
        tab.setAttribute("role", "progressbar");
        tab.setAttribute("aria-valuemin", "0");
        tab.setAttribute("aria-valuemax", "100");
        if (percent > 0) tab.setAttribute("aria-valuenow", String(percent));
        else tab.removeAttribute("aria-valuenow");
    } else {
        tab.setAttribute("aria-disabled", "true");
    }
}

function clearBusy(tab: HTMLElement): void {
    if (!tab.hasAttribute("data-flora-tab-busy")) return;
    tab.removeAttribute("data-flora-tab-busy");
    for (const marker of ["fill", "edge", "spinner"]) tab.querySelector(`[data-flora-tab-${marker}]`)?.remove();
    const arrow = tab.querySelector<HTMLElement>("[data-flora-tab-arrow]");
    if (arrow) arrow.style.display = "";
    tab.style.background = tab.dataset.floraTabBackground ?? "";
    tab.style.cursor = tab.dataset.floraTabCursor ?? "";
    const label = tab.dataset.floraTabLabel;
    if (label) tab.setAttribute("aria-label", label);
    else tab.removeAttribute("aria-label");
    delete tab.dataset.floraTabBackground;
    delete tab.dataset.floraTabCursor;
    delete tab.dataset.floraTabLabel;
    tab.removeAttribute("title");
    tab.removeAttribute("aria-disabled");
    for (const attr of ["aria-valuemin", "aria-valuemax", "aria-valuenow"]) tab.removeAttribute(attr);
}

function pulse(tab: HTMLElement): void {
    if (tab.dataset.floraTabPulsed === "1") return;
    tab.dataset.floraTabPulsed = "1";
    tab.style.animation = "none";
    void tab.offsetWidth;
    tab.style.animation = PANEL_TAB_PULSE;
}

function showNoResults(tab: HTMLElement): void {
    clearBusy(tab);
    tab.style.background = PURPLE;
    tab.style.cursor = "default";
    tab.setAttribute("role", "img");
    tab.setAttribute("aria-label", "FORRT ORE found nothing to flag on this page");
    const icon = document.createElement("span");
    icon.setAttribute("data-flora-tab-no-results", "");
    icon.style.cssText = "display:block;pointer-events:none;";
    icon.innerHTML = NO_RESULTS_SVG;
    tab.append(icon);
}

function fadeOut(el: HTMLElement, slide: boolean): void {
    el.style.animation = "none";
    el.style.transition = "opacity 0.3s ease,right 0.3s cubic-bezier(0.4,0,0.2,1)";
    el.style.opacity = "0";
    if (slide) el.style.right = "-32px";
    const timer = setTimeout(() => {
        fadeTimers.delete(timer);
        el.remove();
    }, FADE_MS);
    fadeTimers.add(timer);
}

function removeNote(): void {
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = null;
    document.getElementById(NOTHING_FOUND_ID)?.remove();
}

function showNothingFound(tab: HTMLElement, papers: number, hideTab: boolean): void {
    removeNote();
    const note = document.createElement("div");
    note.id = NOTHING_FOUND_ID;
    note.setAttribute("data-flora-ui", "");
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");
    note.style.cssText =
        "all:unset;box-sizing:border-box;position:fixed;z-index:2147483647;width:250px;" +
        "display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:8px;" +
        "background:#2b2128;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,0.22);" +
        `font-family:${FONT};font-size:12px;line-height:1.4;pointer-events:none;` +
        "transition:opacity 0.3s ease;";

    const icon = document.createElement("span");
    icon.style.cssText = "flex-shrink:0;margin-top:1px;";
    icon.innerHTML = NO_RESULTS_SVG.replace('width="13" height="13"', 'width="16" height="16"');

    const text = document.createElement("span");
    text.style.cssText = "display:flex;flex-direction:column;gap:2px;";
    const title = document.createElement("strong");
    title.style.cssText = "font-size:13px;font-weight:600;color:#fff;";
    title.textContent = "Nothing found on this page";
    const body = document.createElement("span");
    body.style.cssText = "color:rgba(255,255,255,0.72);";
    body.textContent = `Checked ${papers} ${papers === 1 ? "paper" : "papers"}. No flags in the available results.`;
    text.append(title, body);

    const pointer = document.createElement("span");
    pointer.style.cssText =
        "position:absolute;right:-5px;top:50%;width:10px;height:10px;margin-top:-5px;" +
        "background:#2b2128;transform:rotate(45deg);";

    note.append(icon, text, pointer);
    document.body.appendChild(note);

    const rect = tab.getBoundingClientRect();
    note.style.right = `${Math.max(window.innerWidth - rect.left + 12, 40)}px`;
    note.style.top = `${Math.max(rect.top + rect.height / 2 - note.offsetHeight / 2, 8)}px`;

    noteTimer = setTimeout(() => {
        noteTimer = null;
        fadeOut(note, false);
        if (hideTab && tab.isConnected) fadeOut(tab, true);
    }, NOTHING_FOUND_MS);
}

export function markTabWorkStarted(): void {
    workStarted = true;
    if (busy) return;
    lastFraction = 0;
    lastLabel = "";
}

export function isTabProgressShown(): boolean {
    return busy;
}

export function showTabProgress(fraction: number, label: string): void {
    removeNote();
    const leftover = standalone();
    if (leftover?.hasAttribute("data-flora-tab-done")) leftover.remove();
    fraction = busy ? Math.max(fraction, lastFraction) : fraction;
    busy = true;
    lastFraction = fraction;
    lastLabel = label;
    if (panelTab?.isConnected) {
        removeStandalone();
        paintBusy(panelTab, fraction, label);
        return;
    }
    paintBusy(ensureStandalone(), fraction, label);
}

export function noteNothingFound(papers: number): void {
    nothingFoundCount = papers;
}

export function withdrawNothingFound(): void {
    nothingFoundCount = null;
    removeNote();
    const tab = standalone();
    if (tab?.hasAttribute("data-flora-tab-done")) tab.remove();
}

export function finishTabProgress(): void {
    busy = false;
    workStarted = false;
    const papers = nothingFoundCount;
    nothingFoundCount = null;

    if (panelTab?.isConnected) {
        removeStandalone();
        clearBusy(panelTab);
        pulse(panelTab);
        if (papers !== null) showNothingFound(panelTab, papers, false);
        return;
    }

    const tab = standalone();
    if (papers !== null) {
        const target = tab ?? ensureStandalone();
        target.setAttribute("data-flora-tab-done", "");
        showNoResults(target);
        showNothingFound(target, papers, true);
        return;
    }
    if (tab) {
        tab.setAttribute("data-flora-tab-done", "");
        fadeOut(tab, true);
    }
}

export function resetTabProgress(): void {
    busy = false;
    workStarted = false;
    nothingFoundCount = null;
    removeNote();
    removeStandalone();
    if (panelTab?.isConnected) clearBusy(panelTab);
}

export function adoptPanelTab(tab: HTMLElement): void {
    panelTab = tab;
    tab.setAttribute("data-flora-tab", "");
    if (!busy && !workStarted) {
        tab.dataset.floraTabPulsed = "1";
        return;
    }
    tab.style.animation = PANEL_TAB_ENTER;
    removeStandalone();
    paintBusy(tab, lastFraction, lastLabel);
}

export function releasePanelTab(): void {
    panelTab = null;
    if (busy) paintBusy(ensureStandalone(), lastFraction, lastLabel);
}

export function isTabBusy(tab: HTMLElement): boolean {
    return tab.hasAttribute("data-flora-tab-busy");
}

export function setTabLabel(tab: HTMLElement, label: string): void {
    if (isTabBusy(tab)) tab.dataset.floraTabLabel = label;
    else tab.setAttribute("aria-label", label);
}

export function _resetProgressTabForTesting(): void {
    resetTabProgress();
    for (const timer of fadeTimers) clearTimeout(timer);
    fadeTimers.clear();
    panelTab = null;
    lastFraction = 0;
    lastLabel = "";
    workStarted = false;
}
