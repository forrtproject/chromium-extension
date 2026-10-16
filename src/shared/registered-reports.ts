import {safeSendMessage, type RegisteredReportCheckResponse} from "@shared/messages";
import type {DoiString} from "@shared/types";
import {webUrl} from "@shared/web-url";

export const RR_LIBRARY_URL = "https://www.zotero.org/groups/5937153/registered_reports";
export const RR_ACCENT = "#0f766e";

export interface RegisteredReport {
    /** Zotero item key in the Registered Reports library. */
    key: string;
    stage: 1 | 2 | null;
    /** The companion stage's URL: the Stage 1 protocol for a Stage 2 report, and vice versa. */
    linked?: string;
}

export interface RegisteredReportMap {
    reports: Record<string, RegisteredReport>;
}

export function registeredReportEntryUrl(report: RegisteredReport): string {
    return `${RR_LIBRARY_URL}/items/${report.key}`;
}

export function registeredReportDetail(report: RegisteredReport): {subtitle: string; subtitleShort: string; href: string; actionLabel: string} {
    const linked = webUrl(report.linked);
    if (report.stage === 2) return {
        subtitle: linked ? "Stage 2 report · Stage 1 protocol linked" : "Stage 2 report",
        subtitleShort: "Stage 2",
        href: linked ?? registeredReportEntryUrl(report),
        actionLabel: linked ? "View protocol" : "View entry",
    };
    if (report.stage === 1) return {
        subtitle: linked ? "Stage 1 protocol · Stage 2 report published" : "Stage 1 protocol",
        subtitleShort: "Stage 1",
        href: linked ?? registeredReportEntryUrl(report),
        actionLabel: linked ? "View report" : "View entry",
    };
    return {
        subtitle: "Listed as a Registered Report",
        subtitleShort: "Listed",
        href: registeredReportEntryUrl(report),
        actionLabel: "View entry",
    };
}

const known = new Map<DoiString, RegisteredReport | null>();
const queued = new Set<DoiString>();
let queuedBatch: Promise<void> | null = null;

function flushQueue(): Promise<void> {
    return new Promise((resolve, reject) => {
        setTimeout(async () => {
            const dois = [...queued];
            queued.clear();
            queuedBatch = null;
            try {
                const response = await safeSendMessage<RegisteredReportCheckResponse>({type: "FLORA_RR_CHECK", dois});
                if (!response) throw new Error("Registered Reports: no answer from the extension — it was probably reloaded; reload the page");
                if (response.type !== "FLORA_RR_CHECK_RESULT" || response.error) {
                    throw new Error(`Registered Reports: ${response.error ?? "unexpected reply from the worker"}`);
                }
                for (const doi of dois) known.set(doi, response.results[doi] ?? null);
                resolve();
            } catch (err) {
                reject(err);
            }
        }, 0);
    });
}

const inFlight = new Map<DoiString, Promise<void>>();

export async function lookupRegisteredReport(doi: DoiString): Promise<RegisteredReport | null> {
    if (known.has(doi)) return known.get(doi)!;
    let batch = inFlight.get(doi);
    if (!batch) {
        queued.add(doi);
        batch = queuedBatch ??= flushQueue();
        inFlight.set(doi, batch);
        const settle = () => { inFlight.delete(doi); };
        batch.then(settle, settle);
    }
    await batch;
    return known.get(doi) ?? null;
}

/** Look several DOIs up in one batch; every DOI that is not a Registered Report maps to null. */
export async function lookupRegisteredReports(dois: DoiString[]): Promise<Map<DoiString, RegisteredReport | null>> {
    const unique = [...new Set(dois)];
    const reports = await Promise.all(unique.map(lookupRegisteredReport));
    return new Map(unique.map((doi, i) => [doi, reports[i]]));
}
