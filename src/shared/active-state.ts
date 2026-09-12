import {getSnooze} from "./domains";

const MAX_TIMER_MS = 2_147_483_647;

let reportSeq = 0;
let badgeTimer: ReturnType<typeof setTimeout> | null = null;

function send(active: boolean, snoozedUntil: number | null): void {
    try {
        chrome.runtime.sendMessage({type: "FLORA_ACTIVE_STATE", active, snoozedUntil})?.catch(() => {});
    } catch {}
}

function scheduleBadgeClear(until: number): void {
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = null;
    const wait = until - Date.now();
    if (wait <= 0 || wait > MAX_TIMER_MS) return;
    badgeTimer = setTimeout(() => {
        badgeTimer = null;
        void getSnooze(location.hostname)
            .then((still) => {
                if (still === null) reportActiveState(false);
            })
            .catch(() => {});
    }, wait);
}

export function reportActiveState(active: boolean, snoozedUntil: number | null = null): void {
    reportSeq++;
    send(active, snoozedUntil);
export function reportActiveState(active: boolean, snoozedUntil: number | null = null): void {
    reportSeq++;
    send(active, snoozedUntil);
    if (snoozedUntil !== null) {
        scheduleBadgeClear(snoozedUntil);
    } else if (badgeTimer) {
        clearTimeout(badgeTimer);
        badgeTimer = null;
    }
}
    void getSnooze(location.hostname)
        .then((until) => {
            if (mine !== reportSeq) return;
            send(false, until);
            if (until !== null) scheduleBadgeClear(until);
        })
        .catch(() => {
            if (mine === reportSeq) send(false, null);
        });
}

export function _resetActiveStateForTesting(): void {
    reportSeq = 0;
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = null;
}
