/**
 * Translation review page (docs/translate/). Reviewers check machine
 * translations against the English, edit or approve them, and download a file
 * for the maintainers to apply with `npm run i18n -- import <file>`.
 * Work is kept in this browser's localStorage until downloaded.
 */

import {
  formatMessage, formsToMessage, hasChoices, messageArguments, messageForms, translationIssues, type MessageForm,
} from "@shared/i18n-format";

interface SourceEntry { message: string; context?: string; where: string[]; html?: boolean }
interface TranslationEntry {
  message: string; source: string; status: "machine" | "reviewed"; by?: string; note?: string;
  review?: 1 | 2 | 3; reviewReason?: string;
}
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
if (!Object.hasOwn(LANGUAGES, lang)) lang = "de";
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

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
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
  return translationIssues(en[id].message, message, lang);
}

type Level = 1 | 2 | 3;
/** How much attention a message needs; new or changed English always counts as careful. */
function levelOf(id: string): Level {
  const st = statusOf(id);
  if (st === "missing" || st === "stale") return 3;
  return tr[id]?.review ?? 2;
}
const LEVEL_LABEL: Record<Level, string> = { 1: "Quick check", 2: "Read it", 3: "Careful review" };

/** Plural categories this language needs beyond what English uses (e.g. "few"). */
function extraPluralKeys(): string[] {
  try {
    return new Intl.PluralRules(lang).resolvedOptions().pluralCategories.filter((c) => c !== "one" && c !== "other");
  } catch {
    return [];
  }
}

/** Example numbers for a plural category in this language, e.g. one → [1], other → [0, 2, 3]. */
function examplesFor(key: string): number[] {
  if (key.startsWith("=")) return [Number(key.slice(1))];
  const rules = new Intl.PluralRules(lang);
  const out: number[] = [];
  for (let n = 0; n <= 200 && out.length < 3; n++) if (rules.select(n) === key) out.push(n);
  return out;
}

function describePath(path: MessageForm["path"]): string {
  return path.map((step) => {
    if (step.type === "plural") {
      if (step.key.startsWith("=")) return `when {${step.name}} is exactly ${step.key.slice(1)}`;
      const ex = examplesFor(step.key);
      const list = ex.length > 1 ? `${ex.join(", ")}, …` : String(ex[0] ?? "");
      return step.key === "one" ? `when {${step.name}} is ${list} (singular)` : `when {${step.name}} is ${list}`;
    }
    return step.key === "other" ? `{${step.name}}: any other case` : `when {${step.name}} is “${step.key}”`;
  }).join(" and ");
}

/** Values that pick this form, for its preview. */
function sampleValues(source: string, path: MessageForm["path"]): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  try {
    for (const a of messageArguments(source)) values[a] = `‹${a}›`;
  } catch {
    // Unparseable: the preview is skipped anyway.
  }
  for (const step of path) values[step.name] = step.type === "plural" ? (examplesFor(step.key).find((n) => n !== 0) ?? examplesFor(step.key)[0] ?? 0) : step.key === "other" ? "…" : step.key;
  return values;
}

const formKey = (f: MessageForm): string => f.path.map((p) => `${p.name}:${p.key}`).join("|");

/** The translation split into the same forms as the English, or null if it can't be lined up. */
function alignedForms(english: string, translation: string): { en: MessageForm[]; tr: MessageForm[] } | null {
  try {
    const extra = extraPluralKeys();
    const enForms = messageForms(english, extra);
    // No translation yet: one empty box per English case, never prefilled with English.
    if (!translation) return { en: enForms, tr: enForms.map((f) => ({ path: f.path, text: "" })) };
    const trForms = new Map(messageForms(translation, extra).map((f) => [formKey(f), f]));
    const aligned = enForms.map((f) => trForms.get(formKey(f)));
    if (aligned.some((f) => !f) || trForms.size !== enForms.length) return null;
    return { en: enForms, tr: aligned as MessageForm[] };
  } catch {
    return null;
  }
}

/** Same wording, even if the plural is written differently. */
function sameMessage(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(messageForms(a)) === JSON.stringify(messageForms(b));
  } catch {
    return false;
  }
}

const area = (id: string): string => id.split(".")[0];

