import {INDICATOR_PILL_CLASS, pinIndicatorPopover} from "@shared/indicator-pill";
import {FLORA_NOTICE_PILL_CLASS} from "@shared/doi-label";
import {REFERENCE_ENTRY_ATTR} from "@shared/flora-ui";
import {waitForWorkToFinish} from "@shared/progress-toast";
import {debugWarn} from "@shared/debug";

export type TourSurface = "article" | "search";

export interface TourStop {
    target: HTMLElement;
    title: string;
    text: string;
    enter?: () => void;
    leave?: () => void;
}

export const TOUR_SEEN_KEY = "flora_page_tour_seen";
const TOUR_HOST_ID = "flora-page-tour";
const FIRST_TOUR_DELAY_MS = 800;
const SPOTLIGHT_PAD = 6;
const CARD_GAP = 12;
const VIEWPORT_MARGIN = 12;

const PILL = `.${INDICATOR_PILL_CLASS}`;
const PILL_FACE_TEXT = "Each part answers one question: its DOI, a free copy (OA), discussion on PubPeer, and replications (Reps). A coloured part means yes; a faded one means nothing was found.";
const REFERENCE_PILL_TEXT = "A reference that cites two papers gets two pills. No pill means ORE could not identify that reference.";

function shown(el: Element | null): el is HTMLElement {
    if (!(el instanceof HTMLElement) || !el.isConnected) return false;
    return el.checkVisibility?.() ?? true;
}

function firstShown(selector: string, exclude?: (el: HTMLElement) => boolean): HTMLElement | null {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        if (shown(el) && !exclude?.(el)) return el;
    }
    return null;
}

function noticeStop(): TourStop | null {
    const segment = firstShown(`${PILL} [data-flora-notice-segment], ${PILL} [data-flora-notice-row]`);
    const target = segment?.closest<HTMLElement>(PILL) ?? firstShown(`.${FLORA_NOTICE_PILL_CLASS}`);
    if (!target) return null;
    const retracted = /retract/i.test((segment ?? target).textContent ?? "");
    return {
        target,
        title: retracted ? "This paper has been retracted" : "This paper has an expression of concern",
        text: retracted
            ? "It was withdrawn, usually because of serious errors or misconduct. Open the warning to read the journal's notice."
            : "The journal has flagged a problem that is not yet resolved. Open the warning to read the journal's notice.",
    };
}

function popoverStop(wrapper: HTMLElement): TourStop | null {
    const popover = wrapper.querySelector<HTMLElement>("[data-flora-popover]");
    if (!popover) return null;
    return {
        target: popover,
        title: "Point at a pill to see the details",
        text: "Each row is a link: copy the reference, open a free copy, read the discussion, or see the replications. Click a pill to keep it open.",
        enter: () => pinIndicatorPopover(wrapper, true),
        leave: () => pinIndicatorPopover(wrapper, false),
    };
}

export function articleTourStops(): TourStop[] {
    const stops: TourStop[] = [];
    const titlePill = firstShown(`${PILL}[data-flora-title-pill]`);
    const referencePill = firstShown(`[${REFERENCE_ENTRY_ATTR}] ${PILL}`);
    const loosePill = firstShown(`${PILL}[data-flora-loose-pill]`);
    const sample = titlePill ?? referencePill ?? loosePill;
    if (sample === titlePill && titlePill) {
        stops.push({target: titlePill, title: "This pill is about the article you are reading", text: PILL_FACE_TEXT});
    } else if (sample === referencePill && referencePill) {
        stops.push({target: referencePill, title: "Every paper in the reference list gets a pill", text: `${PILL_FACE_TEXT} ${REFERENCE_PILL_TEXT}`});
    } else if (sample) {
        stops.push({target: sample, title: "A pill marks a paper ORE recognised", text: PILL_FACE_TEXT});
    }
    const popover = sample ? popoverStop(sample) : null;
    if (popover) stops.push(popover);
    if (referencePill && referencePill !== sample) {
        stops.push({target: referencePill, title: "Every paper in the reference list gets one", text: REFERENCE_PILL_TEXT});
    }
    if (loosePill && loosePill !== sample) {
        stops.push({
            target: loosePill,
            title: "So does a DOI mentioned in the text",
            text: "Papers named outside the reference list are checked the same way.",
        });
    }
    const notice = noticeStop();
    if (notice) stops.push(notice);
    const tab = firstShown("[data-flora-panel-tab]");
    if (tab) {
        stops.push({
            target: tab,
            title: "Everything in one place",
            text: "This tab opens the Meta Report: the article's replications, any retraction, its discussion, and which references have something to report.",
        });
    }
    return stops;
}

