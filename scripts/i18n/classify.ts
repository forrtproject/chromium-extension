/**
 * Rate how much human review each machine translation needs, so reviewers can
 * start with the risky ones and approve routine labels in bulk:
 *   1 quick check — routine wording, clearly right
 *   2 read it     — probably right; phrasing or terminology worth a look
 *   3 careful     — meaning-critical, ambiguous, complex or doubtful
 * A second model (not the translator) judges; fixed rules set a floor.
 */

import { hasChoices } from "../../src/shared/i18n-format";
import { EN_FILE, localeFile, readJson, writeSortedJson, type SourceCatalog, type TranslationCatalog } from "./catalog";
import { callModel, parseReply } from "./translate";

const DEFAULT_MODEL = "openai/gpt-6.1-sol";
const BATCH = 40;
const LANGUAGE_NAMES: Record<string, string> = { de: "German" };

const system = (lang: string): string => `You triage ${LANGUAGE_NAMES[lang]} translations of the interface of FORRT ORE, a browser extension that marks academic papers with small "pills" showing replications, retractions, expressions of concern, Registered Reports, PubPeer comments and open-access copies. A native speaker will review them; your rating decides what they look at first.

For each item rate the review need:
1 = quick check: short, routine UI wording (buttons, menu labels, standard status text) and the translation is clearly correct and natural. Safe to approve after a glance.
2 = read it: probably correct, but phrasing, register, terminology or fit in the UI deserves a native speaker's read.
3 = review carefully: any of — statements about scientific evidence (replication outcomes, retractions, what a finding means), privacy or data-handling claims, instructions users must follow exactly, ambiguous English where the translation had to guess, a possible mistranslation or unnatural wording, tight space limits, or you have any doubt.
Style rules the translation should follow: no direct address ("Sie"/"du"), "Retraction" kept in English, "pill" = "Markierung", names unchanged.

Reply with only a JSON object: {"<id>": {"level": 1|2|3, "reason": "<= 12 words in English; empty for level 1"}}.`;

type Rating = { level?: number; reason?: string };

export async function classifyEntries(lang: string, opts: { all: boolean; model?: string; limit?: number }): Promise<number> {
  const model = opts.model ?? DEFAULT_MODEL;
  const en = readJson<SourceCatalog>(EN_FILE, {});
  const path = localeFile(lang);
  const tr = readJson<TranslationCatalog>(path, {});
  const todo = Object.keys(tr)
    .filter((id) => en[id] && tr[id].source === en[id].message && tr[id].status !== "reviewed")
    .filter((id) => opts.all || tr[id].review == null)
    .slice(0, opts.limit ?? Infinity);
  console.log(`${lang}: rating ${todo.length} translations with ${model}`);
  let cost = 0, missed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const payload = batch.map((id) => ({
      id,
      english: en[id].message,
      translation: tr[id].message,
      ...(en[id].context ? { context: en[id].context } : {}),
      usedIn: en[id].where.join(", "),
    }));
    let reply: Record<string, Rating> = {};
    try {
      const r = await callModel(model, system(lang), JSON.stringify(payload, null, 1));
      cost += r.cost;
      reply = parseReply<Rating>(r.text);
    } catch (err) {
      console.error(`batch failed: ${(err as Error).message}`);
    }
    for (const id of batch) {
      const got = reply[id];
      let level = got?.level === 1 || got?.level === 2 || got?.level === 3 ? got.level : null;
      let reason = got?.reason?.trim() ?? "";
      if (level == null) { missed++; level = 2; reason = "Not rated automatically"; }
      // Plurals, choices and markup always get a proper read.
      if (level < 2 && (hasChoices(en[id].message) || en[id].html)) {
        level = 2;
        reason ||= hasChoices(en[id].message) ? "Has number or variant forms" : "Contains formatting";
      }
      const entry = tr[id];
      entry.review = level as 1 | 2 | 3;
      entry.reviewReason = level > 1 && reason ? reason : undefined;
    }
    writeSortedJson(path, tr);
    console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}, spend so far $${cost.toFixed(3)}`);
  }
  const counts = [1, 2, 3].map((l) => Object.values(tr).filter((t) => t.review === l).length);
  console.log(`${lang}: quick check ${counts[0]}, read ${counts[1]}, careful ${counts[2]}; ${missed} unrated; OpenRouter cost $${cost.toFixed(3)}`);
  return 0;
}
