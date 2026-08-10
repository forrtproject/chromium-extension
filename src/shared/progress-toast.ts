// Progress toast — the bottom-right indicator shown while ORE works a page.
// Stage-weighted, not item-counted: each stage is one batched worker call.

export const WORK_TOAST_ID = "flora-working-toast";

export type WorkStage = "scan" | "validate" | "augment" | "notices" | "lookup" | "report";

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

const DEFAULT_LABEL = "ORE is looking up the papers on this page…";

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

const TRACK_STYLE =
    "position:relative;overflow:hidden;height:3px;border-radius:2px;" +
    "background:rgba(255,255,255,0.25);";

const FILL_STYLE =
    "height:100%;width:0;border-radius:2px;background:#fff;" +
    "transition:width 0.25s ease;";

const KEYFRAMES =
    "@keyframes flora-work-spin{to{transform:rotate(360deg)}}" +
    "@keyframes flora-work-slide{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}";

// The DOM listener runs a pass per mutation; a cached one is over in millis.
const SHOW_DELAY_MS = 250;

let refCount = 0;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let removeTimer: ReturnType<typeof setTimeout> | null = null;
// 0 = nothing reported yet, and the bar runs indeterminate.
let progress = 0;
let labelText = DEFAULT_LABEL;
let suppressed = false;

function clearTimers(): void {
    for (const timer of [showTimer, hideTimer, removeTimer]) {
        if (timer) clearTimeout(timer);
    }
    showTimer = hideTimer = removeTimer = null;
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
    spinner.style.cssText = SPINNER_STYLE;
    const label = document.createElement("span");
    label.setAttribute("data-flora-work-label", "");
    label.textContent = DEFAULT_LABEL;
    row.append(spinner, label);

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

    host.append(style, row, track);
    document.body.appendChild(host);
    return host;
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
    if (suppressed || refCount === 0) return;
    const host = ensureToast();
    const label = host.querySelector<HTMLElement>("[data-flora-work-label]");
    if (label) label.textContent = labelText;
    paint(host);
    requestAnimationFrame(() => {
        host.style.opacity = "1";
        host.style.transform = "translateY(0)";
    });
}

/** Update now if the toast is already up, else once the pass proves slow. */
function render(): void {
    if (suppressed || refCount === 0) return;
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

/** Show the progress toast (ref-counted — nested calls keep it visible). */
export function beginWorkIndicator(): void {
    refCount++;
    // Also covers a pass starting while the last one's toast is still fading.
    if (refCount === 1) {
        progress = 0;
        labelText = DEFAULT_LABEL;
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
    render();
}

/** Hide the toast once all outstanding work has finished. */
export function endWorkIndicator(): void {
    refCount = Math.max(0, refCount - 1);
    if (refCount > 0) return;
    clearTimers(); // a pass that finished before the toast appeared stays silent
    const host = document.getElementById(WORK_TOAST_ID);
    if (!host) return;
    progress = 1;
    paint(host);
    // Brief delay so quick back-to-back passes don't flicker the toast.
    hideTimer = setTimeout(() => {
        host.style.opacity = "0";
        host.style.transform = "translateY(6px)";
        removeTimer = setTimeout(() => host.remove(), 200);
    }, 500);
}

/** Popup hid all FLoRA UI — stay quiet until it comes back. */
export function hideWorkIndicator(): void {
    suppressed = true;
    clearTimers();
    document.getElementById(WORK_TOAST_ID)?.remove();
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
    document.getElementById(WORK_TOAST_ID)?.remove();
}