export function searchTourStops(): TourStop[] {
    const stops: TourStop[] = [];
    const panel = firstShown(`${PILL}[data-flora-panel]`);
    const pill = panel ?? firstShown(PILL);
    if (pill) {
        stops.push({
            target: pill,
            title: panel ? "ORE adds this panel to each result" : "ORE adds this pill to each result",
            text: "Each row is one check: the paper's DOI, a free copy, discussion on PubPeer, and replications. Every row is also a link.",
        });
    }
    const matched = firstShown(`${PILL}[data-flora-augmented]`);
    if (matched) {
        stops.push({
            target: matched,
            title: "A dotted DOI was matched by title",
            text: "This result showed no DOI, so ORE looked its title up. Open the DOI once to check it is the right paper.",
        });
    }
    const notice = noticeStop();
    if (notice) stops.push(notice);
    return stops;
}

const STYLES = `
  :host { all: initial; }
  .spotlight {
    position: fixed; border-radius: 10px; pointer-events: none;
    box-shadow: 0 0 0 9999px rgba(17, 24, 39, 0.45), 0 0 0 2px #853953;
    transition: top .18s ease, left .18s ease, width .18s ease, height .18s ease;
  }
  .card {
    position: fixed; width: min(320px, calc(100vw - 24px)); box-sizing: border-box;
    background: #fff; color: #1f2328; border-radius: 12px; padding: 14px 16px 12px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22); pointer-events: auto;
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .step { font-size: 11px; font-weight: 600; color: #853953; letter-spacing: .3px; text-transform: uppercase; }
  h2 { margin: 4px 0 6px; font-size: 15px; line-height: 1.3; font-weight: 650; color: #1f2328; }
  p { margin: 0; color: #444c56; }
  .foot { margin-top: 8px; font-size: 11px; color: #6e7781; }
  .actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  button {
    font: inherit; font-size: 12.5px; border-radius: 7px; padding: 6px 12px; cursor: pointer;
    border: 1px solid #d0d7de; background: #fff; color: #1f2328;
  }
  button:focus-visible { outline: 2px solid #853953; outline-offset: 2px; }
  button[disabled] { opacity: .45; cursor: default; }
  .skip { border: 0; background: none; color: #6e7781; padding: 6px 4px; margin-right: auto; }
  .next { background: #853953; border-color: #853953; color: #fff; font-weight: 600; }
  @media (prefers-reduced-motion: reduce) { .spotlight { transition: none; } }
`;

interface OpenTour {
    close: () => void;
}

let openTour: OpenTour | null = null;

export function isPageTourOpen(): boolean {
    return openTour !== null;
}

export function closePageTour(): void {
    openTour?.close();
}

function toTopLayer(host: HTMLElement): void {
    if (typeof host.showPopover !== "function") return;
    try {
        if (host.matches(":popover-open")) host.hidePopover();
        host.showPopover();
    } catch {}
}

