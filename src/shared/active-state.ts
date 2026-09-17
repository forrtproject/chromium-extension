import {getSnooze, isDomainBlocked} from "./domains";

const MAX_TIMER_MS = 2_147_483_647;

let reportSeq = 0;
let badgeTimer: ReturnType<typeof setTimeout> | null = null;

function send(active: boolean, snoozedUntil: number | null, blocked = false): void {
    try {
        chrome.runtime.sendMessage({type: "FLORA_ACTIVE_STATE", active, snoozedUntil, blocked})?.catch(() => {});
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
                if (still === null) reportInactive();
            })
            .catch(() => {});
    }, wait);
}

export function reportActiveState(active: boolean, snoozedUntil: number | null = null, blocked = false): void {
    reportSeq++;
    send(active, snoozedUntil, blocked);
    if (snoozedUntil !== null) scheduleBadgeClear(snoozedUntil);
    else cancelBadgeClear();
}

export function reportBlocked(): void {
    reportActiveState(false, null, true);
}

export function reportInactive(): void {
    const mine = ++reportSeq;
    void Promise.all([getSnooze(location.hostname), isDomainBlocked(location.hostname)])
        .then(([until, blocked]) => {
            if (mine !== reportSeq) return;
            send(false, until, blocked);
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
