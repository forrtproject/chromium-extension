import { RELAY, openSend } from "./relay";

interface ThreadComment {
  id: number; html_url: string; body: string; body_html: string; created_at: string; updated_at: string;
  user: { login: string; html_url: string };
}

const ISSUE_API = "https://api.github.com/repos/forrtproject/chromium-extension/issues/295";
const POLL_MS = 120_000;
const section = document.getElementById("guide") as HTMLElement;
const q = <T extends HTMLElement>(sel: string): T => section.querySelector(sel) as T;

let lang = "";
let languageName = "";
let reviewerName = (): string => "";
const picked = new Set<number>();
let checklistComment: ThreadComment | null = null;
let lastLoad = 0;

async function loadThread(): Promise<ThreadComment[]> {
  try {
    const res = await fetch(`${RELAY}/comments`);
    if (res.ok) return ((await res.json()) as { comments: ThreadComment[] }).comments;
  } catch {
    // Relay unreachable (or this isn't forrt.org): read GitHub directly.
  }
  const comments: ThreadComment[] = [];
  let url = `${ISSUE_API}/comments?per_page=100`;
  while (url) {
    const res = await fetch(url, { headers: { Accept: "application/vnd.github.full+json" } });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    comments.push(...((await res.json()) as ThreadComment[]));
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? "";
  }
  return comments;
}

export function sectionCode(body: string): string | null {
  const first = body.trim().split("\n").find((l) => l.trim() && !l.startsWith(">")) ?? "";
  return /^##\s+.+?\s+\(`([A-Za-z]{2}(?:-[A-Za-z]{2})?)`\)\s*$/.exec(first.trim())?.[1] ?? null;
}

export function isFeedbackFor(body: string, code: string, name: string): boolean {
  const tagged = /<!-- ore-(feedback|review):([A-Za-z-]+) -->/.exec(body);
  if (tagged) return tagged[1] === "feedback" && tagged[2] === code;
  const text = body.toLowerCase();
  return text.includes(name.toLowerCase()) || new RegExp(`(^|[^a-z-])${code.toLowerCase()}([^a-z-]|$)`).test(text);
}

function clean(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, form").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((n) => {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
    }
    if (n instanceof HTMLAnchorElement) { n.target = "_blank"; n.rel = "noopener"; }
  });
  doc.querySelectorAll("h2").forEach((h) => h.remove());
  return doc.body.firstElementChild as HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function guideUnsent(): boolean {
  return picked.size > 0;
}

function updateBar(): void {
  const bar = q<HTMLElement>(".confirm-bar");
  q(".confirm-count").textContent = `${picked.size} ${picked.size === 1 ? "check" : "checks"} selected · not sent yet`;
  bar.hidden = picked.size === 0;
}

function labelsOf(body: HTMLElement): (i: number) => string {
  const boxes = [...body.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
  return (i) => (boxes[i]?.closest("li") ?? boxes[i]?.parentElement)?.textContent?.trim() ?? "";
}

function renderChecklist(comment: ThreadComment): HTMLElement {
  const body = clean(comment.body_html);
  const boxes = [...body.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
  const done = boxes.filter((b) => b.checked || b.hasAttribute("checked")).length;
  q<HTMLElement>(".guide-progress i").style.width = boxes.length ? `${Math.round((done / boxes.length) * 100)}%` : "0";
  q(".guide-progress-text").textContent = `${done} of ${boxes.length} checks confirmed`;
  boxes.forEach((box, i) => {
    if (box.checked || box.hasAttribute("checked")) { picked.delete(i); return; }
    box.disabled = false;
    box.checked = picked.has(i);
    box.title = "Tick to confirm this check";
    box.addEventListener("change", () => {
      if (box.checked) picked.add(i); else picked.delete(i);
      updateBar();
    });
  });
  updateBar();
  return body;
}

function renderReply(c: ThreadComment): HTMLElement {
  const box = el("div", "reply");
  const meta = el("div", "reply-meta");
  const viaPage = /<!-- ore-(feedback|review):/.test(c.body);
  const who = viaPage ? el("span", "", "Sent from this page") : el("a", "", c.user.login);
  if (who instanceof HTMLAnchorElement) { who.href = c.user.html_url; who.target = "_blank"; who.rel = "noopener"; }
  const when = el("a", "", new Date(c.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
  when.href = c.html_url; when.target = "_blank"; when.rel = "noopener";
  meta.append(who, " · ", when);
  box.append(meta, clean(c.body_html));
  return box;
}

function render(comments: ThreadComment[]): void {
  checklistComment = comments.find((c) => sectionCode(c.body) === lang) ?? null;
  section.hidden = !checklistComment;
  if (!checklistComment) return;
  q("#guide-title").textContent = `Style guide for ${languageName}`;
  q<HTMLAnchorElement>("#guide-link").href = checklistComment.html_url;
  q(".guide-body").replaceChildren(renderChecklist(checklistComment));
  const replies = comments.filter((c) => c !== checklistComment && !sectionCode(c.body) && isFeedbackFor(c.body, lang, languageName));
  q(".guide-replies summary").textContent = `Feedback on this guide (${replies.length})`;
  q(".guide-replies-body").replaceChildren(...(replies.length ? replies.map(renderReply) : [el("p", "empty", "No feedback yet.")]));
}

async function refresh(): Promise<void> {
  try {
    render(await loadThread());
    lastLoad = Date.now();
    q(".guide-status").textContent = "";
  } catch {
    q(".guide-status").textContent = "The guide could not be loaded just now; it will try again shortly.";
  }
}

function send(): void {
  const comment = checklistComment;
  if (!comment) return;
  const items = [...picked].sort((a, b) => a - b);
  const labelOf = labelsOf(q(".guide-body"));
  const summary: Node[] = [];
  if (items.length) {
    summary.push(el("p", "note", "You're confirming these checks:"));
    const list = el("ul");
    for (const i of items) list.append(el("li", "", labelOf(i)));
    summary.push(list);
  }
  void openSend({
    title: `Feedback on the ${languageName} guide`,
    summary,
    messageRequired: !items.length,
    defaultName: reviewerName(),
    doneText: "Your feedback is recorded and will appear in the guide shortly. We'll credit you by name for your contribution.",
    path: "/feedback",
    payload: (f) => ({ language: lang, ...f, ...(items.length ? { confirm: { commentId: comment.id, items } } : {}) }),
    onSent: () => {
      picked.clear();
      updateBar();
      setTimeout(() => void refresh(), 3000);
    },
  });
}

export function startGuide(code: string, name: string, getReviewer: () => string): void {
  lang = code;
  languageName = name;
  reviewerName = getReviewer;
  q(".confirm-send").addEventListener("click", send);
  q("#guide-feedback").addEventListener("click", send);
  void refresh();
  setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastLoad > POLL_MS) void refresh();
  });
}
