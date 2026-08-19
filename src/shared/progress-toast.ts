// Progress toast — the bottom-right indicator shown while ORE works a page.
// Stage-weighted, not item-counted: each stage is one batched worker call.
//
// Collapsed it is a spinner, a label and a bar. The chevron opens a panel with
// the stage checklist, the items of the running stage, and the controls that
// let a user silence ORE on this site. The panel is self-contained: inline
// styles only, so no page stylesheet can reach it.

import {debugLog, flushDebugLog, isDebugEnabled} from "@shared/debug";
import {buildDebugReport} from "@shared/debug-report";
import {writeClipboard} from "@shared/clipboard";
import {blockDomain, snoozeDomain} from "@shared/domains";

export const WORK_TOAST_ID = "flora-working-toast";

export type WorkStage = "scan" | "validate" | "augment" | "notices" | "lookup" | "report";

/** Ordered stages a pass is expected to run. */
export interface WorkPlan {
    stages: WorkStage[];
}

export type WorkItemStatus = "pending" | "done" | "flagged" | "skipped" | "failed";

export interface WorkItem {
    id: string;
    label: string;
    detail?: string;
    status: WorkItemStatus;
}

export function count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// validate/augment sit adjacent: Scholar runs them in order, articles at once.
const STAGE_PROGRESS: Record<WorkStage, number> = {
    scan: 0.08,
    validate: 0.25,
    augment: 0.4,
    notices: 0.55,
    lookup: 0.72,
    report: 0.9,
};

const STAGE_ORDER = Object.keys(STAGE_PROGRESS) as WorkStage[];

/** Shown for a stage that has not reported a detail of its own yet. */
const STAGE_LABEL: Record<WorkStage, string> = {
    scan: "Read the page",
    validate: "Check DOIs resolve",
    augment: "Find DOIs for references without one",
    notices: "Check for retractions",
    lookup: "Look up in FORRT / Retraction Watch / PubPeer",
    report: "Mark up results",
};

const DEFAULT_LABEL = "ORE is looking up the papers on this page…";
const FINISHED_LABEL = "Pass finished — log ready";

const HOST_STYLE =
    "position:fixed;bottom:18px;right:18px;z-index:2147483647;" +
    "display:flex;flex-direction:column;gap:7px;pointer-events:none;" +
    "background:linear-gradient(135deg,#853953,#612D53);color:#fff;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "font-size:12px;font-weight:500;padding:9px 12px;border-radius:8px;" +
    "min-width:220px;max-width:320px;box-sizing:border-box;" +
    "box-shadow:0 4px 16px rgba(0,0,0,0.18);" +
    "opacity:0;transform:translateY(6px);transition:opacity 0.18s ease,transform 0.18s ease;";

const SPINNER_STYLE =
    "width:12px;height:12px;border-radius:50%;flex-shrink:0;box-sizing:border-box;" +
    "border:2px solid rgba(255,255,255,0.35);border-top-color:#fff;" +
    "animation:flora-work-spin 0.7s linear infinite;";

const SMALL_SPINNER_STYLE =
    "display:inline-block;width:9px;height:9px;border-radius:50%;box-sizing:border-box;" +
    "border:1.5px solid rgba(255,255,255,0.35);border-top-color:#fff;" +
    "animation:flora-work-spin 0.7s linear infinite;";

const TRACK_STYLE =
    "position:relative;overflow:hidden;height:3px;border-radius:2px;" +
    "background:rgba(255,255,255,0.25);";

const FILL_STYLE =
    "height:100%;width:0;border-radius:2px;background:#fff;" +
    "transition:width 0.25s ease;";

const ICON_BUTTON_STYLE =
    "width:20px;height:20px;border:0;border-radius:5px;background:transparent;" +
    "color:rgba(255,255,255,0.85);cursor:pointer;display:inline-flex;" +
    "align-items:center;justify-content:center;padding:0;flex-shrink:0;pointer-events:auto;";