export function runPageTour(stops: TourStop[]): boolean {
    if (stops.length === 0) return false;
    closePageTour();

    const host = document.createElement("div");
    host.id = TOUR_HOST_ID;
    host.setAttribute("data-flora-ui", "");
    if (typeof host.showPopover === "function") host.setAttribute("popover", "manual");
    host.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647;";
    const root = host.attachShadow({mode: "open"});
    root.innerHTML = `<style>${STYLES}</style>
      <div class="spotlight"></div>
      <div class="card" role="dialog" aria-modal="false" aria-labelledby="flora-tour-title" aria-describedby="flora-tour-text">
        <div class="step"></div>
        <h2 id="flora-tour-title"></h2>
        <p id="flora-tour-text"></p>
        <div class="foot" hidden>See this again any time from the ORE button in your browser toolbar.</div>
        <div class="actions">
          <button type="button" class="skip">Skip tour</button>
          <button type="button" class="back">Back</button>
          <button type="button" class="next">Next</button>
        </div>
      </div>`;
    const spotlight = root.querySelector<HTMLElement>(".spotlight")!;
    const card = root.querySelector<HTMLElement>(".card")!;
    const stepLabel = root.querySelector<HTMLElement>(".step")!;
    const title = root.querySelector<HTMLElement>("h2")!;
    const text = root.querySelector<HTMLElement>("p")!;
    const foot = root.querySelector<HTMLElement>(".foot")!;
    const back = root.querySelector<HTMLButtonElement>(".back")!;
    const next = root.querySelector<HTMLButtonElement>(".next")!;
    document.documentElement.appendChild(host);

    let index = -1;
    let frame = 0;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const place = (): void => {
        const stop = stops[index];
        if (!stop) return;
        const rect = stop.target.getBoundingClientRect();
        spotlight.style.top = `${rect.top - SPOTLIGHT_PAD}px`;
        spotlight.style.left = `${rect.left - SPOTLIGHT_PAD}px`;
        spotlight.style.width = `${rect.width + SPOTLIGHT_PAD * 2}px`;
        spotlight.style.height = `${rect.height + SPOTLIGHT_PAD * 2}px`;
        const cardRect = card.getBoundingClientRect();
        const below = rect.bottom + SPOTLIGHT_PAD + CARD_GAP;
        const above = rect.top - SPOTLIGHT_PAD - CARD_GAP - cardRect.height;
        const top = below + cardRect.height <= window.innerHeight - VIEWPORT_MARGIN || above < VIEWPORT_MARGIN ? below : above;
        const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), window.innerWidth - cardRect.width - VIEWPORT_MARGIN);
        card.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - cardRect.height - VIEWPORT_MARGIN))}px`;
        card.style.left = `${Math.max(VIEWPORT_MARGIN, left)}px`;
    };
    const follow = (): void => {
        place();
        frame = requestAnimationFrame(follow);
    };

    const show = (to: number): void => {
        stops[index]?.leave?.();
        index = to;
        const stop = stops[index];
        stop.enter?.();
        toTopLayer(host);
        stepLabel.textContent = `${index + 1} of ${stops.length}`;
        title.textContent = stop.title;
        text.textContent = stop.text;
        const last = index === stops.length - 1;
        foot.hidden = !last;
        back.disabled = index === 0;
        next.textContent = last ? "Done" : "Next";
        stop.target.scrollIntoView({block: "center", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth"});
        place();
        next.focus({preventScroll: true});
    };

    const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
            event.stopPropagation();
            close();
        }
    };
    const close = (): void => {
        if (openTour !== tour) return;
        openTour = null;
        cancelAnimationFrame(frame);
        stops[index]?.leave?.();
        document.removeEventListener("keydown", onKey, true);
        host.remove();
    };
    const tour: OpenTour = {close};
    openTour = tour;

    root.querySelector(".skip")!.addEventListener("click", close);
    back.addEventListener("click", () => { if (index > 0) show(index - 1); });
    next.addEventListener("click", () => { if (index < stops.length - 1) show(index + 1); else close(); });
    document.addEventListener("keydown", onKey, true);

    show(0);
    frame = requestAnimationFrame(follow);
    return true;
}

const stopsFor = (surface: TourSurface): TourStop[] => surface === "article" ? articleTourStops() : searchTourStops();

export function startPageTour(surface: TourSurface): boolean {
    return runPageTour(stopsFor(surface));
}

const offered = new Set<TourSurface>();

async function hasSeenTour(surface: TourSurface): Promise<boolean> {
    const stored = await chrome.storage.local.get(TOUR_SEEN_KEY);
    const seen = stored[TOUR_SEEN_KEY] as Partial<Record<TourSurface, boolean>> | undefined;
    return seen?.[surface] === true;
}

async function markTourSeen(surface: TourSurface): Promise<void> {
    const stored = await chrome.storage.local.get(TOUR_SEEN_KEY);
    const seen = (stored[TOUR_SEEN_KEY] as Partial<Record<TourSurface, boolean>> | undefined) ?? {};
    await chrome.storage.local.set({[TOUR_SEEN_KEY]: {...seen, [surface]: true}});
}

/** Run the tour once, the first time ORE has something to show on this kind of page. */
export async function offerFirstPageTour(surface: TourSurface, canShow: () => boolean): Promise<void> {
    if (offered.has(surface) || openTour) return;
    offered.add(surface);
    try {
        if (await hasSeenTour(surface)) return;
        await waitForWorkToFinish();
        await new Promise((resolve) => setTimeout(resolve, FIRST_TOUR_DELAY_MS));
        if (!canShow() || document.hidden || openTour) {
            offered.delete(surface);
            return;
        }
        const stops = stopsFor(surface);
        if (stops.length === 0) {
            offered.delete(surface);
            return;
        }
        await markTourSeen(surface);
        runPageTour(stops);
    } catch (err) {
        offered.delete(surface);
        debugWarn("Page tour: first-run check failed —", err);
    }
}
