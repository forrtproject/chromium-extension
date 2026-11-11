/**
 * Translation review page (docs/translate/). Reviewers check machine
 * translations against the English, edit or approve them, and download a file
 * for the maintainers to apply with `npm run i18n -- import <file>`.
 * Work is kept in this browser's localStorage until downloaded.
 */

import { formatMessage, messageArguments, messageTags, parseMessage } from "@shared/i18n-format";

interface SourceEntry { message: string; context?: string; where: string[]; html?: boolean }
interface TranslationEntry { message: string; source: string; status: "machine" | "reviewed"; by?: string; note?: string }
interface LocalEntry { message: string; source: string; approved: boolean; note?: string }
interface LocalState { reviewer: string; entries: Record<string, LocalEntry> }
type Glossary = Record<string, Record<string, string>>;

const LANGUAGES: Record<string, string> = { de: "Deutsch (German)" };

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const listEl = $<HTMLElement>("#list");
const progressEl = $<HTMLElement>("#progress");
const reviewerInput = $<HTMLInputElement>("#reviewer");
const langSelect = $<HTMLSelectElement>("#lang");
const filterSelect = $<HTMLSelectElement>("#filter");
const areaSelect = $<HTMLSelectElement>("#area");
const searchInput = $<HTMLInputElement>("#search");
const countEl = $<HTMLElement>("#count");
const glossaryEl = $<HTMLElement>("#glossary");

let lang = new URLSearchParams(location.search).get("lang") ?? "de";
if (!LANGUAGES[lang]) lang = "de";
let en: Record<string, SourceEntry> = {};
let tr: Record<string, TranslationEntry> = {};
let glossary: Glossary = {};
let state: LocalState = { reviewer: "", entries: {} };

const storageKey = (): string => `ore-translation-review-${lang}`;

function loadState(): void {
  try {
    const raw = localStorage.getItem(storageKey());
    state = raw ? (JSON.parse(raw) as LocalState) : { reviewer: "", entries: {} };
  } catch {
    state = { reviewer: "", entries: {} };
  }
  state.entries ??= {};
}

let saveTimer: number | undefined;
function saveState(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(state));
    } catch {
      // Storage full or blocked: the download still works for this session.
    }
  }, 200);
}

