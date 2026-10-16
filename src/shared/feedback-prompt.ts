import {debugLog, debugWarn} from "./debug";
import {isPageTourOpen} from "./page-tour";

export const FEEDBACK_URL =
    "https://github.com/forrtproject/chromium-extension/issues/new?labels=feedback&title=Feedback%3A%20";

const FEEDBACK_STATE_KEY = "flora_feedback_prompt";
const FEEDBACK_HOST_ID = "flora-feedback-prompt";
const MIN_PAGES_BEFORE_ASKING = 3;
const ASK_CHANCE = 0.25;
const MIN_DELAY_MS = 8_000;
const MAX_DELAY_MS = 30_000;

interface FeedbackState {
    shown: boolean;
    pages: number;
}

let offeredOnThisPage = false;

async function readState(): Promise<FeedbackState> {
    const raw = await chrome.storage.local.get(FEEDBACK_STATE_KEY);
    const stored = raw[FEEDBACK_STATE_KEY] as Partial<FeedbackState> | undefined;
    return {shown: stored?.shown === true, pages: typeof stored?.pages === "number" ? stored.pages : 0};
}

function buildPrompt(close: () => void): HTMLElement {
    const host = document.createElement("div");
    host.id = FEEDBACK_HOST_ID;
    host.setAttribute("data-flora-ui", "");
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-labelledby", "flora-feedback-title");
    host.style.cssText =
        "all:initial;position:fixed;left:18px;bottom:18px;z-index:2147483647;box-sizing:border-box;" +
        "width:300px;max-width:calc(100vw - 36px);background:#fff;border-radius:10px;overflow:hidden;" +
        "box-shadow:0 8px 28px rgba(0,0,0,0.22);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
        "opacity:0;transform:translateY(8px);transition:opacity 0.2s ease,transform 0.2s ease;";

    const header = document.createElement("div");
    header.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(135deg,#853953,#612D53);";
    const badge = document.createElement("span");
    badge.style.cssText = "color:#fff;font-weight:700;font-size:11px;background:rgba(255,255,255,0.2);padding:2px 7px;border-radius:5px;";
    badge.textContent = "FORRT ORE";
    const title = document.createElement("span");
    title.id = "flora-feedback-title";
    title.style.cssText = "flex:1;color:#fff;font-size:13px;font-weight:600;";
    title.textContent = "How is ORE working for you?";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Close");
    dismiss.textContent = "×";
    dismiss.style.cssText =
        "all:unset;cursor:pointer;color:rgba(255,255,255,0.85);font-size:18px;line-height:1;padding:0 4px;border-radius:4px;";
    dismiss.addEventListener("click", close);
    header.append(badge, title, dismiss);

    const body = document.createElement("div");
    body.style.cssText = "padding:12px;font-size:13px;line-height:1.5;color:#3c4043;";
    body.textContent = "A minute of feedback on what works and what doesn't helps us improve ORE.";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;padding:0 12px 12px;";
    const later = document.createElement("button");
    later.type = "button";
    later.textContent = "No thanks";
    later.style.cssText =
        "all:unset;cursor:pointer;font-size:12px;font-weight:600;color:#5f6368;padding:6px 10px;border-radius:6px;";
    later.addEventListener("click", close);
    const give = document.createElement("a");
    give.href = FEEDBACK_URL;
    give.target = "_blank";
    give.rel = "noopener noreferrer";
    give.textContent = "Give feedback";
    give.style.cssText =
        "all:unset;cursor:pointer;font-size:12px;font-weight:600;color:#fff;padding:6px 12px;border-radius:6px;" +
        "background:linear-gradient(135deg,#853953,#612D53);";
    give.addEventListener("click", () => {
        debugLog("Feedback: prompt accepted");
        close();
    });
    actions.append(later, give);

    host.append(header, body, actions);
    return host;
}

/**
 * Ask for feedback once ever, on a random page after ORE has marked up a few.
 * The prompt counts as used as soon as it shows, so no later page asks again.
 */
export async function maybeOfferFeedback(canShow: () => boolean): Promise<void> {
    if (offeredOnThisPage) return;
    offeredOnThisPage = true;
    try {
        const state = await readState();
        if (state.shown) return;
        const pages = state.pages + 1;
        await chrome.storage.local.set({[FEEDBACK_STATE_KEY]: {...state, pages}});
        if (pages < MIN_PAGES_BEFORE_ASKING || Math.random() > ASK_CHANCE) return;

        await new Promise((resolve) => setTimeout(resolve, MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)));
        if (!canShow() || document.hidden || isPageTourOpen() || document.getElementById(FEEDBACK_HOST_ID)) return;
        if ((await readState()).shown) return;
        await chrome.storage.local.set({[FEEDBACK_STATE_KEY]: {shown: true, pages}});

        const prompt = buildPrompt(() => prompt.remove());
        document.body.appendChild(prompt);
        requestAnimationFrame(() => {
            prompt.style.opacity = "1";
            prompt.style.transform = "translateY(0)";
        });
        debugLog("Feedback: prompt shown");
    } catch (err) {
        debugWarn("Feedback: prompt check failed —", err);
    }
}
