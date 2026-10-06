import {reportActiveState, reportScanState} from "./active-state";
import {onPubPeerVerdict} from "./pubpeer-api";
import {redactDebugText} from "./debug-redact";
import {recentDebugEntries, type RuntimeErrorInfo} from "./debug";
import type {ScanState} from "./messages";

export interface ScanSummary {
    papers: number;
    flagged: number;
    incomplete: boolean;
}

const RESCAN_DELAY_MS = 400;
const BENIGN_ERROR = /Extension context invalidated|Receiving end does not exist|message (port|channel) closed|AbortError/i;

let source: (() => ScanSummary | null) | null = null;
let shown: "none" | ScanState["phase"] = "none";
let lastKey = "";
let scanning = false;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function clearScanTimer(): void {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = null;
}

function send(state: ScanState): void {
    const key = JSON.stringify(state);
    if (key === lastKey) return;
    lastKey = key;
    shown = state.phase;
    reportScanState(state);
}

function showActive(): void {
    if (shown === "none") return;
    shown = "none";
    lastKey = "";
    reportActiveState(true);
}

function sendScanning(): void {
    scanTimer = null;
    const summary = scanning && shown !== "error" ? source?.() : null;
    if (summary) send({phase: "scanning", papers: summary.papers});
}

function sendDone(summary: ScanSummary): void {
    if (summary.papers === 0 && !summary.incomplete) showActive();
    else send({phase: "done", papers: summary.papers, flagged: summary.flagged, incomplete: summary.incomplete});
}

export function setScanSummarySource(next: () => ScanSummary | null): void {
    source = next;
    if (listening) return;
    listening = true;
    onPubPeerVerdict(noteScanUpdated);
}

export function noteScanStarted(): void {
    scanning = true;
    if (!source || shown === "error" || scanTimer) return;
    if (shown === "done") scanTimer = setTimeout(sendScanning, RESCAN_DELAY_MS);
    else sendScanning();
}

export function noteScanProgress(): void {
    if (scanning && shown === "scanning") queueMicrotask(sendScanning);
}

export function noteScanEnded(cancelled: boolean, discarded: boolean): void {
    scanning = false;
    clearScanTimer();
    if (discarded || shown === "error") return;
    const summary = source?.();
    if (!summary) return;
    if (cancelled) showActive();
    else sendDone(summary);
}

export function noteScanUpdated(): void {
    if (scanning || shown !== "done") return;
    const summary = source?.();
    if (summary) sendDone(summary);
}

export function noteScanReset(): void {
    clearScanTimer();
    showActive();
}

export function noteScanHidden(): void {
    clearScanTimer();
    if (shown === "scanning") reportActiveState(true);
    shown = "none";
    lastKey = "";
}

export function noteScanShown(): void {
    queueMicrotask(() => {
        if (shown === "error") return;
        const summary = source?.();
        if (!summary) return;
        lastKey = "";
        if (scanning) sendScanning();
        else sendDone(summary);
    });
}

function redacted(text: string, max: number): string {
    return redactDebugText(text).slice(0, max);
}

export function noteScanError(info: RuntimeErrorInfo): void {
    if (shown === "error" || BENIGN_ERROR.test(info.message)) return;
    clearScanTimer();
    lastKey = "";
    const state: ScanState = {
        phase: "error",
        pageUrl: redactDebugText(location.href),
        error: {
            message: redacted(info.message, 500),
            stack: info.stack === undefined ? undefined : redacted(info.stack, 4000),
            where: info.where,
        },
        entries: recentDebugEntries().slice(-40).map((entry) => ({...entry, msg: redacted(entry.msg, 500)})),
    };
    shown = "error";
    reportScanState(state);
}

export function _resetToolbarScanForTesting(): void {
    source = null;
    shown = "none";
    lastKey = "";
    scanning = false;
    clearScanTimer();
}
