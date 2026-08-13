// Every demo in the tour is the extension's own UI, built by the same
// functions the content scripts call. Nothing here redraws the interface by
// hand, so a change to a pill or a panel reaches the tour — and the docs
// screenshots taken from it — without anyone remembering to update a mock.

import {
    createIndicatorPanel,
    createIndicatorPill,
    DOI_LINK_SVG,
    PUBPEER_HUB_SVG,
} from "@shared/indicator-pill";
import {OA_UNLOCK_SVG} from "@shared/doi-label";
import {renderSheetsModal, renderSidePanel, removeSheetsModal, removeSidePanel} from "../content-general/injector";
import {noticePresentation} from "@shared/doi-retraction";
import type {
    DoiString, LookupState, ReplicationResult, RetractionResponse, DoiContext,
} from "@shared/types";
import type {OpenAccessStatus} from "@shared/openaccess";
import type {PubPeerFeedback} from "@shared/pubpeer-api";

const POWER_POSING = "10.1177/0956797610383437" as DoiString;
const EGO_DEPLETION = "10.1037/0022-3514.74.5.1252" as DoiString;
const RETRACTED = "10.1016/S0140-6736(20)31180-6" as DoiString;
const CONCERNED = "10.1073/pnas.1521072112" as DoiString;

const OA_AVAILABLE: OpenAccessStatus = {
    isOa: true,
    url: "https://example.org/power-posing.pdf",
    locations: [
        {url: "https://example.org/power-posing.pdf", label: "Publisher", version: "published", isPdf: true},
        {url: "https://osf.io/example", label: "OSF Preprints", version: "submitted", isPdf: false},
    ],
};

const OA_NONE: OpenAccessStatus = {isOa: false, url: null, locations: []};

// ──────────────────────────────────────────────
// Offline fixtures
//
// The tour renders the real components, which means the real lookups fire. A
// tour that reached the network would be slow, would differ run to run, and
// would produce non-reproducible docs screenshots — so every request the
// components make is answered from the table below instead.
// ──────────────────────────────────────────────

const PUBPEER_FIXTURES: Record<string, {comments: number; title: string}> = {
    [POWER_POSING]: {comments: 4, title: "Power Posing"},
    [EGO_DEPLETION]: {comments: 14, title: "Ego Depletion"},
    [RETRACTED]: {comments: 96, title: "Hydroxychloroquine and COVID-19"},
    [CONCERNED]: {comments: 7, title: "Estimating the reproducibility of psychological science"},
};

function pubpeerFeedback(doi: string): PubPeerFeedback | null {
    const fixture = PUBPEER_FIXTURES[doi];
    if (!fixture) return null;
    return {
        id: doi.toLowerCase(),
        title: fixture.title,
        total_comments: fixture.comments,
        total_peeriodical_comments: 0,
        last_commented_at: "2025-11-02",
        users: "",
        url: `https://pubpeer.com/publications/${doi}`,
    };
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {"Content-Type": "application/json"},
    });
}

/**
 * Stubs must be installed before the first component is built: the pill kicks
 * off its PubPeer lookup while it is being constructed, not when it is shown.
 */
export function installOfflineFixtures(): void {
    globalThis.fetch = (input: RequestInfo | URL): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

        if (url.includes("pubpeer.com")) {
            const feedbacks = Object.keys(PUBPEER_FIXTURES)
                .map(pubpeerFeedback)
                .filter((f): f is PubPeerFeedback => f !== null);
            return Promise.resolve(jsonResponse({status: "success", feedbacks}));
        }
        if (url.includes("crossref.org") || url.includes("doi.org")) {
            return Promise.resolve(new Response(
                "Carney, D. R., Cuddy, A. J. C., &amp; Yap, A. J. (2010). Power posing. " +
                "<i>Psychological Science</i>, <i>21</i>(10), 1363–1368.",
                {status: 200}
            ));
        }
        return Promise.resolve(jsonResponse({}));
    };

    // On file:// — how the docs screenshots are taken — there is no extension
    // context at all, and the caches read chrome.storage on construction.
    if (typeof chrome === "undefined" || !chrome.storage) {
        const empty = (): Promise<Record<string, unknown>> => Promise.resolve({});
        (globalThis as Record<string, unknown>).chrome = {
            storage: {
                local: {get: empty, set: () => Promise.resolve(), remove: () => Promise.resolve()},
                sync: {get: empty, set: () => Promise.resolve()},
                onChanged: {addListener: () => {}},
            },
            runtime: {sendMessage: () => Promise.resolve(undefined), lastError: null, id: "tour"},
        };
    }
}

// ──────────────────────────────────────────────
// Fixture state for the panel builders
// ──────────────────────────────────────────────

