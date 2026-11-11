/** Shared helpers for the i18n scripts: catalog file formats and extraction. */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { messageArguments, messageTags, parseMessage } from "../../src/shared/i18n-format";

/** Project root; the scripts and tests run from there. */
export const ROOT = process.cwd();
if (!existsSync(join(ROOT, "manifest.json"))) throw new Error("Run the i18n scripts from the project root");
export const EN_FILE = join(ROOT, "src/locales/en.json");
export const localeFile = (lang: string): string => join(ROOT, `src/locales/${lang}.json`);
export const GLOSSARY_FILE = join(ROOT, "src/locales/glossary.json");

/** One English message as extracted from the code. */
export interface SourceEntry {
  message: string;
  /** Translator notes from `// i18n:` comments. */
  context?: string;
  /** Files that use the message (no line numbers, so unrelated edits don't churn en.json). */
  where: string[];
  /** Message is inserted as HTML; translations must keep the same tags. */
  html?: boolean;
}

/** One translated message. */
export interface TranslationEntry {
  message: string;
  /** The English message this translation was made from; differs from en.json when stale. */
  source: string;
  status: "machine" | "reviewed";
  /** Engine id for machine translations, reviewer name for reviewed ones. */
  by?: string;
  /** Note from the translator or reviewer. */
  note?: string;
  /** How much human attention the translation needs: 1 quick check, 2 read it, 3 review carefully. */
  review?: 1 | 2 | 3;
  /** Why it got that level (levels 2 and 3). */
  reviewReason?: string;
}

export type SourceCatalog = Record<string, SourceEntry>;
export type TranslationCatalog = Record<string, TranslationEntry>;

export function readJson<T>(file: string, fallback: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as T) : fallback;
}

export function writeSortedJson(file: string, data: Record<string, unknown>): void {
  const sorted = Object.fromEntries(Object.keys(data).sort().map((k) => [k, data[k]]));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

/** Translations that still match the current English, flattened for shipping. */
export function shippableCatalog(en: SourceCatalog, tr: TranslationCatalog): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, entry] of Object.entries(tr)) {
    if (en[id] && entry.source === en[id].message) out[id] = entry.message;
  }
  return out;
}

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext) && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const normaliseSpace = (s: string): string => s.replace(/\s+/g, " ").trim();

export interface ExtractResult {
  catalog: SourceCatalog;
  errors: string[];
}

export function extract(): ExtractResult {
  const catalog: SourceCatalog = {};
  const errors: string[] = [];

  const add = (id: string, message: string, where: string, extra: { context?: string; html?: boolean }): void => {
    try {
      parseMessage(message);
    } catch (err) {
      errors.push(`${where}: ${(err as Error).message}`);
    }
    if (!/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(id)) errors.push(`${where}: id ${JSON.stringify(id)} should look like area.name`);
    const prev = catalog[id];
    if (prev) {
      if (prev.message !== message) errors.push(`${where}: id ${id} reused with a different message (also at ${prev.where[0]})`);
      const file = where.replace(/:\d+$/, "");
      if (!prev.where.includes(file)) prev.where.push(file);
      if (extra.context && !prev.context?.includes(extra.context)) prev.context = prev.context ? `${prev.context} ${extra.context}` : extra.context;
      if (extra.html) prev.html = true;
      return;
    }
    catalog[id] = { message, where: [where.replace(/:\d+$/, "")], ...(extra.context ? { context: extra.context } : {}), ...(extra.html ? { html: true } : {}) };
  };

  for (const file of walk(join(ROOT, "src"), ".ts")) {
    const rel = relative(ROOT, file);
    if (rel === "src/shared/i18n.ts") continue;
    const text = readFileSync(file, "utf-8");
    if (!/\bt(Html)?\(/.test(text)) continue;
    const lines = text.split("\n");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node, inFunction: boolean): void => {
      const fnLike =
        ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node) || ts.isPropertyDeclaration(node);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "t" || node.expression.text === "tHtml")) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line;
        const where = `${rel}:${line + 1}`;
        const [idArg, msgArg] = node.arguments;
        const literal = (a: ts.Expression | undefined): string | null =>
          a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null;
        const id = literal(idArg);
        const message = literal(msgArg);
        if (id == null || message == null) {
          errors.push(`${where}: ${node.expression.text}() needs a literal id and English message`);
        } else {
          if (!inFunction) errors.push(`${where}: ${id} is translated at module scope, before initI18n() runs`);
          const notes: string[] = [];
          for (let i = line - 1; i >= 0 && /^\s*\/\//.test(lines[i]); i--) {
            const m = /^\s*\/\/\s*i18n:\s*(.*)$/.exec(lines[i]);
            if (m) notes.unshift(m[1].trim());
          }
          add(id, message, where, { context: notes.join(" ") || undefined, html: node.expression.text === "tHtml" || undefined });
        }
      }
      ts.forEachChild(node, (child) => visit(child, inFunction || fnLike));
    };
    visit(sf, false);
  }

  for (const file of walk(join(ROOT, "src"), ".html")) {
    const rel = relative(ROOT, file);
    const text = readFileSync(file, "utf-8");
    const doc = new JSDOM(text).window.document;
    const lineOf = (needle: string): number => text.slice(0, Math.max(0, text.indexOf(needle))).split("\n").length;
    for (const el of doc.querySelectorAll<HTMLElement>("[data-i18n]")) {
      const id = el.dataset.i18n!;
      const html = normaliseSpace(el.innerHTML);
      add(id, html, `${rel}:${lineOf(`data-i18n="${id}"`)}`, { html: /</.test(html) || undefined, context: el.dataset.i18nNote });
    }
    for (const el of doc.querySelectorAll<HTMLElement>("[data-i18n-attr]")) {
      for (const pair of el.dataset.i18nAttr!.split(";")) {
        const [attr, id] = pair.split(":").map((s) => s.trim());
        if (!attr || !id) continue;
        const value = el.getAttribute(attr);
        const where = `${rel}:${lineOf(id)}`;
        if (value == null) errors.push(`${where}: ${id} names attribute ${attr}, which the element lacks`);
        else add(id, normaliseSpace(value), where, { context: `The ${attr} attribute.` });
      }
    }
  }

  return { catalog, errors };
}

export function writeIfChanged(file: string, data: Record<string, unknown>): boolean {
  const before = existsSync(file) ? readFileSync(file, "utf-8") : "";
  writeSortedJson(file, data);
  return before !== readFileSync(file, "utf-8");
}

/** Problems that make a translation unusable or unsafe to ship. */
export function translationProblems(en: SourceCatalog, tr: TranslationCatalog): string[] {
  const problems: string[] = [];
  for (const [id, entry] of Object.entries(tr)) {
    const src = en[id];
    if (!src) continue;
    try {
      parseMessage(entry.message);
    } catch (err) {
      problems.push(`${id}: ${(err as Error).message}`);
      continue;
    }
    const want = [...messageArguments(src.message)].sort().join(",");
    const got = [...messageArguments(entry.message)].sort().join(",");
    if (want !== got) problems.push(`${id}: placeholders {${got}} should be {${want}}`);
    if (messageTags(src.message).join() !== messageTags(entry.message).join()) {
      problems.push(`${id}: markup ${messageTags(entry.message).join(" ")} should match ${messageTags(src.message).join(" ")}`);
    }
  }
  return problems;
}