function matchesFilter(id: string): boolean {
  const filter = filterSelect.value;
  const st = statusOf(id);
  const local = localOf(id);
  // An unapproved edit reopens a reviewed message.
  const open = local ? !local.approved : st !== "reviewed";
  if (filter === "todo" && !open) return false;
  if (filter === "reviewed" && (st !== "reviewed" || (local && !local.approved))) return false;
  if ((filter === "level3" || filter === "level2" || filter === "level1") && (!open || levelOf(id) !== Number(filter.slice(-1)))) return false;
  if (filter === "stale" && st !== "stale" && st !== "missing") return false;
  if (filter === "mine" && !local) return false;
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
  const level = levelOf(id);
  const card = el("article", `card card-level-${level}`);
  card.dataset.id = id;

  const head = el("div", "card-head");
  head.append(el("span", `badge badge-level-${level}`, LEVEL_LABEL[level]));
  if (st !== "machine") head.append(el("span", `badge badge-${st}`, STATUS_LABEL[st]));
  const mine = el("span", "badge badge-mine", "");
  head.append(mine, el("code", "card-id", id));
  card.append(head);
  if (existing?.reviewReason && st === "machine") card.append(el("p", "card-reason", `Why: ${existing.reviewReason}`));

  card.append(el("div", "card-meta", `Used in ${src.where.join(", ")}`));
  if (src.context) card.append(el("p", "card-context", src.context));
  if (st === "stale" && existing) {
    const old = el("div", "card-old");
    old.append(el("span", "label", "Previous English"), el("div", "text", existing.source));
    card.append(old);
  }
  if (existing?.note) card.append(el("p", "card-note", existing.note));

  const local = localOf(id);
  let message = local?.message ?? existing?.message ?? "";
  const editor = el("div", "card-editor");
  const issues = el("ul", "card-issues");
  card.append(editor, issues);

  const noteInput = el("input", "card-note-input");
  noteInput.placeholder = "Optional comment for the maintainers";
  noteInput.setAttribute("aria-label", "Optional comment for the maintainers");
  noteInput.value = local?.note ?? "";
  card.append(noteInput);

  const actions = el("div", "card-actions");
  const approve = el("button", "btn btn-approve", "");
  approve.type = "button";
  const revert = el("button", "btn btn-ghost", "Undo my changes");
  revert.type = "button";
  const modeToggle = el("button", "btn btn-link", "");
  modeToggle.type = "button";
  actions.append(approve, revert, modeToggle);
  card.append(actions);

  // Messages with plural or variant forms are edited one complete sentence at a
  // time; "Edit as code" shows the raw message format instead.
  const choices = hasChoices(src.message);
  let asCode = !choices;

  const refresh = (): void => {
    const l = localOf(id);
    const found = problems(id, message);
    issues.replaceChildren(...found.map((p) => el("li", "", p)));
    approve.textContent = l?.approved ? "✓ Approved" : "Approve";
    approve.classList.toggle("is-approved", !!l?.approved);
    approve.disabled = found.length > 0;
    revert.hidden = !l;
    mine.textContent = l ? (l.approved ? "Approved by you" : "Edited by you") : "";
    mine.hidden = !l;
    card.classList.toggle("is-approved", !!l?.approved || (st === "reviewed" && !l));
  };

  const record = (approved: boolean): void => {
    const note = noteInput.value.trim();
    const unchanged = sameMessage(message, existing?.message ?? "") && !note && !approved;
    if (unchanged) delete state.entries[id];
    else state.entries[id] = { message, source: src.message, approved, ...(note ? { note } : {}) };
    saveState();
    refresh();
    updateProgress();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (problems(id, message).length) return;
      record(true);
      focusNext(card);
    }
  };

  const textArea = (value: string, label: string): HTMLTextAreaElement => {
    const area = el("textarea", "card-input");
    area.rows = 1;
    area.spellcheck = true;
    area.lang = lang;
    area.value = value;
    area.setAttribute("aria-label", label);
    area.addEventListener("keydown", onKey);
    return area;
  };

  const preview = (source: string, values: Record<string, string | number>): string => {
    try {
      return formatMessage(source, values, lang);
    } catch {
      return "";
    }
  };

  const drawCode = (): void => {
    const enBlock = el("div", "card-en");
    enBlock.append(el("span", "label", "English"), el("div", "text", src.message));
    const area = textArea(message, LANGUAGES[lang]);
    const label = el("span", "label", LANGUAGES[lang]);
    const pv = el("div", "card-preview");
    const showPreview = (): void => {
      pv.replaceChildren();
      if (problems(id, message).length) return;
      const samples = choices
        ? messageForms(message, extraPluralKeys()).map((f) => preview(message, sampleValues(message, f.path)))
        : messageArguments(message).size ? [preview(message, sampleValues(message, []))] : [];
      if (samples.length) pv.append(el("span", "label", "Preview"), ...samples.filter(Boolean).map((t) => el("div", "sample", t)));
    };
    area.addEventListener("input", () => { message = area.value; autoSize(area); showPreview(); record(false); });
    editor.replaceChildren(enBlock, label, area, pv);
    showPreview();
  };

  const drawForms = (): boolean => {
    const forms = alignedForms(src.message, message);
    if (!forms) return false;
    const intro = el("p", "card-forms-intro",
      "This text changes with a number or setting. Each box is one complete version; placeholders such as {count} are filled in by ORE.");
    const previewFns: (() => void)[] = [];
    const rows = forms.en.map((enForm, i) => {
      const row = el("div", "form-row");
      row.append(el("div", "form-when", describePath(enForm.path)));
      const pair = el("div", "form-pair");
      const enCol = el("div", "form-en");
      enCol.append(el("span", "label", "English"), el("div", "text", enForm.text));
      const trCol = el("div", "form-tr");
      const area = textArea(forms.tr[i].text, `${LANGUAGES[lang]}, ${describePath(enForm.path)}`);
      const pv = el("div", "sample");
      const showPreview = (): void => {
        pv.textContent = problems(id, message).length ? "" : `→ ${preview(message, sampleValues(message, enForm.path))}`;
      };
      area.addEventListener("input", () => {
        forms.tr[i] = { path: enForm.path, text: area.value };
        message = formsToMessage(forms.tr);
        autoSize(area);
        record(false);
        for (const fn of previewFns) fn();
      });
      trCol.append(el("span", "label", LANGUAGES[lang]), area, pv);
      pair.append(enCol, trCol);
      row.append(pair);
      previewFns.push(showPreview);
      return row;
    });
    editor.replaceChildren(intro, ...rows);
    for (const fn of previewFns) fn();
    return true;
  };

  const draw = (): void => {
    if (!asCode && !drawForms()) asCode = true;
    if (asCode) drawCode();
    modeToggle.hidden = !choices;
    modeToggle.textContent = asCode ? "Edit as separate sentences" : "Edit as code";
    editor.querySelectorAll<HTMLTextAreaElement>("textarea").forEach(autoSize);
  };

  noteInput.addEventListener("input", () => record(localOf(id)?.approved ?? false));
  approve.addEventListener("click", () => {
    record(!(localOf(id)?.approved));
    if (localOf(id)?.approved) focusNext(card);
  });
  revert.addEventListener("click", () => {
    delete state.entries[id];
    message = existing?.message ?? "";
    noteInput.value = "";
    saveState();
    draw();
    refresh();
    updateProgress();
  });
  modeToggle.addEventListener("click", () => { asCode = !asCode; draw(); });
  draw();
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

