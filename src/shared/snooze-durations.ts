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

export const SNOOZE_CHOICES: readonly SnoozeChoice[] = [
    {label: "15 minutes", durationMs: () => 15 * 60_000},
    {label: "1 hour", durationMs: () => 60 * 60_000},
    {label: "Until tomorrow", durationMs: msUntilTomorrow6am},
];

/** "14:35", or "tomorrow at 09:00" when the pause runs past midnight. */
export function formatSnoozeEnd(until: number): string {
    const end = new Date(until);
    const time = end.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
    return end.toDateString() === new Date().toDateString() ? time : `tomorrow at ${time}`;
}
