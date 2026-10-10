import {safeSendMessage, type RegisteredReportCheckResponse} from "@shared/messages";
import type {DoiString} from "@shared/types";

export const RR_LIBRARY_URL = "https://www.zotero.org/groups/5937153/registered_reports";

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
                if (response?.type !== "FLORA_RR_CHECK_RESULT" || response.error) {
                    throw new Error(response?.error ?? "Registered Reports data unavailable");
                }
                for (const doi of dois) known.set(doi, response.results[doi] ?? null);
                resolve();
            } catch (err) {
                reject(err);
            }
        }, 0);
    });
}

export async function lookupRegisteredReport(doi: DoiString): Promise<RegisteredReport | null> {
    if (known.has(doi)) return known.get(doi)!;
    queued.add(doi);
    queuedBatch ??= flushQueue();
    await queuedBatch;
    return known.get(doi) ?? null;
}
