export interface Env {
  ALLOWED_ORIGINS: string;
  GITHUB_REPO: string;
  GITHUB_ISSUE: string;
  REVIEW_PAGE_URL: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  TURNSTILE_SECRET: string;
  LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  CONTACTS: KV;
  REVIEWS: KV;
}

interface KV {
  put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
}

export const CONTACT_TTL_SECONDS = 365 * 24 * 60 * 60;

export const LANGUAGES: Record<string, string> = {
  ar: "Arabic",
  "zh-CN": "Chinese (Simplified)",
  fr: "French",
  de: "German",
  hu: "Hungarian",
  ko: "Korean",
  "pt-BR": "Portuguese (Brazil)",
  "pt-PT": "Portuguese (Portugal)",
  ro: "Romanian",
  es: "Spanish",
  pl: "Polish",
  nl: "Dutch",
  cs: "Czech",
  sk: "Slovak",
  ru: "Russian",
  fi: "Finnish",
  sv: "Swedish",
  nb: "Norwegian (Bokmål)",
  it: "Italian",
  ja: "Japanese",
  "en-US": "English (US)",
  general: "General",
};

export interface Submission {
  language: string;
  name: string;
  email: string;
  message: string;
  website?: string;
  turnstileToken: string;
  confirm?: { commentId: number; items: number[] };
}

function validConfirm(value: unknown): Submission["confirm"] | null | undefined {
  if (value == null) return undefined;
  const { commentId, items } = value as { commentId?: unknown; items?: unknown };
  if (!Number.isSafeInteger(commentId) || (commentId as number) <= 0) return null;
  if (!Array.isArray(items) || !items.length || items.length > 30) return null;
  if (!items.every((i) => Number.isInteger(i) && i >= 0 && i < 100)) return null;
  return { commentId: commentId as number, items: [...new Set(items as number[])].sort((a, b) => a - b) };
}

export function validate(input: unknown): { ok: true; value: Submission } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid request." };
  const { language, name, email, message, website, turnstileToken, confirm: rawConfirm } = input as Record<string, unknown>;
  const confirm = validConfirm(rawConfirm);
  if (confirm === null) return { ok: false, error: "Invalid request." };
  if (typeof website === "string" && website.trim()) return { ok: false, error: "Invalid request." };
  if (typeof language !== "string" || !Object.hasOwn(LANGUAGES, language)) return { ok: false, error: "Choose a language." };
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) return { ok: false, error: "Enter your name (up to 80 characters)." };
  if (typeof email !== "string" || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (confirm && language === "general") return { ok: false, error: "Choose a language." };
  const text = typeof message === "string" ? message.trim() : "";
  if (typeof message !== "string" || message.length > 4000 || (!confirm && text.length < 3)) {
    return { ok: false, error: confirm ? "Keep the message under 4,000 characters." : "Write a message of 3 to 4,000 characters." };
  }
  if (typeof turnstileToken !== "string" || !turnstileToken) return { ok: false, error: "Complete the check that you are not a bot." };
  return { ok: true, value: { language, name: name.trim(), email: email.trim(), message: text, turnstileToken, ...(confirm ? { confirm } : {}) } };
}

export interface ReviewEntry { message: string; source: string; approved: boolean; note?: string; changed?: boolean }

export interface ReviewSubmission {
  language: string;
  name: string;
  email: string;
  message: string;
  turnstileToken: string;
  entries: Record<string, ReviewEntry>;
}

export const MAX_REVIEW_BYTES = 1_500_000;

