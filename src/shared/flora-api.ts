import {fetchWithDeadline, isAbortError} from "./work-cancellation";
import { z } from "zod";
import type { DoiString, ReplicationResult } from "./types";
import { ReplicationResultSchema } from "./types";
import { debugLog, debugError } from "./debug";

// Loose envelope — validate each result individually below so one malformed
// entry can't fail the whole batch.
const ResponseEnvelopeSchema = z.object({
  results: z.record(z.string(), z.unknown()),
});

// `<row id>.<key>` — the second half is the AES key the server encrypted the set with and
// never keeps, so a token that arrives truncated can never be resolved and is not worth a link.
const SET_TOKEN = /^[0-9a-f]{8}\.[A-Za-z0-9_-]{43}$/;

const SetSchema = z.object({
  id: z.string().regex(SET_TOKEN),
});

/** The addressable half of a set token, safe to log — the key half is not. */
const setRowId = (token: string) => token.slice(0, token.indexOf("."));

const API_BASE = "https://rep-api.forrt.org";
const BATCH_SIZE = 50;
// Batches run one after another. No new batch starts after this long, so a
// page with thousands of DOIs still answers inside the worker's request
// deadline; the DOIs left over come back as errors, which are never cached.
const LOOKUP_BUDGET_MS = 180_000;

/**
 * Look up replication data for a batch of DOIs.
 * Uses the FORRT replication API: GET /v1/original-lookup?dois=doi1,doi2,...
 * Splits into batches of 50 to limit URL length.
 * Populates `errors` for failed DOIs while retaining successful batch results.
 */
export async function lookupDOIs(
  dois: DoiString[],
  errors: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<Map<DoiString, ReplicationResult>> {
  if (dois.length === 0) {
    return new Map();
  }

  const results = new Map<DoiString, ReplicationResult>();
  const totalBatches = Math.ceil(dois.length / BATCH_SIZE);
  debugLog(`Looking up ${dois.length} DOIs in ${totalBatches} batch(es) of ${BATCH_SIZE}`);

  const startedAt = Date.now();
  for (let i = 0; i < dois.length; i += BATCH_SIZE) {
    signal?.throwIfAborted();
    if (Date.now() - startedAt > LOOKUP_BUDGET_MS) {
      debugError(`Lookup time budget spent; ${dois.length - i} DOI(s) left unchecked`);
      for (const doi of dois.slice(i)) errors[doi] = "Lookup timed out";
      break;
    }
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = dois.slice(i, i + BATCH_SIZE);
    debugLog(`Batch ${batchNum}/${totalBatches}: ${batch.length} DOIs`);
    try {
      const batchResults = await lookupBatch(batch, errors, signal);
      for (const [doi, result] of batchResults) {
        results.set(doi, result);
      }
      debugLog(`Batch ${batchNum} returned ${batchResults.size} results`);
    } catch (err) {
      // A cancelled batch is not a per-DOI failure: reject so the caller caches nothing.
      if (isAbortError(err)) throw err;
      debugError(`Batch ${batchNum} failed:`, err);
      const message = err instanceof Error ? err.message : "Lookup failed";
      for (const doi of batch) errors[doi] = message;
    }
  }

  debugLog(`Total results across all batches: ${results.size}`);
  return results;
}

export async function createDoiSet(dois: DoiString[], signal?: AbortSignal): Promise<string | null> {
  if (dois.length === 0) return null;

  try {
    const response = await fetchWithDeadline(`${API_BASE}/v1/sets`, {
      signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dois }),
    });

    if (!response.ok) {
      throw new Error(`FLoRA API error: ${response.status}`);
    }

    const { id } = SetSchema.parse(await response.json());
    debugLog(`Created DOI set ${setRowId(id)} for ${dois.length} DOIs`);
    return id;
  } catch (err) {
    debugError(`Could not create a DOI set for ${dois.length} DOIs:`, err);
    return null;
  }
}

async function lookupBatch(
  dois: DoiString[],
  errors: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<Map<DoiString, ReplicationResult>> {
  const doisParam = dois.join(",");
  const response = await fetchWithDeadline(
    `${API_BASE}/v1/original-lookup?dois=${encodeURIComponent(doisParam)}`, {signal}
  );

  if (!response.ok) {
    throw new Error(`FLoRA API error: ${response.status}`);
  }

  const raw = await response.json();
  const envelope = ResponseEnvelopeSchema.parse(raw);

  const results = new Map<DoiString, ReplicationResult>();
  for (const [doi, rawResult] of Object.entries(envelope.results)) {
    if (rawResult == null) continue; // genuine no-record for this DOI
    const parsed = ReplicationResultSchema.safeParse(rawResult);
    if (parsed.success) {
      results.set(doi.toLowerCase() as DoiString, parsed.data);
    } else {
      errors[doi.toLowerCase()] = "FLoRA API returned a malformed result";
      // Skip a malformed entry rather than failing every DOI in the batch.
      debugError(`FLoRA API: skipping malformed result for ${doi}:`, parsed.error.issues);
    }
  }

  return results;
}
