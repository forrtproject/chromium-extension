// Offers a reader the chance to report a crash in FLoRA's own code: a toast
// that, on click, opens ORE's GitHub issue form prefilled with the error, the
// page, and the log tail. Nothing leaves the browser without that click.

import { debugError, debugLog, setRuntimeErrorListener, type RuntimeErrorInfo } from "@shared/debug";
import { buildDebugReport, issueUrl, stashIssueReport } from "@shared/debug-report";
import { showToast } from "@shared/toast";
import { writeClipboard } from "@shared/clipboard";

const offered = new Set<string>();

// A loop that throws every pass must not bury the page in toasts.
const MAX_OFFERS_PER_PAGE = 3;
let offeredCount = 0;

function key(info: RuntimeErrorInfo): string {
    return `${info.where ?? ""}|${info.message}`;
}

function toInfo(where: string, err: unknown): RuntimeErrorInfo {
    if (err instanceof Error) {
        return { message: `${err.name}: ${err.message}`, stack: err.stack, where };
    }
    return { message: String(err), where };
}

export function reportCodeError(where: string, err: unknown): void {
    debugError(`${where} —`, err);
    offerErrorReport(toInfo(where, err));
}

export function offerErrorReport(info: RuntimeErrorInfo): void {
    if (typeof document === "undefined" || !document.body) return;
    if (offeredCount >= MAX_OFFERS_PER_PAGE) return;

    const id = key(info);
    if (offered.has(id)) return;
    offered.add(id);
    offeredCount++;

    showToast("ORE hit an error on this page.", {
        tone: "error",
        action: { label: "Report it", onClick: () => openIssue(info) },
    });
}

async function openIssue(info: RuntimeErrorInfo): Promise<void> {
    let link = issueUrl({ domain: location.hostname, error: info });

    try {
        const { text, data } = await buildDebugReport({ pageUrl: location.href, error: info });
        link = issueUrl({ domain: location.hostname, report: data, error: info });
        const stashed = await stashIssueReport(text);
        debugLog(`Error report: ${link.embeddedEntries} entr(ies) in the URL, full log parked: ${stashed}`);
    } catch (err) {
        debugError("Error report: building the debug report failed —", err);
    }

    if (window.open(link.url, "_blank", "noopener") !== null) return;

    // Blocked by the page or the browser — hand over the link instead.
    const copied = await writeClipboard(link.url);
    showToast(
        copied
            ? "Couldn't open the issue form — the link is on your clipboard."
            : "Couldn't open the issue form. Report it from the ORE toolbar menu.",
        { tone: "error", duration: 6000 }
    );
}

export function installErrorReporting(): void {
    setRuntimeErrorListener(offerErrorReport);
}

export function _resetErrorReportingForTesting(): void {
    offered.clear();
    offeredCount = 0;
}