export function validateReview(input: unknown): { ok: true; value: ReviewSubmission } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid request." };
  const raw = input as Record<string, unknown>;
  const person = validate({ ...raw, language: "general", message: "review", confirm: undefined });
  if (!person.ok) return person;
  const { language, message, entries } = raw;
  if (typeof language !== "string" || !Object.hasOwn(LANGUAGES, language) || language === "general" || language === "en-US") {
    return { ok: false, error: "Choose a language." };
  }
  if (message != null && (typeof message !== "string" || message.length > 4000)) return { ok: false, error: "Keep the message under 4,000 characters." };
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return { ok: false, error: "Your review is empty." };
  const clean: Record<string, ReviewEntry> = {};
  for (const [id, e] of Object.entries(entries as Record<string, unknown>)) {
    const v = e as Record<string, unknown> | null;
    const ok = /^[A-Za-z0-9_.-]{1,160}$/.test(id) && v && typeof v.message === "string" && typeof v.source === "string"
      && v.message.length <= 6000 && v.source.length <= 6000 && typeof v.approved === "boolean"
      && (v.note == null || (typeof v.note === "string" && v.note.length <= 2000));
    if (!ok) return { ok: false, error: "Your review contains an entry that could not be read. Reload the page and try again." };
    clean[id] = {
      message: v.message as string, source: v.source as string, approved: v.approved as boolean,
      ...(typeof v.note === "string" && v.note.trim() ? { note: v.note.trim() } : {}),
      ...(v.changed === true ? { changed: true } : {}),
    };
  }
  const count = Object.keys(clean).length;
  if (!count) return { ok: false, error: "Your review is empty." };
  if (count > 3000) return { ok: false, error: "Your review is too large to send. Download it instead." };
  return { ok: true, value: { ...person.value, language, message: typeof message === "string" ? message.trim() : "", entries: clean } };
}

export function reviewFile(s: ReviewSubmission, exported: string): unknown {
  const entries = Object.fromEntries(Object.entries(s.entries).map(([id, { changed: _changed, ...e }]) => [id, e]));
  return { format: "ore-translation-review", locale: s.language, reviewer: s.name, exported, entries };
}

const quoteBlock = (text: string): string => neutralize(text).split("\n").map((l) => `> ${l}`).join("\n");
const COMMENT_BUDGET = 55_000;

export function reviewCommentBody(s: ReviewSubmission, reviewPageUrl: string, key: string): string {
  const all = Object.entries(s.entries);
  const approved = all.filter(([, e]) => e.approved).length;
  const edited = all.filter(([, e]) => e.changed);
  const noted = all.filter(([, e]) => e.note);
  const counts = [`${approved} approved`, `${edited.length} edited`, ...(noted.length ? [`${noted.length} with notes`] : [])].join(", ");
  const parts = [
    `<!-- ore-review:${s.language} -->`,
    `**${LANGUAGES[s.language]} review from ${plainName(s.name)}** · ${counts}`,
    `<sub>Sent from the [translation review page](${reviewPageUrl}?lang=${s.language}) without a GitHub account.</sub>`,
  ];
  if (s.message) parts.push("", quoteBlock(s.message));
  let used = parts.join("\n").length;
  const section = (title: string, rows: [string, ReviewEntry][], line: (id: string, e: ReviewEntry) => string) => {
    if (!rows.length) return;
    const out = [`<details><summary>${title} (${rows.length})</summary>`, ""];
    let shown = 0;
    for (const [id, e] of rows) {
      const block = line(id, e);
      if (used + block.length > COMMENT_BUDGET) break;
      out.push(block, "");
      used += block.length;
      shown++;
    }
    if (shown < rows.length) out.push(`…and ${rows.length - shown} more in the stored review.`, "");
    out.push("</details>");
    parts.push("", ...out);
  };
  section("Edited translations", edited, (id, e) => `\`${id}\`\n${quoteBlock(e.source)}\n\n→ ${neutralize(e.message).replace(/\n/g, " ")}`);
  section("Notes from the reviewer", noted, (id, e) => `\`${id}\`: ${neutralize(e.note ?? "").replace(/\n/g, " ")}`);
  parts.push(
    "",
    `<sub>To apply: \`npx wrangler kv key get --binding REVIEWS --remote "${key}" > review.json\` in \`site/translation-feedback-worker\`, then \`npm run i18n -- import review.json\`.</sub>`,
  );
  return parts.join("\n");
}

const TASK = /^(\s*[-*+] \[)( |x|X)(\] )(.*)$/;