async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(path, { cache: "no-cache" });
    return res.ok ? ((await res.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

type Status = "missing" | "stale" | "machine" | "reviewed";
function statusOf(id: string): Status {
  const entry = tr[id];
  if (!entry) return "missing";
  if (entry.source !== en[id].message) return "stale";
  return entry.status;
}

/** Local work that still applies to the current English. */
function localOf(id: string): LocalEntry | undefined {
  const local = state.entries[id];
  return local && local.source === en[id].message ? local : undefined;
}

function problems(id: string, message: string): string[] {
  if (!message.trim()) return ["The translation is empty."];
  const src = en[id].message;
  try {
    parseMessage(message);
  } catch (err) {
    return [`Format error: ${(err as Error).message.replace(/ in ".*$/, "")}. Check the { } brackets.`];
  }
  const out: string[] = [];
  const want = [...messageArguments(src)].sort();
  const got = [...messageArguments(message)].sort();
  const missing = want.filter((a) => !got.includes(a));
  const extra = got.filter((a) => !want.includes(a));
  if (missing.length) out.push(`Missing placeholder: ${missing.map((a) => `{${a}}`).join(", ")}`);
  if (extra.length) out.push(`Unknown placeholder: ${extra.map((a) => `{${a}}`).join(", ")} — keep the names from the English`);
  if (messageTags(src).join() !== messageTags(message).join()) out.push("Keep the same HTML tags as the English (e.g. <strong>…</strong>).");
  return out;
}

/** Sample renderings so reviewers can see plural forms and placeholders filled in. */
function previews(message: string): string[] {
  let args: Set<string>;
  try {
    args = messageArguments(message);
  } catch {
    return [];
  }
  if (!args.size) return [];
  const plural = /\{\s*(\w+)\s*,\s*plural/.exec(message)?.[1];
  const counts = plural ? [1, 2, 5] : [3];
  return counts.map((n) => {
    const values: Record<string, string | number> = {};
    for (const a of args) values[a] = a === plural || /count|total|checked|n$/i.test(a) ? n : `‹${a}›`;
    try {
      return formatMessage(message, values, lang);
    } catch {
      return "";
    }
  }).filter(Boolean);
}

const area = (id: string): string => id.split(".")[0];

function matchesFilter(id: string): boolean {
  const filter = filterSelect.value;
  const st = statusOf(id);
  const local = localOf(id);
  if (filter === "todo" && (st === "reviewed" || local?.approved)) return false;
  if (filter === "stale" && st !== "stale" && st !== "missing") return false;
  if (filter === "mine" && !local) return false;
  if (filter === "reviewed" && st !== "reviewed") return false;
  if (areaSelect.value && area(id) !== areaSelect.value) return false;
  const q = searchInput.value.trim().toLowerCase();
  if (q) {
    const hay = `${id} ${en[id].message} ${tr[id]?.message ?? ""} ${local?.message ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const STATUS_LABEL: Record<Status, string> = {
  missing: "Not translated",
  stale: "English changed",
  machine: "Machine translation",
  reviewed: "Reviewed",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function renderCard(id: string): HTMLElement {
  const src = en[id];
  const existing = tr[id];
  const st = statusOf(id);
  const card = el("article", "card");
  card.dataset.id = id;

  const head = el("div", "card-head");
  head.append(el("code", "card-id", id));
  const badge = el("span", `badge badge-${st}`, STATUS_LABEL[st]);
  head.append(badge);
  const mine = el("span", "badge badge-mine", "");
  head.append(mine);
  card.append(head);

  const meta = el("div", "card-meta", `Used in ${src.where.join(", ")}`);
  card.append(meta);
  if (src.context) card.append(el("p", "card-context", src.context));

  const enBlock = el("div", "card-en");
  enBlock.append(el("span", "label", "English"), el("div", "text", src.message));
  card.append(enBlock);
  if (st === "stale" && existing) {
    const old = el("div", "card-old");
    old.append(el("span", "label", "Previous English"), el("div", "text", existing.source));
    card.append(old);
  }
  if (existing?.note) card.append(el("p", "card-note", existing.note));

  const label = el("label", "label", LANGUAGES[lang]);
  const area = el("textarea", "card-input");
  area.id = `t-${id}`;
  label.htmlFor = area.id;
  area.rows = 1;
  area.spellcheck = true;
  area.lang = lang;
  const local = localOf(id);
  area.value = local?.message ?? existing?.message ?? "";
  card.append(label, area);

  const preview = el("div", "card-preview");
  const issues = el("ul", "card-issues");
  card.append(preview, issues);

  const noteInput = el("input", "card-note-input");
  noteInput.placeholder = "Optional comment for the maintainers";
  noteInput.value = local?.note ?? "";
  card.append(noteInput);

  const actions = el("div", "card-actions");
  const approve = el("button", "btn btn-approve", "");
  approve.type = "button";
  const revert = el("button", "btn btn-ghost", "Undo my changes");
  revert.type = "button";
  actions.append(approve, revert);
  card.append(actions);

  const refresh = (): void => {
    autoSize(area);
    const l = localOf(id);
    const message = area.value;
    const found = problems(id, message);
    issues.replaceChildren(...found.map((p) => el("li", "", p)));
    preview.replaceChildren();
    const samples = found.length ? [] : previews(message);
    if (samples.length) {
      preview.append(el("span", "label", "Preview"));
      for (const s of samples) preview.append(el("div", "sample", s));
    }
    approve.textContent = l?.approved ? "✓ Approved" : "Approve";
    approve.classList.toggle("is-approved", !!l?.approved);
    approve.disabled = found.length > 0;
    revert.hidden = !l;
    mine.textContent = l ? (l.approved ? "Approved by you" : "Edited by you") : "";
    mine.hidden = !l;
    card.classList.toggle("is-approved", !!l?.approved || (st === "reviewed" && !l));
  };

  const record = (approved: boolean): void => {
    const message = area.value;
    const note = noteInput.value.trim();
    const unchanged = message === (existing?.message ?? "") && !note && !approved;
    if (unchanged) delete state.entries[id];
    else state.entries[id] = { message, source: src.message, approved, ...(note ? { note } : {}) };
    saveState();
    refresh();
    updateProgress();
  };

  area.addEventListener("input", () => record(false));
  noteInput.addEventListener("input", () => record(localOf(id)?.approved ?? false));
  approve.addEventListener("click", () => {
    record(!(localOf(id)?.approved));
    if (localOf(id)?.approved) focusNext(card);
  });
  revert.addEventListener("click", () => {
    delete state.entries[id];
    area.value = existing?.message ?? "";
    noteInput.value = "";
    saveState();
    refresh();
    updateProgress();
  });
  area.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (problems(id, area.value).length) return;
      record(true);
      focusNext(card);
    }
  });
  refresh();
  return card;
}

/** Grow a textarea to fit its text, so reviewers see the whole translation. */
function autoSize(area: HTMLTextAreaElement): void {
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight + 2}px`;
}
window.addEventListener("resize", () => document.querySelectorAll<HTMLTextAreaElement>(".card-input").forEach(autoSize));

function focusNext(card: HTMLElement): void {
  const next = card.nextElementSibling as HTMLElement | null;
  const input = next?.querySelector("textarea");
  if (input) {
    input.focus();
    next!.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

const PAGE = 60;
let shown = PAGE;

function render(): void {
  const ids = Object.keys(en).filter(matchesFilter);
  countEl.textContent = `${ids.length} message${ids.length === 1 ? "" : "s"}`;
  listEl.replaceChildren(...ids.slice(0, shown).map(renderCard));
  listEl.querySelectorAll<HTMLTextAreaElement>(".card-input").forEach(autoSize);
  if (ids.length > shown) {
    const more = el("button", "btn btn-more", `Show ${Math.min(PAGE, ids.length - shown)} more`);
    more.type = "button";
    more.addEventListener("click", () => { shown += PAGE; render(); });
    listEl.append(more);
  }
  if (!ids.length) listEl.append(el("p", "empty", "Nothing matches these filters."));
}

function updateProgress(): void {
  const ids = Object.keys(en);
  const done = ids.filter((id) => statusOf(id) === "reviewed" || localOf(id)?.approved).length;
  const mine = Object.keys(state.entries).filter((id) => en[id] && localOf(id)).length;
  progressEl.textContent = `${done} of ${ids.length} reviewed · ${mine} change${mine === 1 ? "" : "s"} by you not yet sent`;
}

function renderGlossary(): void {
  const rows = Object.entries(glossary);
  if (!rows.length) { glossaryEl.hidden = true; return; }
  const table = el("table");
  const headRow = el("tr");
  headRow.append(el("th", "", "English"), el("th", "", LANGUAGES[lang]), el("th", "", "Note"));
  table.append(headRow);
  for (const [term, t] of rows) {
    const row = el("tr");
    row.append(el("td", "", term), el("td", "", t[lang] ?? "—"), el("td", "", t.note ?? ""));
    table.append(row);
  }
  glossaryEl.querySelector(".glossary-body")!.replaceChildren(table);
}

function download(): void {
  const entries = Object.fromEntries(Object.entries(state.entries).filter(([id]) => en[id]));
  if (!Object.keys(entries).length) {
    alert("You haven't changed or approved anything yet.");
    return;
  }
  const file = {
    format: "ore-translation-review",
    locale: lang,
    reviewer: state.reviewer,
    exported: new Date().toISOString(),
    entries,
  };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  const who = state.reviewer.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  a.download = `ore-translation-${lang}-${new Date().toISOString().slice(0, 10)}${who ? `-${who}` : ""}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function loadFile(file: File): Promise<void> {
  try {
    const data = JSON.parse(await file.text()) as { format?: string; locale?: string; reviewer?: string; entries?: Record<string, LocalEntry> };
    if (data.format !== "ore-translation-review" || !data.entries) throw new Error("not a review file");
    if (data.locale !== lang) throw new Error(`this file is for "${data.locale}"`);
    const n = Object.keys(data.entries).length;
    if (!confirm(`Load ${n} reviewed message${n === 1 ? "" : "s"} from this file? They replace your current work on the same messages.`)) return;
    Object.assign(state.entries, data.entries);
    if (!state.reviewer && data.reviewer) state.reviewer = data.reviewer;
    reviewerInput.value = state.reviewer;
    saveState();
    render();
    updateProgress();
  } catch (err) {
    alert(`Couldn't load the file: ${(err as Error).message}`);
  }
}

async function start(): Promise<void> {
  for (const [code, name] of Object.entries(LANGUAGES)) {
    const opt = el("option", "", name);
    opt.value = code;
    langSelect.append(opt);
  }
  langSelect.value = lang;
  [en, tr, glossary] = await Promise.all([
    fetchJson<Record<string, SourceEntry>>("data/en.json", {}),
    fetchJson<Record<string, TranslationEntry>>(`data/${lang}.json`, {}),
    fetchJson<Glossary>("data/glossary.json", {}),
  ]);
  loadState();
  reviewerInput.value = state.reviewer;
  for (const a of [...new Set(Object.keys(en).map(area))].sort()) {
    const opt = el("option", "", a);
    opt.value = a;
    areaSelect.append(opt);
  }
  renderGlossary();
  render();
  updateProgress();
}

reviewerInput.addEventListener("input", () => { state.reviewer = reviewerInput.value; saveState(); });
langSelect.addEventListener("change", () => { location.search = `?lang=${langSelect.value}`; });
for (const control of [filterSelect, areaSelect]) control.addEventListener("change", () => { shown = PAGE; render(); });
let searchTimer: number | undefined;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => { shown = PAGE; render(); }, 200);
});
$<HTMLButtonElement>("#download").addEventListener("click", download);
const fileInput = $<HTMLInputElement>("#load-file");
$<HTMLButtonElement>("#load").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
  fileInput.value = "";
});
window.addEventListener("beforeunload", () => {
  clearTimeout(saveTimer);
  try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch { /* ignore */ }
});

void start();