/** Compact row for routine messages: read both, approve many at once, open one to edit. */
function renderQuickRow(id: string): HTMLElement {
  const row = el("div", "quick-row");
  row.dataset.id = id;
  const local = localOf(id);
  row.append(el("div", "quick-en", en[id].message), el("div", "quick-tr", local?.message ?? tr[id]?.message ?? ""));
  const edit = el("button", "btn btn-link", "Edit");
  edit.type = "button";
  edit.addEventListener("click", () => {
    const card = renderCard(id);
    row.replaceWith(card);
    card.querySelectorAll<HTMLTextAreaElement>("textarea").forEach(autoSize);
    card.querySelector("textarea")?.focus();
  });
  row.append(edit);
  return row;
}

function filterCounts(): void {
  const open = Object.keys(en).filter((id) => { const l = localOf(id); return l ? !l.approved : statusOf(id) !== "reviewed"; });
  const n = (l: Level) => open.filter((id) => levelOf(id) === l).length;
  const labels: Record<string, string> = {
    todo: `Still to review, careful first (${open.length})`,
    level3: `Careful review (${n(3)})`,
    level2: `Read it (${n(2)})`,
    level1: `Quick check — approve in bulk (${n(1)})`,
  };
  for (const opt of filterSelect.options) if (labels[opt.value]) opt.textContent = labels[opt.value];
}