export function sectionLanguage(body: string): string | null {
  const first = body.trim().split("\n").find((l) => l.trim() && !l.startsWith(">")) ?? "";
  return /^##\s+.+?\s+\(`([A-Za-z]{2}(?:-[A-Za-z]{2})?)`\)\s*$/.exec(first.trim())?.[1] ?? null;
}

export function tickItems(body: string, items: number[]): { body: string; ticked: string[] } | null {
  const want = new Set(items);
  const ticked: string[] = [];
  let index = -1;
  const lines = body.split("\n").map((line) => {
    const m = TASK.exec(line.replace(/\r$/, ""));
    if (!m) return line;
    index++;
    if (!want.has(index)) return line;
    want.delete(index);
    if (m[2] !== " ") return line;
    ticked.push(m[4]);
    return `${m[1]}x${m[3]}${m[4]}${line.endsWith("\r") ? "\r" : ""}`;
  });
  if (want.size) return null;
  return { body: lines.join("\n"), ticked };
}

const ZWSP = "​";

export function neutralize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@(?=[A-Za-z0-9])/g, `@${ZWSP}`)
    .replace(/#(?=\d)/g, `#${ZWSP}`)
    .replace(/\b(GH)-(?=\d)/gi, `$1-${ZWSP}`)
    .replace(/!\[/g, `!${ZWSP}[`);
}

export function plainName(name: string): string {
  return neutralize(name.replace(/\s+/g, " ")).replace(/[*_`[\]\\|~]/g, (c) => `\\${c}`);
}

export function commentBody(s: Submission, reviewPageUrl: string, confirmed: string[] = []): string {
  const lang = LANGUAGES[s.language];
  const label = s.language === "general" ? "General feedback" : `${lang} (\`${s.language}\`)`;
  const anchor = s.language === "general" ? "" : `?lang=${s.language}`;
  const parts = [
    `<!-- ore-feedback:${s.language} -->`,
    `**${confirmed.length ? "Checks confirmed by" : "Feedback from"} ${plainName(s.name)}** · ${label}`,
    `<sub>Sent from the [translation review page](${reviewPageUrl}${anchor}) without a GitHub account.</sub>`,
  ];
  if (confirmed.length) parts.push("", ...confirmed.map((t) => `- ✅ ${neutralize(t)}`));
  if (s.message) parts.push("", neutralize(s.message).split("\n").map((l) => `> ${l}`).join("\n"));
  return parts.join("\n");
}

function base64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  while (n > 0) { out.unshift(n & 0xff); n >>= 8; }
  return [0x80 | out.length, ...out];
}

// GitHub hands out PKCS#1 keys ("BEGIN RSA PRIVATE KEY"); WebCrypto only imports PKCS#8.
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  if (!/BEGIN RSA PRIVATE KEY/.test(pem)) return der;
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLength(der.length), ...der];
  const inner = [0x02, 0x01, 0x00, ...algorithm, ...octet];
  return Uint8Array.from([0x30, ...derLength(inner.length), ...inner]);
}

export async function appJwt(appId: string, privateKeyPem: string, now = Date.now()): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToPkcs8(privateKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const iat = Math.floor(now / 1000) - 60;
  const head = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iat, exp: iat + 540, iss: appId }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${base64url(sig)}`;
}

const GITHUB_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ore-translation-feedback" };
let cachedToken: { token: string; expires: number } | null = null;

async function installationToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.expires - Date.now() > 120_000) return cachedToken.token;
  const jwt = await appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const auth = { ...GITHUB_HEADERS, Authorization: `Bearer ${jwt}` };
  const inst = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/installation`, { headers: auth });
  if (!inst.ok) throw new Error(`installation lookup ${inst.status}`);
  const { id } = (await inst.json()) as { id: number };
  const repoName = env.GITHUB_REPO.split("/")[1];
  const res = await fetch(`https://api.github.com/app/installations/${id}/access_tokens`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ repositories: [repoName], permissions: { issues: "write" } }),
  });
  if (!res.ok) throw new Error(`access token ${res.status}`);
  const data = (await res.json()) as { token: string; expires_at: string };
  cachedToken = { token: data.token, expires: Date.parse(data.expires_at) };
  return data.token;
}

