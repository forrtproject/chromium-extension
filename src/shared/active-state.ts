import {getSnooze} from "./domains";

const MAX_TIMER_MS = 2_147_483_647;

let reportSeq = 0;
let badgeTimer: ReturnType<typeof setTimeout> | null = null;

function send(active: boolean, snoozedUntil: number | null): void {
    try {
        chrome.runtime.sendMessage({type: "FLORA_ACTIVE_STATE", active, snoozedUntil})?.catch(() => {});
    } catch {}
}

function cancelBadgeClear(): void {
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = null;
}

function scheduleBadgeClear(until: number): void {
    cancelBadgeClear();
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
    if (snoozedUntil !== null) scheduleBadgeClear(snoozedUntil);
    else cancelBadgeClear();
}

export function reportInactive(): void {
    const mine = ++reportSeq;
    void getSnooze(location.hostname)
        .then((until) => {
            if (mine !== reportSeq) return;
            send(false, until);
            if (until !== null) scheduleBadgeClear(until);
            else cancelBadgeClear();
        })
        .catch(() => {
            if (mine === reportSeq) send(false, null);
        });
}

export function _resetActiveStateForTesting(): void {
    reportSeq = 0;
    cancelBadgeClear();
}
