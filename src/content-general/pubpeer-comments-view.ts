import type { PubPeerComment } from "@shared/pubpeer-comments";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const key = name.toLowerCase();
    return Object.hasOwn(ENTITIES, key) ? ENTITIES[key] : whole;
  });
}

const unescapeMarkdown = (text: string): string => text.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1");

function webHref(url: string): string | null {
  try {
    const parsed = new URL(decodeEntities(unescapeMarkdown(url)));
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = text;
  a.style.cssText = "color:#853953;text-decoration:underline;overflow-wrap:anywhere;";
  return a;
}

const INLINE = new RegExp(
  [
    /\\([\\`*_{}[\]()#+\-.!>~|])/.source,
    /`([^`]+)`/.source,
    /!?\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.source,
    /<(https?:\/\/[^>\s]+)>/.source,
    /(https?:\/\/[^\s<>]+)/.source,
    /\*\*(?=\S)([\s\S]+?)\*\*/.source,
    /(?<![A-Za-z0-9_])__(?=\S)([\s\S]+?)__(?![A-Za-z0-9_])/.source,
    /\*(?=[^\s*])([\s\S]+?)\*/.source,
    /(?<![A-Za-z0-9_])_(?=[^\s_])([\s\S]+?)_(?![A-Za-z0-9_])/.source,
    /~~(?=\S)([\s\S]+?)~~/.source,
  ].join("|"),
  "g"
);

function trimBareUrl(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (".,;:!?'\"".includes(ch)) { end--; continue; }
    if (ch === ")" && (url.slice(0, end).match(/\(/g)?.length ?? 0) < (url.slice(0, end).match(/\)/g)?.length ?? 0)) { end--; continue; }
    break;
  }
  return url.slice(0, end);
}

function appendInline(parent: Node, text: string): void {
  let last = 0;
  const pushText = (s: string): void => { if (s) parent.appendChild(document.createTextNode(decodeEntities(s))); };
  const wrap = (tag: string, inner: string): void => {
    const el = document.createElement(tag);
    appendInline(el, inner);
    parent.appendChild(el);
  };
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    pushText(text.slice(last, start));
    last = start + m[0].length;
    const [whole, escaped, code, label, target, autolink, bare, bold, boldUnderscore, italic, italicUnderscore, strike] = m;
    if (escaped !== undefined) pushText(escaped);
    else if (code !== undefined) {
      const el = document.createElement("code");
      el.textContent = code;
      el.style.cssText = "font-family:ui-monospace,Consolas,monospace;font-size:0.92em;background:#eef1f4;padding:0 3px;border-radius:3px;";
      parent.appendChild(el);
    } else if (target !== undefined) {
      const href = webHref(target);
      const shown = decodeEntities(unescapeMarkdown(label ?? "")) || decodeEntities(unescapeMarkdown(target));
      if (href) parent.appendChild(link(href, shown));
      else pushText(whole);
    } else if (autolink !== undefined || bare !== undefined) {
      const raw = autolink ?? trimBareUrl(bare!);
      if (bare !== undefined) last = start + raw.length;
      const href = webHref(raw);
      if (href) parent.appendChild(link(href, raw));
      else pushText(raw);
    } else if (bold !== undefined || boldUnderscore !== undefined) wrap("strong", bold ?? boldUnderscore!);
    else if (italic !== undefined || italicUnderscore !== undefined) wrap("em", italic ?? italicUnderscore!);
    else if (strike !== undefined) wrap("del", strike);
  }
  pushText(text.slice(last));
}

function appendLines(parent: HTMLElement, lines: string[]): void {
  lines.forEach((line, i) => {
    if (i > 0) parent.appendChild(document.createElement("br"));
    appendInline(parent, line);
  });
}

const LIST_ITEM = /^\s{0,3}([*+-]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE_LINE = /^\s{0,3}>\s?(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;
const BLOCK_STYLE = "margin:0 0 8px;";

export function renderCommentMarkdown(markdown: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      const pre = document.createElement("pre");
      pre.textContent = body.join("\n");
      pre.style.cssText = BLOCK_STYLE + "white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:12px;background:#eef1f4;padding:8px;border-radius:4px;";
      fragment.appendChild(pre);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const p = document.createElement("p");
      p.style.cssText = BLOCK_STYLE + "font-weight:600;";
      appendInline(p, heading[1]);
      fragment.appendChild(p);
      i++;
      continue;
    }

    if (QUOTE_LINE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_LINE.test(lines[i])) quoted.push(QUOTE_LINE.exec(lines[i++])![1]);
      const quote = document.createElement("blockquote");
      quote.style.cssText = BLOCK_STYLE + "padding-left:10px;border-left:3px solid #d5c4cb;color:#5f6368;";
      appendLines(quote, quoted);
      fragment.appendChild(quote);
      continue;
    }

    const firstItem = LIST_ITEM.exec(line);
    if (firstItem) {
      const ordered = /\d/.test(firstItem[1]);
      const list = document.createElement(ordered ? "ol" : "ul");
      list.style.cssText = BLOCK_STYLE + "padding-left:20px;";
      let item: HTMLLIElement | null = null;
      while (i < lines.length && lines[i].trim()) {
        const next = LIST_ITEM.exec(lines[i]);
        if (next) {
          item = document.createElement("li");
          appendInline(item, next[2]);
          list.appendChild(item);
        } else if (item) {
          item.appendChild(document.createElement("br"));
          appendInline(item, lines[i].trim());
        }
        i++;
        if (i < lines.length && !lines[i].trim() && LIST_ITEM.test(lines[i + 1] ?? "")) i++;
      }
      fragment.appendChild(list);
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !QUOTE_LINE.test(lines[i]) &&
      !(paragraph.length > 0 && LIST_ITEM.test(lines[i]))
    ) paragraph.push(lines[i++].trimEnd());
    const p = document.createElement("p");
    p.style.cssText = BLOCK_STYLE;
    appendLines(p, paragraph);
    fragment.appendChild(p);
  }
  return fragment;
}

function responseBadge(comment: PubPeerComment): HTMLSpanElement | null {
  const label = comment.isAuthorResponse ? "Author response" : comment.isEditorResponse ? "Editor response" : null;
  if (!label) return null;
  const badge = document.createElement("span");
  badge.textContent = label;
  badge.style.cssText = "font-size:11px;font-weight:600;color:#853953;background:#f9f0f4;border-radius:4px;padding:1px 6px;";
  return badge;
}

export function renderCommentList(comments: readonly PubPeerComment[]): HTMLOListElement {
  const list = document.createElement("ol");
  list.setAttribute("aria-label", "PubPeer comments");
  list.style.cssText = "list-style:none;margin:0;padding:8px 12px;display:flex;flex-direction:column;gap:8px;";
  for (const comment of comments) {
    const item = document.createElement("li");
    item.dataset.floraCommentId = String(comment.id);
    item.style.cssText =
      "background:#fff;border:1px solid #e8e8e8;border-left:3px solid #853953;border-radius:6px;" +
      "padding:10px 12px;font-size:13px;line-height:1.55;color:#3c4043;overflow-wrap:anywhere;";

    const meta = document.createElement("div");
    meta.style.cssText = "display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;margin-bottom:6px;";
    if (comment.number > 0) {
      const number = document.createElement("span");
      number.textContent = `#${comment.number}`;
      number.style.cssText = "font-size:12px;color:#9aa0a6;";
      meta.appendChild(number);
    }
    const user = document.createElement("strong");
    user.textContent = comment.user || "Anonymous";
    user.style.cssText = "font-weight:600;color:#202124;";
    meta.appendChild(user);
    const badge = responseBadge(comment);
    if (badge) meta.appendChild(badge);
    if (comment.createdAt) {
      const date = document.createElement("time");
      date.dateTime = comment.createdAt;
      date.textContent = comment.createdAt;
      date.style.cssText = "font-size:12px;color:#9aa0a6;margin-left:auto;";
      meta.appendChild(date);
    }
    item.appendChild(meta);

    const body = document.createElement("div");
    body.appendChild(renderCommentMarkdown(comment.markdown));
    if (body.lastElementChild instanceof HTMLElement) body.lastElementChild.style.marginBottom = "0";
    item.appendChild(body);
    list.appendChild(item);
  }
  return list;
}