async function turnstileOk(env: Env, token: string, ip: string | null): Promise<boolean> {
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  return res.ok && ((await res.json()) as { success: boolean }).success === true;
}

interface GitHubComment {
  id: number; html_url: string; body: string; body_html: string; created_at: string; updated_at: string;
  user: { login: string; html_url: string };
}

export async function issueThread(env: Env, token: string): Promise<unknown> {
  const headers = { ...GITHUB_HEADERS, Accept: "application/vnd.github.full+json", Authorization: `Bearer ${token}` };
  const base = `https://api.github.com/repos/${env.GITHUB_REPO}/issues/${env.GITHUB_ISSUE}`;
  const issueRes = await fetch(base, { headers });
  if (!issueRes.ok) throw new Error(`issue ${issueRes.status}`);
  const issue = (await issueRes.json()) as { body_html: string; html_url: string };
  const comments: GitHubComment[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${base}/comments?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`comments ${res.status}`);
    const batch = (await res.json()) as GitHubComment[];
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return {
    issue: { body_html: issue.body_html, html_url: issue.html_url },
    comments: comments.map((c) => ({
      id: c.id, html_url: c.html_url, body: c.body, body_html: c.body_html, created_at: c.created_at, updated_at: c.updated_at,
      user: { login: c.user.login, html_url: c.user.html_url },
    })),
  };
}

const edgeCache = (): Cache | null => (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;

async function cachedThread(request: Request, env: Env, origin: string): Promise<Response> {
  const cache = edgeCache();
  const key = new Request(new URL("/comments", request.url).toString());
  let res = cache ? await cache.match(key) : undefined;
  if (!res) {
    const body = JSON.stringify(await issueThread(env, await installationToken(env)));
    res = new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });
    if (cache) await cache.put(key, res.clone());
  }
  const out = new Response(res.body, res);
  out.headers.set("Access-Control-Allow-Origin", origin);
  out.headers.set("Vary", "Origin");
  out.headers.set("Cache-Control", "no-store");
  return out;
}

function json(body: unknown, status: number, origin: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) { headers["Access-Control-Allow-Origin"] = origin; headers.Vary = "Origin"; }
  return new Response(JSON.stringify(body), { status, headers });
}