function render(): void {
  filterCounts();
  let ids = Object.keys(en).filter(matchesFilter);
  if (filterSelect.value === "todo") ids = ids.sort((a, b) => levelOf(b) - levelOf(a));
  countEl.textContent = `${ids.length} message${ids.length === 1 ? "" : "s"} shown`;
  const quick = filterSelect.value === "level1";
  const items: HTMLElement[] = [];
  if (quick && ids.length) {
    const bar = el("div", "quick-bar");
    bar.append(el("p", "", "Routine labels the triage model found clearly correct. Skim the list, edit anything that reads wrong, then approve the rest together."));
    const all = el("button", "btn btn-approve", `Approve all ${ids.length} shown`);
    all.type = "button";
    all.addEventListener("click", () => {
      if (!confirm(`Approve ${ids.length} translations as shown?`)) return;
      for (const id of ids) {
        const message = localOf(id)?.message ?? tr[id]?.message;
        if (message == null || problems(id, message).length) continue;
        state.entries[id] = { ...(localOf(id) ?? {}), message, source: en[id].message, approved: true };
      }
      saveState();
      updateProgress();
      render();
    });
    bar.append(all);
    items.push(bar);
  }
  items.push(...ids.slice(0, quick ? Infinity : shown).map(quick ? renderQuickRow : renderCard));
  listEl.replaceChildren(...items);
  listEl.querySelectorAll<HTMLTextAreaElement>(".card-input").forEach(autoSize);
  if (!quick && ids.length > shown) {
    const more = el("button", "btn btn-more", `Show ${Math.min(PAGE, ids.length - shown)} more`);
    more.type = "button";
    more.addEventListener("click", () => { shown += PAGE; render(); });
    listEl.append(more);
  }
  if (!ids.length) listEl.append(el("p", "empty", "Nothing matches these filters."));
}

function updateProgress(): void {
  const ids = Object.keys(en);
  const done = ids.filter((id) => { const l = localOf(id); return l ? l.approved : statusOf(id) === "reviewed"; }).length;
  const mine = Object.keys(state.entries).filter((id) => en[id] && localOf(id)).length;
  progressEl.textContent = `${done} of ${ids.length} reviewed · ${mine} change${mine === 1 ? "" : "s"} by you not yet sent`;
  filterCounts();
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
  const entries = Object.fromEntries(Object.entries(state.entries).filter(([id]) => en[id] && localOf(id)));
  const outdated = Object.keys(state.entries).filter((id) => !en[id] || !localOf(id)).length;
  if (!Object.keys(entries).length) {
    alert(outdated
      ? `Your ${outdated} saved change${outdated === 1 ? " is" : "s are"} for English text that has since changed, so there is nothing current to send.`
      : "You haven't changed or approved anything yet.");
    return;
  }
  if (outdated && !confirm(`${outdated} of your saved change${outdated === 1 ? " was" : "s were"} made to English text that has since changed and will be left out. Download the rest?`)) return;
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
    for (const [id, entry] of Object.entries(data.entries)) {
      const ok = entry && typeof entry.message === "string" && typeof entry.source === "string";
      if (!ok) delete data.entries[id];
      else entry.approved = entry.approved === true;
    }
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
  try {
    [en, tr, glossary] = await Promise.all([
      fetchJson<Record<string, SourceEntry>>("data/en.json"),
      fetchJson<Record<string, TranslationEntry>>(`data/${lang}.json`),
      fetchJson<Glossary>("data/glossary.json").catch(() => ({})),
    ]);
  } catch (err) {
    const box = el("div", "empty");
    box.append(el("p", "", `The texts could not be loaded (${(err as Error).message}). Check the connection and try again.`));
    const retry = el("button", "btn btn-primary", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => location.reload());
    box.append(retry);
    listEl.replaceChildren(box);
    return;
  }
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
