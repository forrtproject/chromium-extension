/**
 * Machine-translate messages that are missing or whose English changed.
 * Reviewed translations are never overwritten: a stale reviewed message gets a
 * fresh machine draft, and the previous reviewed text is kept in its note.
 * Uses OpenRouter (OPENROUTER_API_KEY) so the model can be swapped with --model.
 */

import {
  EN_FILE, GLOSSARY_FILE, STYLE_FILE, localeFile, readJson, writeSortedJson,
  forTranslation, translationProblems, type LanguageStyle, type SourceCatalog, type TranslationCatalog,
} from "./catalog";
import { classifyEntries } from "./classify";

const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";
const BATCH = 40;
interface Options { model?: string; limit: number; dryRun: boolean }

export function systemPrompt(lang: string, style: LanguageStyle, glossary: Record<string, Record<string, string>>, en: SourceCatalog): string {
  const terms = Object.entries(glossary)
    .map(([term, t]) => {
      const note = t.note ? ` (${lang === "de" ? "" : "German glossary note, for context only: "}${t.note})` : "";
      return `- ${term} → ${t[lang] ?? "no agreed term yet: use the term researchers in this field use, consistently"}${note}`;
    })
    .join("\n");
  const examples = Object.entries(style.examples)
    .filter(([id]) => en[id])
    .map(([id, text]) => `- ${JSON.stringify(en[id].message)} → ${JSON.stringify(text)}`)
    .join("\n");
  return `You translate the interface of FORRT ORE, a browser extension for researchers. It marks academic papers on web pages with small "pills" that show replications, retractions, expressions of concern, Registered Reports, PubPeer comments and open-access copies.

Translate each English message into ${style.name}. Rules:
- Natural, concise, respectful UI language for academics. Prefer impersonal phrasing to addressing the reader.
${style.rules.map((r) => `- ${r}`).join("\n")}
- Messages use ICU MessageFormat. Keep every {placeholder} name unchanged. Keep plural/select structure ({n, plural, one {…} other {…}}) and its option keywords; translate only the text inside the options; keep "#".
- Keep HTML tags and their attributes exactly; translate only the text between them.
- Keep product and data-source names unchanged: FORRT, ORE, FLoRA, PubPeer, Retraction Watch, FORRT Replication Database, Crossref, OpenAlex, Unpaywall, Semantic Scholar, DOI, Google Scholar.
- Keep keyboard keys, URLs, file names and code unchanged.
- Follow this glossary:
${terms || "(none)"}
- Match the tone and conventions of these approved translations:
${examples || "(none)"}

Reply with only a JSON object mapping each id to its translation.`;
}

export async function callModel(model: string, system: string, user: string): Promise<{ text: string; cost: number }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "ORE translation" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      usage: { include: true },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { cost?: number } };
  return { text: data.choices[0].message.content, cost: data.usage?.cost ?? 0 };
}

export function parseReply<T = string>(text: string): Record<string, T> {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(json) as Record<string, T>;
}

export async function translateMissing(lang: string, opts: Options): Promise<number> {
  const model = opts.model ?? DEFAULT_MODEL;
  const en = forTranslation(readJson<SourceCatalog>(EN_FILE, {}));
  const path = localeFile(lang);
  const tr = readJson<TranslationCatalog>(path, {});
  const glossary = readJson<Record<string, Record<string, string>>>(GLOSSARY_FILE, {});
  const style = readJson<Record<string, LanguageStyle>>(STYLE_FILE, {})[lang];
  if (!style) throw new Error(`No style guide for "${lang}" in src/locales/style.json`);

  const todo = Object.keys(en).filter((id) => !tr[id] || tr[id].source !== en[id].message).slice(0, opts.limit);
  console.log(`${lang}: ${todo.length} messages to translate with ${model}`);
  if (opts.dryRun || !todo.length) return 0;

  const system = systemPrompt(lang, style, glossary, en);
  let cost = 0, done = 0, failed = 0;
  const queue = [...todo];
  const retried = new Set<string>();
  while (queue.length) {
    const batch = queue.splice(0, BATCH);
    const payload = batch.map((id) => ({
      id,
      english: en[id].message,
      ...(en[id].context ? { context: en[id].context } : {}),
      usedIn: en[id].where.join(", "),
      ...(en[id].html ? { html: true } : {}),
      ...(tr[id] ? { previousEnglish: tr[id].source, previousTranslation: tr[id].message } : {}),
    }));
    let reply: Record<string, string> = {};
    try {
      const r = await callModel(model, system, JSON.stringify(payload, null, 1));
      cost += r.cost;
      reply = parseReply(r.text);
    } catch (err) {
      console.error(`batch failed: ${(err as Error).message}`);
    }
    for (const id of batch) {
      const message = reply[id];
      const prev = tr[id];
      const candidate = {
        message: message ?? "",
        source: en[id].message,
        status: "machine" as const,
        by: model,
        ...(prev?.status === "reviewed" ? { note: `Previously reviewed: ${prev.message}` } : {}),
      };
      const problems = typeof message === "string" ? translationProblems(en, { [id]: candidate }, lang) : ["no reply"];
      if (problems.length) {
        if (!retried.has(id)) { retried.add(id); queue.push(id); }
        else { failed++; console.warn(`gave up on ${id}: ${problems[0]}`); }
        continue;
      }
      tr[id] = candidate;
      done++;
    }
    writeSortedJson(path, tr);
    console.log(`  ${done}/${todo.length} translated, spend so far $${cost.toFixed(3)}`);
  }
  console.log(`${lang}: ${done} translated, ${failed} failed, OpenRouter cost $${cost.toFixed(3)}`);
  if (done) await classifyEntries(lang, { all: false });
  return failed ? 1 : 0;
}
