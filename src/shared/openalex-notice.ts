/**
 * Tell the reader, once per daily budget, that OpenAlex's free allowance is
 * nearly used up and title matching continues with Crossref alone.
 */

import {onOpenAlexLimit, safeSendMessage} from "./messages";
import {alertToastShowing, showToast} from "./toast";
import type {OpenAlexLimit} from "./openalex-quota";
import {debugLog} from "./debug";

/** chrome.storage.local: the last budget the reader was told about, as `<shared|key>:<reset ms>`. */
const NOTICE_KEY = "flora_openalex_notice";
const noticeId = (limit: OpenAlexLimit): string => `${limit.keyed ? "key" : "shared"}:${limit.resetAt}`;
let shown: string | null = null;
let waitingForTab = false;

/** Whether a recorded notice id is for this budget. Reset times differ by milliseconds between responses. */
function sameBudget(told: unknown, limit: OpenAlexLimit): boolean {
    if (typeof told !== "string") return false;
    const [who, at] = told.split(":");
    return who === noticeId(limit).split(":")[0] && Math.abs(Number(at) - limit.resetAt) < 10 * 60_000;
}

async function alreadyTold(limit: OpenAlexLimit): Promise<boolean> {
    if (sameBudget(shown, limit)) return true;
    try {
        return sameBudget((await chrome.storage.local.get(NOTICE_KEY))[NOTICE_KEY], limit);
    } catch {
        return false; // Without storage, tell once per page.
    }
}

async function showOpenAlexLimitNotice(limit: OpenAlexLimit): Promise<void> {
    if (limit.resetAt <= Date.now() || await alreadyTold(limit)) return;
    if (document.hidden) {
        // The lookups that report the budget may be over by the time the tab is shown.
        if (!waitingForTab) {
            waitingForTab = true;
            document.addEventListener("visibilitychange", () => {
                waitingForTab = false;
                void showOpenAlexLimitNotice(limit);
            }, {once: true});
        }
        return;
    }
    // Don't push a Retry the reader still needs off the screen; the next lookup tries again.
    if (alertToastShowing()) return;
    // Marked as told with nothing awaited before the toast renders, so a
    // Retry alert can't slip in between and leave the notice marked but unseen.
    shown = noticeId(limit);
    try {
        void chrome.storage.local.set({[NOTICE_KEY]: shown}).catch(() => {});
    } catch {
        // See alreadyTold().
    }
    const until = new Date(limit.resetAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
    debugLog(`OpenAlex notice: budget low until ${until} (${limit.keyed ? "API key" : "shared, no key"})`);
    if (limit.keyed) {
        showToast(`Your OpenAlex key's daily allowance is nearly used up, so ORE matches titles with Crossref alone until ${until}.`, {
            title: "OpenAlex allowance low", tone: "info", duration: 10_000,
        });
        return;
    }
    showToast(`Your network has nearly used up OpenAlex's free daily allowance, so ORE matches titles with Crossref alone until ${until}. A free OpenAlex key, added in Settings, gives you your own allowance.`, {
        title: "OpenAlex allowance low", tone: "info", duration: 0,
        action: {label: "Settings", onClick: () => void safeSendMessage({type: "FLORA_OPEN_OPTIONS"})},
    });
}

/** Call once from each content script that matches titles. */
export function installOpenAlexLimitNotice(): void {
    onOpenAlexLimit((limit) => void showOpenAlexLimitNotice(limit));
}