function replicationResult(
    doi: DoiString,
    stats: {replications?: number; reproductions?: number; originals?: number}
): ReplicationResult {
    return {
            doi,
            title: "Power Posing: Brief Nonverbal Displays Affect Neuroendocrine Levels",
            authors: [{sequence: "first", given: "Dana", family: "Carney"}],
            journal: "Psychological Science",
            year: 2010,
            record: {
                stats: {
                    n_replications_total: stats.replications ?? 0,
                    n_reproductions_total: stats.reproductions ?? 0,
                    n_originals_total: stats.originals ?? 0,
                },
                replications: [
                    {
                        doi: "10.1177/0956797614553946", type: "replication",
                        title: "Assessing the Robustness of Power Posing",
                        authors: [{sequence: "first", given: "Eva", family: "Ranehill"}],
                        journal: "Psychological Science", year: 2015, outcome: "failed",
                        outcome_quote: "We failed to confirm an effect on hormonal levels.",
                    },
                    {
                        doi: "10.1016/j.jesp.2017.02.004", type: "replication",
                        title: "Embodied Power and Risk Taking: A Registered Replication",
                        authors: [{sequence: "first", given: "Joseph", family: "Cesario"}],
                        journal: "J. Exp. Soc. Psychol.", year: 2017, outcome: "failed",
                        outcome_quote: "No evidence for the original effect.",
                    },
                ],
                reproductions: [
                    {
                        doi: "10.1080/01621459.2018.1497499", type: "reproduction",
                        title: "Reanalysis of the original power-posing data",
                        authors: [{sequence: "first", given: "Marcus", family: "Crede"}],
                        journal: "Journal of Statistics", year: 2019, outcome: "mixed",
                        outcome_quote: "Point estimates reproduce; inference does not.",
                    },
                ],
                originals: [],
            },
    } as unknown as ReplicationResult;
}

function matchedState(
    doi: DoiString,
    stats: {replications?: number; reproductions?: number; originals?: number}
): LookupState {
    return {status: "matched", source: "extracted", result: replicationResult(doi, stats)};
}

function notice(doi: DoiString, kind: RetractionResponse["kind"]): RetractionResponse {
    return {originDoi: doi, doi: `${doi}-notice`, kind};
}

// ──────────────────────────────────────────────
// Demo builders
// ──────────────────────────────────────────────

function scholarPanel(doi: DoiString, isAugmented: boolean): HTMLElement {
    return createIndicatorPanel({
        doi,
        isAugmented,
        oaStatus: Promise.resolve(isAugmented ? OA_NONE : OA_AVAILABLE),
        replicationsCount: isAugmented ? 7 : 3,
    });
}

function articlePill(doi: DoiString, options: {
    oa?: OpenAccessStatus;
    retraction?: RetractionResponse | null;
    replications?: number;
} = {}): HTMLElement {
    return createIndicatorPill({
        doi,
        oaStatus: Promise.resolve(options.oa ?? OA_AVAILABLE),
        retraction: options.retraction ?? null,
        replicationsCount: options.replications ?? null,
    });
}

/**
 * The pill opens its popover on hover against the real pointer. A tour has to
 * show the popover without one, so the demo pins it the way a click does.
 */
function pinnedPill(doi: DoiString): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "demo-pinned-pill";
    const pill = articlePill(doi, {replications: 3});
    wrap.appendChild(pill);
    const popover = pill.querySelector<HTMLElement>("[data-flora-popover]");
    if (popover) {
        popover.style.position = "static";
        popover.style.display = "flex";
        wrap.appendChild(popover);
    }
    return wrap;
}

function noticePill(kind: RetractionResponse["kind"]): HTMLElement {
    const {label, pillBackground, pillStroke, pillText, pillIconViewBox, pillIconColor, pillIconBody} =
        noticePresentation(kind);
    const pill = document.createElement("span");
    pill.className = "demo-notice-pill";
    pill.style.cssText =
        `display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:20px;` +
        `background:${pillBackground};border:1px solid ${pillStroke};color:${pillText};` +
        `font-size:12px;font-weight:600;font-family:var(--font-ui);`;
    pill.innerHTML =
        `<svg width="14" height="14" viewBox="${pillIconViewBox}" fill="${pillIconColor}" ` +
        `style="display:block;flex-shrink:0;">${pillIconBody}</svg><span>${label}</span>`;
    return pill;
}

// The legend's icons are the pill's own artwork, so a redrawn glyph reaches the
// explanation of it as well as the pill itself.
const LEGEND_GLYPHS: Record<string, string> = {
    doi: DOI_LINK_SVG,
    oa: OA_UNLOCK_SVG,
    pubpeer: PUBPEER_HUB_SVG,
    badge: `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;"></span>`,
};

function legendIcon(name: string): HTMLElement {
    const el = document.createElement("span");
    el.style.cssText = "display:inline-flex;align-items:center;justify-content:center;line-height:0;color:#fff;";
    el.innerHTML = LEGEND_GLYPHS[name] ?? "";
    return el;
}

/** The scanning indicator, drawn with the same mark the popup and panel use. */
function scanIndicator(): HTMLElement {
    const el = document.createElement("div");
    el.className = "demo-scan";
    el.innerHTML =
        `<span class="demo-scan-spinner"></span>` +
        `<span>ORE is looking up the papers on this page…</span>`;
    return el;
}

