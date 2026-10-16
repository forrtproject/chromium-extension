import {debugLog, debugWarn} from "./debug";
import {isPageTourOpen} from "./page-tour";
import {safeSendMessage, type FeedbackPromptResponse, type FeedbackPromptStep} from "./messages";

export const FEEDBACK_URL =
    "https://github.com/forrtproject/chromium-extension/issues/new?labels=feedback&title=Feedback%3A%20";

const FEEDBACK_HOST_ID = "flora-feedback-prompt";
const FEEDBACK_MESSAGE = "A minute of feedback on what works and what doesn't helps us improve ORE.";
const MIN_PAGES_BEFORE_ASKING = 3;
const ASK_CHANCE = 0.25;
const MIN_DELAY_MS = 8_000;
const MAX_DELAY_MS = 30_000;

let offeredPage: number | undefined;

function stepFeedbackPrompt(step: FeedbackPromptStep): Promise<FeedbackPromptResponse | undefined> {
    return safeSendMessage<FeedbackPromptResponse>({type: "FLORA_FEEDBACK_PROMPT", step});
}

function buildPrompt(close: () => void): {host: HTMLElement; announce: () => void} {
    const host = document.createElement("div");
    host.id = FEEDBACK_HOST_ID;
    host.setAttribute("data-flora-ui", "");
    host.setAttribute("role", "region");
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
    body.setAttribute("role", "status");
    body.style.cssText = "padding:12px;font-size:13px;line-height:1.5;color:#3c4043;";

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
    return {host, announce: () => { body.textContent = FEEDBACK_MESSAGE; }};
}

function showPrompt(): void {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeydown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && !event.defaultPrevented) close();
    };
    const close = () => {
        document.removeEventListener("keydown", onKeydown);
        const hadFocus = host.contains(document.activeElement);
        host.remove();
        if (hadFocus && returnFocus?.isConnected) returnFocus.focus({preventScroll: true});
    };
    const {host, announce} = buildPrompt(close);
    document.body.appendChild(host);
    document.addEventListener("keydown", onKeydown);
    requestAnimationFrame(() => {
        host.style.opacity = "1";
        host.style.transform = "translateY(0)";
        announce();
    });
}

/**
 * Ask for feedback once ever, on a random page after ORE has marked up a few.
 * The prompt counts as used as soon as it shows, so no later page asks again.
 */
export async function maybeOfferFeedback(currentPage: () => number, canShow: () => boolean): Promise<void> {
    const page = currentPage();
    if (offeredPage === page) return;
    offeredPage = page;
    const showable = () =>
        currentPage() === page && canShow() && !document.hidden && !isPageTourOpen() && !document.getElementById(FEEDBACK_HOST_ID);
    try {
        const visit = await stepFeedbackPrompt("visit");
        if (!visit?.granted || visit.pages < MIN_PAGES_BEFORE_ASKING || Math.random() > ASK_CHANCE) return;

        await new Promise((resolve) => setTimeout(resolve, MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)));
        if (!showable()) return;
        if (!(await stepFeedbackPrompt("claim"))?.granted) return;

        let shown = false;
        try {
            if (showable()) {
                showPrompt();
                shown = true;
                debugLog("Feedback: prompt shown");
            }
        } finally {
            if (!shown) await stepFeedbackPrompt("release");
        }
    } catch (err) {
        debugWarn("Feedback: prompt check failed —", err);
    }
}
