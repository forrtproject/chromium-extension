import {t, uiLocale} from "./i18n";

export interface SnoozeChoice {
    label: string;
    durationMs: () => number;
}

/** 6 am the next calendar day, in the user's own timezone. */
export function msUntilTomorrow6am(): number {
    const target = new Date();
    target.setDate(target.getDate() + 1);
    target.setHours(6, 0, 0, 0);
    return Math.max(60_000, target.getTime() - Date.now());
}

// Labels are getters so they are translated when shown, not when the module loads.
export const SNOOZE_CHOICES: readonly SnoozeChoice[] = [
    {
        // i18n: snooze duration button; keep short.
        get label() { return t("snooze.choice.15min", "15 minutes"); },
        durationMs: () => 15 * 60_000,
    },
    {
        // i18n: snooze duration button; keep short.
        get label() { return t("snooze.choice.1hour", "1 hour"); },
        durationMs: () => 60 * 60_000,
    },
    {
        // i18n: snooze duration button (until 6 am the next day); keep short.
        get label() { return t("snooze.choice.tomorrow", "Until tomorrow"); },
        durationMs: msUntilTomorrow6am,
    },
];

/** "14:35", or "tomorrow at 09:00" when the pause runs past midnight. */
export function formatSnoozeEnd(until: number): string {
    const end = new Date(until);
    const time = end.toLocaleTimeString(uiLocale(), {hour: "2-digit", minute: "2-digit"});
    if (end.toDateString() === new Date().toDateString()) return time;
    // i18n: end of a snooze, inserted into "Paused until …" / "Snoozed until …"; {time} is a clock time such as 09:00.
    return t("snooze.endTomorrow", "tomorrow at {time}", {time});
}