/**
 * Both the Sheets popup and the Meta Report pin themselves to the viewport and
 * mount on document.body. Inside a page-sized mock they have to be moved into
 * the frame and re-anchored to it.
 */
function reanchor(node: HTMLElement, frame: HTMLElement): void {
    frame.appendChild(node);
    for (const el of [node, ...node.querySelectorAll<HTMLElement>("*")]) {
        if (el.style.position === "fixed") el.style.position = "absolute";
        if (el.style.height === "100vh") el.style.height = "100%";
    }
}

function sheetsPopup(frame: HTMLElement): void {
    removeSheetsModal();
    renderSheetsModal(
        [{doi: POWER_POSING, result: replicationResult(POWER_POSING, {replications: 3, reproductions: 1})}],
        [notice(RETRACTED, "retraction"), notice(CONCERNED, "concern")]
    );
    const popup = document.getElementById("flora-sheets-modal");
    if (popup) reanchor(popup, frame);
}

function metaReport(frame: HTMLElement): void {
    removeSidePanel();

    // The panel falls back to the page's own <h1> for the article title, which
    // on the tour is the tour's heading. The meta tag it prefers wins instead.
    const meta = document.createElement("meta");
    meta.name = "citation_title";
    meta.content = "Power Posing: Brief Nonverbal Displays Affect Neuroendocrine Levels";
    document.head.appendChild(meta);

    const pageState = new Map<DoiString, LookupState>([
        [POWER_POSING, matchedState(POWER_POSING, {replications: 2, reproductions: 1})],
        [EGO_DEPLETION, matchedState(EGO_DEPLETION, {replications: 7})],
    ]);
    const doiContext = new Map<DoiString, DoiContext>([
        [POWER_POSING, "article"],
        [EGO_DEPLETION, "reference"],
    ]);
    const refFeedback = new Map<DoiString, PubPeerFeedback>();
    const egoFeedback = pubpeerFeedback(EGO_DEPLETION);
    if (egoFeedback) refFeedback.set(EGO_DEPLETION, egoFeedback);

    renderSidePanel(
        [],
        [
            {doi: EGO_DEPLETION, title: "Ego Depletion: Is the Active Self a Limited Resource?"},
            {doi: RETRACTED, title: "Hydroxychloroquine or chloroquine with or without a macrolide"},
        ],
        pageState,
        doiContext,
        refFeedback,
        [notice(RETRACTED, "retraction")]
    );

    meta.remove();

    const host = document.getElementById("flora-pubpeer-panel");
    if (!host) return;
    reanchor(host, frame);
    const panel = host.querySelector<HTMLElement>(".flora-sliding-panel");
    if (panel) {
        panel.style.transform = "translateX(0)";
        panel.style.width = "100%";
    }
    // The edge tab has nothing to open here — the panel is already shown.
    host.querySelector<HTMLElement>("button")?.style.setProperty("display", "none");
}

// ──────────────────────────────────────────────
// Mounting
// ──────────────────────────────────────────────

type DemoBuilder = (slot: HTMLElement) => void;

const DEMOS: Record<string, DemoBuilder> = {
    "scholar-panel": (slot) => slot.appendChild(scholarPanel(POWER_POSING, false)),
    "scholar-panel-searched": (slot) => slot.appendChild(scholarPanel(EGO_DEPLETION, true)),
    "article-pill": (slot) => slot.appendChild(articlePill(POWER_POSING, {replications: 3})),
    "pill-pinned": (slot) => slot.appendChild(pinnedPill(POWER_POSING)),
    "pill-no-signals": (slot) => slot.appendChild(articlePill(
        "10.1000/quiet.example" as DoiString, {oa: OA_NONE}
    )),
    "pill-retracted": (slot) => slot.appendChild(articlePill(RETRACTED, {
        retraction: notice(RETRACTED, "retraction"),
    })),
    "pill-concern": (slot) => slot.appendChild(articlePill(CONCERNED, {
        retraction: notice(CONCERNED, "concern"),
    })),
    "icon-doi": (slot) => slot.appendChild(legendIcon("doi")),
    "icon-oa": (slot) => slot.appendChild(legendIcon("oa")),
    "icon-pubpeer": (slot) => slot.appendChild(legendIcon("pubpeer")),
    "icon-badge": (slot) => slot.appendChild(legendIcon("badge")),
    "notice-pill-retraction": (slot) => slot.appendChild(noticePill("retraction")),
    "notice-pill-concern": (slot) => slot.appendChild(noticePill("concern")),
    "scan-indicator": (slot) => slot.appendChild(scanIndicator()),
    "sheets-popup": (slot) => sheetsPopup(slot),
    "meta-report": (slot) => metaReport(slot),
};

const mounted = new Set<string>();

/** Build the demos for one step, once. */
export function mountDemos(step: HTMLElement): void {
    for (const slot of step.querySelectorAll<HTMLElement>("[data-demo]")) {
        const name = slot.dataset.demo ?? "";
        const key = `${step.id}:${name}`;
        if (mounted.has(key)) continue;
        const build = DEMOS[name];
        if (!build) continue;
        mounted.add(key);
        build(slot);
    }
}
