/**
 * Translation workflow. Run from the project root:
 *
 *   npm run i18n -- extract          collect t() calls and data-i18n into src/locales/en.json
 *   npm run i18n -- lint [path]      report extraction errors without writing anything
 *   npm run i18n -- check            fail on out-of-date en.json or broken translations
 *   npm run i18n -- status [lang]    count missing, stale, machine and reviewed messages
 *   npm run i18n -- translate de     machine-translate missing and stale messages (OpenRouter)
 *   npm run i18n -- classify de      rate how much review each draft needs (also runs after translate)
 *   npm run i18n -- import <file>    apply a review file downloaded from the review page
 *   npm run i18n -- build            write dist/locales/*.json and the review page data
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_LOCALES } from "../../src/shared/i18n";
import {
  EN_FILE, GLOSSARY_FILE, ROOT, extract, translationProblems, localeFile, readJson, shippableCatalog, writeIfChanged, writeSortedJson,
  type SourceCatalog, type TranslationCatalog, type TranslationEntry,
} from "./catalog";
import { translateMissing } from "./translate";
import { classifyEntries } from "./classify";

const TARGETS = SUPPORTED_LOCALES.filter((l) => l !== "en");

function loadEn(): SourceCatalog {
  return readJson<SourceCatalog>(EN_FILE, {});
}

export function status(en: SourceCatalog, tr: TranslationCatalog) {
  let missing = 0, stale = 0, machine = 0, reviewed = 0;
  for (const [id, src] of Object.entries(en)) {
    const entry = tr[id];
    if (!entry) missing++;
    else if (entry.source !== src.message) stale++;
    else if (entry.status === "reviewed") reviewed++;
    else machine++;
  }
  const obsolete = Object.keys(tr).filter((id) => !en[id]).length;
  return { total: Object.keys(en).length, missing, stale, machine, reviewed, obsolete };
}

function cmdExtract(checkOnly: boolean): number {
  const { catalog, errors } = extract();
  for (const e of errors) console.error(`error: ${e}`);
  if (checkOnly) {
    const current = JSON.stringify(loadEn());
    const sorted = Object.fromEntries(Object.keys(catalog).sort().map((k) => [k, catalog[k]]));
    if (current !== JSON.stringify(sorted)) {
      console.error("error: src/locales/en.json is out of date — run `npm run i18n -- extract`");
      return 1;
    }
    return errors.length ? 1 : 0;
  }
  const changed = writeIfChanged(EN_FILE, catalog);
  console.log(`${Object.keys(catalog).length} messages${changed ? " — en.json updated" : ""}`);
  return errors.length ? 1 : 0;
}

function cmdCheck(): number {
  let failed = cmdExtract(true);
  const en = loadEn();
  for (const lang of TARGETS) {
    const problems = translationProblems(en, readJson<TranslationCatalog>(localeFile(lang), {}));
    for (const p of problems) console.error(`error: ${lang}: ${p}`);
    if (problems.length) failed = 1;
    const s = status(en, readJson<TranslationCatalog>(localeFile(lang), {}));
    console.log(`${lang}: ${s.reviewed} reviewed, ${s.machine} machine, ${s.stale} stale, ${s.missing} missing, ${s.obsolete} obsolete`);
  }
  return failed;
}

function cmdBuild(): number {
  const en = loadEn();
  mkdirSync(join(ROOT, "dist/locales"), { recursive: true });
  const reviewData = join(ROOT, "docs/translate/data");
  mkdirSync(reviewData, { recursive: true });
  writeFileSync(join(reviewData, "en.json"), `${JSON.stringify(en)}\n`);
  writeFileSync(join(reviewData, "glossary.json"), `${JSON.stringify(readJson(GLOSSARY_FILE, {}))}\n`);
  for (const lang of TARGETS) {
    const tr = readJson<TranslationCatalog>(localeFile(lang), {});
    const bad = new Set(translationProblems(en, tr).map((p) => p.split(":")[0]));
    const ship = shippableCatalog(en, tr);
    for (const id of bad) delete ship[id];
    writeFileSync(join(ROOT, `dist/locales/${lang}.json`), JSON.stringify(ship));
    writeFileSync(join(reviewData, `${lang}.json`), `${JSON.stringify(tr)}\n`);
  }
  return 0;
}

interface ReviewFile {
  format: "ore-translation-review";
  locale: string;
  reviewer?: string;
  entries: Record<string, { message: string; source: string; approved: boolean; note?: string }>;
}

function cmdImport(file: string | undefined): number {
  if (!file) { console.error("usage: npm run i18n -- import <review-file.json>"); return 2; }
  const review = JSON.parse(readFileSync(file, "utf-8")) as ReviewFile;
  if (review.format !== "ore-translation-review" || !(TARGETS as readonly string[]).includes(review.locale)) {
    console.error("error: not a review file for a supported language"); return 1;
  }
  const en = loadEn();
  const path = localeFile(review.locale);
  const tr = readJson<TranslationCatalog>(path, {});
  let applied = 0, outdated = 0, rejected = 0;
  const reviewer = review.reviewer?.trim() || "reviewer";
  for (const [id, r] of Object.entries(review.entries)) {
    if (!en[id]) { outdated++; console.warn(`skip ${id}: no longer in the extension`); continue; }
    if (r.source !== en[id].message) { outdated++; console.warn(`skip ${id}: English changed since this review`); continue; }
    const candidate: TranslationEntry = r.approved
      ? { message: r.message, source: r.source, status: "reviewed", by: reviewer }
      : tr[id]?.message === r.message && tr[id]?.source === r.source
        ? { ...tr[id] } // only a comment was added
        : { message: r.message, source: r.source, status: "machine", by: `suggested by ${reviewer}` };
    if (r.note) candidate.note = r.note; else delete candidate.note;
    const problems = translationProblems(en, { [id]: candidate });
    if (problems.length) { rejected++; console.warn(`skip ${problems[0]}`); continue; }
    tr[id] = candidate;
    applied++;
  }
  writeSortedJson(path, tr);
  console.log(`${review.locale}: applied ${applied}, skipped ${outdated} outdated, ${rejected} with errors`);
  return 0;
}

async function main(): Promise<number> {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "extract": return cmdExtract(false);
    case "lint": {
      // Report extraction errors without writing en.json (safe to run in parallel).
      const { catalog, errors } = extract();
      for (const e of errors) if (!arg || e.startsWith(arg)) console.error(`error: ${e}`);
      const ids = Object.entries(catalog).filter(([, v]) => !arg || v.where.some((w) => w.startsWith(arg)));
      console.log(`${ids.length} messages${arg ? ` in ${arg}` : ""}`);
      return errors.some((e) => !arg || e.startsWith(arg)) ? 1 : 0;
    }
    case "check": return cmdCheck();
    case "build": return cmdBuild();
    case "import": return cmdImport(arg);
    case "status": {
      const en = loadEn();
      for (const lang of arg ? [arg] : TARGETS) console.log(lang, status(en, readJson<TranslationCatalog>(localeFile(lang), {})));
      return 0;
    }
    case "classify": {
      if (!arg || !(TARGETS as readonly string[]).includes(arg)) { console.error(`usage: classify <${TARGETS.join("|")}> [--all] [--model id]`); return 2; }
      const m = rest.indexOf("--model");
      return classifyEntries(arg, { all: rest.includes("--all"), model: m >= 0 ? rest[m + 1] : undefined });
    }
    case "translate": {
      if (!arg || !(TARGETS as readonly string[]).includes(arg)) { console.error(`usage: translate <${TARGETS.join("|")}> [--model id] [--limit n] [--dry-run]`); return 2; }
      const opt = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
      return translateMissing(arg, { model: opt("--model"), limit: Number(opt("--limit") ?? Infinity), dryRun: rest.includes("--dry-run") });
    }
    default:
      console.error("usage: npm run i18n -- extract|check|status|translate|import|build");
      return 2;
  }
}

main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
