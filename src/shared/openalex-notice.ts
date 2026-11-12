/**
 * Tell the reader, once per daily budget, that OpenAlex's free allowance is
 * nearly used up and title matching continues with Crossref alone.
 */

import {onOpenAlexLimit, safeSendMessage} from "./messages";
import {alertToastShowing, showToast} from "./toast";
import type {OpenAlexLimit} from "./openalex-quota";
import {debugLog} from "./debug";

/** chrome.storage.local: the reset time of the last budget the reader was told about. */
const NOTICE_KEY = "flora_openalex_notice_until";
let shownUntil = 0;

async function showOpenAlexLimitNotice(limit: OpenAlexLimit): Promise<void> {
    if (limit.resetAt <= shownUntil || document.hidden) return;
    try {
        const stored = (await chrome.storage.local.get(NOTICE_KEY))[NOTICE_KEY];
        if (typeof stored === "number" && stored >= limit.resetAt - 60_000) {
            shownUntil = stored;
            return;
        }
    } catch {
        // Without storage, tell once per page.
    }
    // Don't push a Retry the reader still needs off the screen; the next lookup tries again.
    if (alertToastShowing()) return;
    shownUntil = limit.resetAt;
    try {
        await chrome.storage.local.set({[NOTICE_KEY]: limit.resetAt});
    } catch {
        // See above.
    }
    const until = new Date(limit.resetAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
    debugLog(`OpenAlex notice: budget low until ${until} (${limit.keyed ? "API key" : "shared, no key"})`);
    if (limit.keyed) {
        showToast(`Your OpenAlex key's daily allowance is used up, so ORE matches titles with Crossref alone until ${until}.`, {
            title: "OpenAlex limit reached", tone: "info", duration: 10_000,
        });
        return;
    }
    showToast(`Your network has used up OpenAlex's free daily allowance, so ORE matches titles with Crossref alone until ${until}. A free OpenAlex key, added in Settings, gives you your own allowance.`, {
        title: "OpenAlex limit reached", tone: "info", duration: 0,
        action: {label: "Settings", onClick: () => void safeSendMessage({type: "FLORA_OPEN_OPTIONS"})},
    });
}

/** Call once from each content script that matches titles. */
export function installOpenAlexLimitNotice(): void {
    onOpenAlexLimit((limit) => void showOpenAlexLimitNotice(limit));
}