const TEXT_BUTTON_STYLE =
    "border:1px solid rgba(255,255,255,0.45);background:transparent;color:#fff;" +
    "font:inherit;font-size:11px;padding:3px 9px;border-radius:5px;cursor:pointer;" +
    "pointer-events:auto;white-space:nowrap;";

const MENU_STYLE =
    "display:none;flex-direction:column;gap:2px;margin-top:5px;padding:4px;" +
    "border-radius:6px;background:rgba(0,0,0,0.28);pointer-events:auto;";

const MENU_ITEM_STYLE =
    "border:0;background:transparent;color:#fff;font:inherit;font-size:11px;" +
    "text-align:left;padding:4px 7px;border-radius:4px;cursor:pointer;pointer-events:auto;";

const PANEL_STYLE =
    "display:none;flex-direction:column;gap:6px;padding-top:4px;margin-top:2px;" +
    "border-top:1px solid rgba(255,255,255,0.22);" +
    "max-height:min(60vh,420px);overflow-y:auto;pointer-events:auto;";

const CHEVRON_SVG =
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" ` +
    `style="width:12px;height:12px;display:block;transition:transform 0.18s ease;">` +
    `<path d="M3 10l5-5 5 5"/></svg>`;

const CLOSE_SVG =
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" ` +
    `style="width:12px;height:12px;display:block;"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;

const KEYFRAMES =
    "@keyframes flora-work-spin{to{transform:rotate(360deg)}}" +
    "@keyframes flora-work-slide{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}";

// The DOM listener runs a pass per mutation; a cached one is over in millis.
const SHOW_DELAY_MS = 250;
// Batch flush (800 ms) plus the store's persist debounce, so the report the
// copy renders includes the lines the pass wrote as it finished.
const COPY_LOG_WAIT_MS = 1500;
const BUTTON_FLASH_MS = 1500;
const MAX_ITEM_ROWS = 6;

interface StageRecord {
    stage: WorkStage;
    detail?: string;
    startedAt?: number;
    endedAt?: number;
    skipped?: boolean;
}

let refCount = 0;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let removeTimer: ReturnType<typeof setTimeout> | null = null;
// 0 = nothing reported yet, and the bar runs indeterminate.
let progress = 0;
let labelText = DEFAULT_LABEL;
let suppressed = false;
let dismissed = false;
let expanded = false;
let copyWhenFinished = false;
let finished = false;
let stages: StageRecord[] = [];
let currentStage: WorkStage | null = null;
let items: WorkItem[] = [];
let passStartedAt = 0;

function clearTimers(): void {
    for (const timer of [showTimer, hideTimer, removeTimer]) {
        if (timer) clearTimeout(timer);
    }
    showTimer = hideTimer = removeTimer = null;
}

function now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function planStages(plan?: WorkPlan): void {
    const wanted = plan?.stages?.length ? plan.stages : STAGE_ORDER;
    stages = wanted.map((stage) => ({stage}));
}

/** A nested pass adds the stages it plans that the outer one did not, in canonical order. */
function mergePlan(plan: WorkPlan): void {
    const present = new Set(stages.map((entry) => entry.stage));
    const missing = plan.stages.filter((stage) => !present.has(stage));
    if (!missing.length) return;
    const merged = new Set([...stages.map((entry) => entry.stage), ...missing]);
    const ordered = STAGE_ORDER.filter((stage) => merged.has(stage));
    stages = ordered.map((stage) => stages.find((entry) => entry.stage === stage) ?? {stage});
}

function stageRecord(stage: WorkStage): StageRecord {
    let record = stages.find((entry) => entry.stage === stage);
    if (!record) {
        record = {stage};
        stages.push(record);
    }
    return record;
}

function formatDuration(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function removeToast(): void {
    const host = document.getElementById(WORK_TOAST_ID);
    if (!host) return;
    document.removeEventListener("keydown", onKeydown, true);
    host.remove();
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !expanded) return;
    expanded = false;
    const host = document.getElementById(WORK_TOAST_ID);
    if (host) applyExpanded(host);
}

// ── DOM ─────────────────────────────────────────────────────────────────────

function iconButton(title: string, svg: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.style.cssText = ICON_BUTTON_STYLE;
    button.innerHTML = svg;
    return button;
}

function textButton(text: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.style.cssText = TEXT_BUTTON_STYLE;
    return button;
}

function menuItem(text: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.style.cssText = MENU_ITEM_STYLE;
    return button;
}

/** 6 am the next calendar day, in the user's own timezone. */
function msUntilTomorrow6am(): number {
    const target = new Date();
    target.setDate(target.getDate() + 1);
    target.setHours(6, 0, 0, 0);
    return Math.max(60_000, target.getTime() - Date.now());
}

function pauseSite(detail: {hostname: string; until?: number; blocked?: boolean}): void {
    document.dispatchEvent(new CustomEvent("flora-pause-site", {detail}));
    clearTimers();
    removeToast();
    dismissed = true;
}

function buildPauseMenu(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-flora-work-pause", "");
    wrap.style.cssText = "position:relative;pointer-events:auto;";

    const menu = document.createElement("div");
    menu.setAttribute("data-flora-work-pause-menu", "");
    menu.style.cssText = MENU_STYLE;

    const trigger = textButton("Pause on this site ▾");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", () => {
        const open = menu.style.display === "flex";
        menu.style.display = open ? "none" : "flex";
        trigger.setAttribute("aria-expanded", String(!open));
    });

    const hour = menuItem("Pause here for 1 hour");
    hour.addEventListener("click", () => {
        const hostname = location.hostname;
        void snoozeDomain(hostname, 60 * 60 * 1000);
        pauseSite({hostname, until: Date.now() + 60 * 60 * 1000});
    });

    const tomorrow = menuItem("Pause here until tomorrow");
    tomorrow.addEventListener("click", () => {
        const hostname = location.hostname;
        const duration = msUntilTomorrow6am();
        void snoozeDomain(hostname, duration);
        pauseSite({hostname, until: Date.now() + duration});
    });

    const block = menuItem("Block this site (undo in options)");
    block.addEventListener("click", () => {
        const hostname = location.hostname;
        void blockDomain(hostname);
        pauseSite({hostname, blocked: true});
    });

    menu.append(hour, tomorrow, block);
    wrap.append(trigger, menu);
    return wrap;
}

/** Flash the outcome on the button that started the copy. */
function flashButton(button: HTMLButtonElement, text: string): void {
    const original = button.textContent ?? "";
    button.textContent = text;
    setTimeout(() => {
        if (button.isConnected) button.textContent = original;
    }, BUTTON_FLASH_MS);
}

async function copyLog(button: HTMLButtonElement): Promise<boolean> {
    flushDebugLog();
    await new Promise((resolve) => setTimeout(resolve, COPY_LOG_WAIT_MS));
    let ok = false;
    try {
        const report = await buildDebugReport({pageUrl: location.href});
        ok = await writeClipboard(report.text);
    } catch {
        ok = false;
    }
    flashButton(button, ok ? "Copied ✓" : "Copy failed");
    return ok;
}

function buildFooter(): HTMLElement {
    const footer = document.createElement("div");
    footer.setAttribute("data-flora-work-footer", "");
    footer.style.cssText =
        "display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;" +
        "align-items:flex-start;padding-top:6px;";
    footer.append(buildPauseMenu());

    if (isDebugEnabled()) {
        const copy = textButton("Copy log");
        copy.setAttribute("data-flora-work-copy", "");
        copy.addEventListener("click", () => void copyLog(copy));

        const arm = textButton("Copy log when finished");
        arm.setAttribute("data-flora-work-arm", "");
        arm.addEventListener("click", () => {
            copyWhenFinished = !copyWhenFinished;
            arm.textContent = copyWhenFinished ? "Will copy when finished ✓" : "Copy log when finished";
        });

        footer.append(copy, arm);
    }
    return footer;
}

/** The row that stands in for the footer once an armed pass has finished. */
function buildFinishRow(): HTMLElement {
    const row = document.createElement("div");
    row.setAttribute("data-flora-work-finish", "");
    row.style.cssText = "display:none;justify-content:flex-end;gap:6px;";
    const copy = textButton("Copy log");
    copy.setAttribute("data-flora-work-final-copy", "");
    copy.addEventListener("click", () => {
        void copyLog(copy).then(() => {
            hideTimer = setTimeout(fadeOut, BUTTON_FLASH_MS);
        });
    });
    row.append(copy);
    return row;
}

function ensureToast(): HTMLElement {
    const existing = document.getElementById(WORK_TOAST_ID);
    if (existing) return existing;

    const host = document.createElement("div");
    host.id = WORK_TOAST_ID;
    // Marks it as FLoRA's own — the DOI extractor and DOM listener skip these.
    host.setAttribute("data-flora-ui", "");
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.style.cssText = HOST_STYLE;

    const style = document.createElement("style");
    style.textContent = KEYFRAMES;

    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;line-height:1.4;";
    const spinner = document.createElement("span");
    spinner.setAttribute("data-flora-work-spinner", "");
    spinner.style.cssText = SPINNER_STYLE;
    const label = document.createElement("span");
    label.setAttribute("data-flora-work-label", "");
    label.style.cssText = "flex:1;";
    label.textContent = labelText;

    const chevron = iconButton("Show details", CHEVRON_SVG);
    chevron.setAttribute("data-flora-work-chevron", "");
    chevron.setAttribute("aria-expanded", "false");
    chevron.addEventListener("click", () => {
        expanded = !expanded;
        applyExpanded(host);
    });

    const close = iconButton("Dismiss", CLOSE_SVG);
    close.setAttribute("data-flora-work-close", "");
    close.addEventListener("click", () => {
        dismissed = true;
        clearTimers();
        removeToast();
    });

    row.append(spinner, label, chevron, close);

    const track = document.createElement("div");
    track.setAttribute("data-flora-work-track", "");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.style.cssText = TRACK_STYLE;
    const fill = document.createElement("div");
    fill.setAttribute("data-flora-work-fill", "");
    fill.style.cssText = FILL_STYLE;
    track.appendChild(fill);

    const panel = document.createElement("div");
    panel.setAttribute("data-flora-work-panel", "");
    panel.style.cssText = PANEL_STYLE;
    const list = document.createElement("ul");
    list.setAttribute("data-flora-work-stages", "");
    list.style.cssText =
        "list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-weight:400;";
    panel.append(list, buildFooter());

    host.append(style, row, track, panel, buildFinishRow());
    document.body.appendChild(host);
    document.addEventListener("keydown", onKeydown, true);
    return host;
}

function applyExpanded(host: HTMLElement): void {
    const panel = host.querySelector<HTMLElement>("[data-flora-work-panel]");
    const chevron = host.querySelector<HTMLElement>("[data-flora-work-chevron]");
    const arrow = chevron?.querySelector<SVGElement>("svg");
    if (panel) panel.style.display = expanded ? "flex" : "none";
    if (chevron) {
        chevron.setAttribute("aria-expanded", String(expanded));
        chevron.title = expanded ? "Hide details" : "Show details";
    }
    if (arrow) arrow.style.transform = expanded ? "rotate(180deg)" : "rotate(0deg)";
    host.style.maxWidth = expanded && items.length ? "360px" : "320px";
    if (expanded) renderStages(host);
}

function itemGlyph(status: WorkItemStatus): HTMLElement {
    const glyph = document.createElement("span");
    glyph.style.cssText = "width:14px;flex-shrink:0;text-align:center;font-size:10px;";
    if (status === "pending") {
        const spinner = document.createElement("span");
        spinner.style.cssText = SMALL_SPINNER_STYLE;
        glyph.appendChild(spinner);
        return glyph;
    }
    if (status === "done") {
        glyph.textContent = "✓";
        glyph.style.color = "#b8f0c8";
    } else if (status === "flagged") {
        glyph.textContent = "!";
        glyph.style.color = "#ffd58a";
    } else if (status === "failed") {
        glyph.textContent = "✕";
        glyph.style.color = "#ffd58a";
    } else {
        glyph.textContent = "–";
        glyph.style.color = "rgba(255,255,255,0.55)";
    }
    return glyph;
}

function renderItems(): HTMLElement {
    const list = document.createElement("ul");
    list.setAttribute("data-flora-work-items", "");
    list.style.cssText =
        "list-style:none;margin:2px 0 0;padding:0 0 0 20px;font-weight:400;font-size:11px;";

    for (const item of items.slice(0, MAX_ITEM_ROWS)) {
        const row = document.createElement("li");
        row.setAttribute("data-flora-work-item", item.id);
        row.style.cssText = "display:flex;gap:7px;align-items:center;padding:2px 0;line-height:1.3;";
        const title = document.createElement("span");
        title.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        title.textContent = item.label;
        if (item.status === "skipped") title.style.color = "rgba(255,255,255,0.55)";
        row.append(itemGlyph(item.status), title);
        if (item.detail) {
            const detail = document.createElement("span");
            detail.style.cssText =
                "color:rgba(255,255,255,0.6);font-family:ui-monospace,Menlo,monospace;" +
                "font-size:10px;max-width:130px;overflow:hidden;text-overflow:ellipsis;" +
                "white-space:nowrap;flex-shrink:0;";
            detail.textContent = item.detail;
            row.append(detail);
        }
        list.append(row);
    }

    if (items.length > MAX_ITEM_ROWS) {
        const more = document.createElement("li");
        more.setAttribute("data-flora-work-more", "");
        more.style.cssText = "padding:2px 0 2px 21px;color:rgba(255,255,255,0.55);";
        more.textContent = `${items.length - MAX_ITEM_ROWS} more…`;
        list.append(more);
    }
    return list;
}

function renderStages(host: HTMLElement): void {
    const list = host.querySelector<HTMLElement>("[data-flora-work-stages]");
    if (!list) return;
    list.textContent = "";

    for (const record of stages) {
        const row = document.createElement("li");
        row.setAttribute("data-flora-work-stage", record.stage);
        row.style.cssText = "display:flex;gap:8px;align-items:flex-start;line-height:1.35;";

        const icon = document.createElement("span");
        icon.style.cssText =
            "width:12px;height:12px;flex-shrink:0;margin-top:2px;display:inline-flex;" +
            "align-items:center;justify-content:center;font-size:10px;";
        const text = document.createElement("span");
        text.style.cssText = "flex:1;";

        const isCurrent = record.stage === currentStage;
        if (isCurrent) {
            row.dataset.floraWorkState = "current";
            const spinner = document.createElement("span");
            spinner.style.cssText = SMALL_SPINNER_STYLE;
            icon.append(spinner);
            row.style.fontWeight = "600";
            text.textContent = record.detail ?? STAGE_LABEL[record.stage];
        } else if (record.endedAt !== undefined) {
            row.dataset.floraWorkState = "done";
            icon.textContent = "✓";
            row.style.color = "rgba(255,255,255,0.75)";
            text.textContent = record.detail ?? STAGE_LABEL[record.stage];
        } else if (record.skipped) {
            row.dataset.floraWorkState = "skipped";
            icon.textContent = "–";
            row.style.color = "rgba(255,255,255,0.5)";
            text.textContent = STAGE_LABEL[record.stage];
        } else {
            row.dataset.floraWorkState = "pending";
            icon.textContent = "○";
            row.style.color = "rgba(255,255,255,0.5)";
            text.textContent = STAGE_LABEL[record.stage];
        }

        row.append(icon, text);
        if (record.endedAt !== undefined && record.startedAt !== undefined) {
            const duration = document.createElement("span");
            duration.setAttribute("data-flora-work-duration", "");
            duration.style.cssText = "flex-shrink:0;color:rgba(255,255,255,0.6);font-size:11px;";
            duration.textContent = formatDuration(record.endedAt - record.startedAt);
            row.append(duration);
        }
        list.append(row);

        if (isCurrent && items.length) list.append(renderItems());
    }
}

function paint(host: HTMLElement): void {
    const track = host.querySelector<HTMLElement>("[data-flora-work-track]");
    const fill = host.querySelector<HTMLElement>("[data-flora-work-fill]");
    if (!track || !fill) return;

    if (progress <= 0) {
        fill.style.width = "40%";
        fill.style.animation = "flora-work-slide 1.1s ease-in-out infinite";
        track.removeAttribute("aria-valuenow");
        return;
    }
    const percent = Math.round(Math.min(progress, 1) * 100);
    fill.style.animation = "none";
    fill.style.transform = "translateX(0)";
    fill.style.width = `${percent}%`;
    track.setAttribute("aria-valuenow", String(percent));
}

function renderNow(): void {
    if (suppressed || dismissed) return;
    if (refCount === 0 && !finished) return;
    const host = ensureToast();
    const label = host.querySelector<HTMLElement>("[data-flora-work-label]");
    if (label) label.textContent = labelText;
    paint(host);
    applyExpanded(host);
    requestAnimationFrame(() => {
        host.style.opacity = "1";
        host.style.transform = "translateY(0)";
    });
}

/** Update now if the toast is already up, else once the pass proves slow. */
function render(): void {
    if (suppressed || dismissed) return;
    if (refCount === 0 && !finished) return;
    if (document.getElementById(WORK_TOAST_ID)) {
        renderNow();
        return;
    }
    if (showTimer) return;
    showTimer = setTimeout(() => {
        showTimer = null;
        renderNow();
    }, SHOW_DELAY_MS);
}

function fadeOut(): void {
    const host = document.getElementById(WORK_TOAST_ID);
    if (!host) return;
    host.style.opacity = "0";
    host.style.transform = "translateY(6px)";
    removeTimer = setTimeout(removeToast, 200);
}

// ── API ─────────────────────────────────────────────────────────────────────

/** Show the progress toast (ref-counted — nested calls keep it visible). */
export function beginWorkIndicator(plan?: WorkPlan): void {
    refCount++;
    // Also covers a pass starting while the last one's toast is still fading.
    if (refCount === 1) {
        // The finished-pass toast holds a copy button, so it is rebuilt whole.
        if (finished) removeToast();
        progress = 0;
        labelText = DEFAULT_LABEL;
        dismissed = false;
        expanded = false;
        finished = false;
        copyWhenFinished = false;
        currentStage = null;
        items = [];
        passStartedAt = now();
        planStages(plan);
    } else if (plan) {
        mergePlan(plan);
    }
    if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }
    if (removeTimer) {
        clearTimeout(removeTimer);
        removeTimer = null;
    }
    render();
}

/** The bar only moves forward — stages overlap, and a late one must not rewind it. */
export function reportWorkStage(stage: WorkStage, detail: string): void {
    if (refCount === 0) return; // no pass in flight — a late straggler
    progress = Math.max(progress, STAGE_PROGRESS[stage]);
    labelText = detail;

    const record = stageRecord(stage);
    if (currentStage === stage) {
        record.detail = detail;
        render();
        return;
    }

    const previous = currentStage ? stages.find((entry) => entry.stage === currentStage) : undefined;
    if (previous && previous.startedAt !== undefined && previous.endedAt === undefined) {
        previous.endedAt = now();
        debugLog(`Work: ${previous.stage} done in ${Math.round(previous.endedAt - previous.startedAt)} ms`);
    }

    // Anything planned ahead of this stage that never reported is not coming.
    for (const entry of stages) {
        if (entry.stage === stage) break;
        if (entry.startedAt === undefined) entry.skipped = true;
    }

    record.detail = detail;
    record.skipped = false;
    record.endedAt = undefined;
    if (record.startedAt === undefined) record.startedAt = now();
    currentStage = stage;
    items = [];
    debugLog(`Work: ${stage} started — ${detail}`);
    render();
}

/** Replace the item list shown under the current stage. `[]` clears it. */
export function setWorkItems(itemList: WorkItem[]): void {
    items = itemList.slice();
    render();
}

/** Update one item's status (and optionally its detail); unknown id is a no-op. */
export function updateWorkItem(id: string, status: WorkItemStatus, detail?: string): void {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    item.status = status;
    if (detail !== undefined) item.detail = detail;
    render();
}

/** True once the user dismissed this pass's toast. Cleared when the pass ends. */
export function isWorkDismissed(): boolean {
    return dismissed;
}

/** Hide the toast once all outstanding work has finished. */
export function endWorkIndicator(): void {
    refCount = Math.max(0, refCount - 1);
    if (refCount > 0) return;

    const ending = currentStage ? stages.find((entry) => entry.stage === currentStage) : undefined;
    if (ending && ending.startedAt !== undefined && ending.endedAt === undefined) {
        ending.endedAt = now();
    }
    currentStage = null;
    const breakdown = stages
        .filter((entry) => entry.startedAt !== undefined && entry.endedAt !== undefined)
        .map((entry) => `${entry.stage}: ${Math.round((entry.endedAt as number) - (entry.startedAt as number))} ms`)
        .join(", ");
    debugLog(`Work: pass done in ${Math.round(now() - passStartedAt)} ms (${breakdown})`);

    clearTimers(); // a pass that finished before the toast appeared stays silent
    const wasDismissed = dismissed;
    dismissed = false;

    if (copyWhenFinished && !wasDismissed) {
        finished = true;
        progress = 1;
        labelText = FINISHED_LABEL;
        const host = ensureToast();
        host.querySelector<HTMLElement>("[data-flora-work-spinner]")?.style.setProperty("display", "none");
        host.querySelector<HTMLElement>("[data-flora-work-chevron]")?.style.setProperty("display", "none");
        expanded = false;
        renderNow();
        const finishRow = host.querySelector<HTMLElement>("[data-flora-work-finish]");
        if (finishRow) finishRow.style.display = "flex";
        return;
    }

    const host = document.getElementById(WORK_TOAST_ID);
    if (!host) return;
    progress = 1;
    paint(host);
    // Brief delay so quick back-to-back passes don't flicker the toast.
    hideTimer = setTimeout(fadeOut, 500);
}

/** Popup hid all FLoRA UI — stay quiet until it comes back. */
export function hideWorkIndicator(): void {
    suppressed = true;
    clearTimers();
    removeToast();
}

/** Popup restored FLoRA UI — back if a pass is still running. */
export function showWorkIndicator(): void {
    suppressed = false;
    renderNow();
}

/** Test-only: drop toast state so each case starts fresh. */
export function _resetWorkIndicatorForTesting(): void {
    clearTimers();
    refCount = 0;
    progress = 0;
    labelText = DEFAULT_LABEL;
    suppressed = false;
    dismissed = false;
    expanded = false;
    finished = false;
    copyWhenFinished = false;
    stages = [];
    currentStage = null;
    items = [];
    passStartedAt = 0;
    removeToast();
}