async function handleReview(input: unknown, env: Env, ip: string | null, origin: string, request: Request): Promise<Response> {
  const checked = validateReview(input);
  if (!checked.ok) return json({ error: checked.error }, 400, origin);
  if (!(await turnstileOk(env, checked.value.turnstileToken, ip))) {
    return json({ error: "The check that you are not a bot failed. Please try again." }, 403, origin);
  }
  const s = checked.value;
  const sent = new Date().toISOString();
  const key = `review:${s.language}:${sent.replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await env.REVIEWS.put(key, JSON.stringify(reviewFile(s, sent), null, 2), {
      metadata: { language: s.language, reviewer: s.name, entries: Object.keys(s.entries).length, sent },
    });
    const token = await installationToken(env);
    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues/${env.GITHUB_ISSUE}/comments`, {
      method: "POST",
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body: reviewCommentBody(s, env.REVIEW_PAGE_URL, key) }),
    });
    if (!res.ok) throw new Error(`review comment ${res.status}`);
    const comment = (await res.json()) as { id: number; html_url: string };
    await edgeCache()?.delete(new Request(new URL("/comments", request.url).toString()));
    const contact = { name: s.name, email: s.email, language: s.language, comment: comment.html_url, review: key, sent };
    try {
      await env.CONTACTS.put(`comment:${comment.id}`, JSON.stringify(contact), { expirationTtl: CONTACT_TTL_SECONDS, metadata: contact });
    } catch (err) {
      console.error(`contact not stored for comment ${comment.id}: ${(err as Error).message}`);
    }
    return json({ ok: true, url: comment.html_url }, 201, origin);
  } catch (err) {
    console.error((err as Error).message);
    return json({ error: "Your review could not be sent right now. Your work is still saved in this browser; please try again later." }, 502, origin);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
    const origin = request.headers.get("Origin");
    const allowed = origin && origins.includes(origin) ? origin : null;
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (!allowed) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowed,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }
    if (url.pathname === "/comments" && request.method === "GET") {
      if (!allowed) return json({ error: "Not allowed from this site." }, 403, null);
      try {
        return await cachedThread(request, env, allowed);
      } catch (err) {
        console.error((err as Error).message);
        return json({ error: "Comments could not be loaded." }, 502, allowed);
      }
    }
    const posting = (url.pathname === "/feedback" || url.pathname === "/review") && request.method === "POST";
    if (!posting) return json({ error: "Not found." }, 404, allowed);
    if (!allowed) return json({ error: "Not allowed from this site." }, 403, null);

    const ip = request.headers.get("CF-Connecting-IP");
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip ?? "unknown" })).success) {
      return json({ error: "Too many messages at once. Please wait a minute and try again." }, 429, allowed);
    }

    const text = await request.text();
    if (text.length > MAX_REVIEW_BYTES) return json({ error: "Your review is too large to send. Download it instead." }, 413, allowed);
    let input: unknown;
    try { input = JSON.parse(text); } catch { return json({ error: "Invalid request." }, 400, allowed); }
    if (url.pathname === "/review") return handleReview(input, env, ip, allowed, request);
    const checked = validate(input);
    if (!checked.ok) return json({ error: checked.error }, 400, allowed);
    if (!(await turnstileOk(env, checked.value.turnstileToken, ip))) {
      return json({ error: "The check that you are not a bot failed. Please try again." }, 403, allowed);
    }

    try {
      const token = await installationToken(env);
      const auth = { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` };
      let confirmed: string[] = [];
      const confirm = checked.value.confirm;
      if (confirm) {
        const commentUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/issues/comments/${confirm.commentId}`;
        const current = await fetch(commentUrl, { headers: auth });
        if (current.status === 404) return json({ error: "That checklist no longer exists. Reload the page." }, 400, allowed);
        if (!current.ok) throw new Error(`read checklist ${current.status}`);
        const section = (await current.json()) as { body: string; issue_url: string };
        if (!section.issue_url.endsWith(`/issues/${env.GITHUB_ISSUE}`) || sectionLanguage(section.body) !== checked.value.language) {
          return json({ error: "Invalid request." }, 400, allowed);
        }
        const result = tickItems(section.body, confirm.items);
        if (!result) return json({ error: "The checklist has changed. Reload the page and try again." }, 409, allowed);
        confirmed = result.ticked;
        if (!confirmed.length && !checked.value.message) {
          return json({ error: "Someone has already confirmed these checks." }, 409, allowed);
        }
        if (confirmed.length) {
          const patch = await fetch(commentUrl, { method: "PATCH", headers: auth, body: JSON.stringify({ body: result.body }) });
          if (!patch.ok) throw new Error(`tick checklist ${patch.status}`);
        }
      }
      const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues/${env.GITHUB_ISSUE}/comments`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ body: commentBody(checked.value, env.REVIEW_PAGE_URL, confirmed) }),
      });
      if (!res.ok) throw new Error(`comment ${res.status}`);
      const comment = (await res.json()) as { id: number; html_url: string };
      const s = checked.value;
      await edgeCache()?.delete(new Request(new URL("/comments", request.url).toString()));
      const contact = { name: s.name, email: s.email, language: s.language, comment: comment.html_url, sent: new Date().toISOString() };
      try {
        await env.CONTACTS.put(`comment:${comment.id}`, JSON.stringify(contact), { expirationTtl: CONTACT_TTL_SECONDS, metadata: contact });
      } catch (err) {
        console.error(`contact not stored for comment ${comment.id}: ${(err as Error).message}`);
      }
      return json({ ok: true, url: comment.html_url }, 201, allowed);
    } catch (err) {
      console.error((err as Error).message);
      return json({ error: "Your message could not be posted right now. Please try again later." }, 502, allowed);
    }
  },
};
