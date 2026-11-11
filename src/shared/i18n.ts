/**
 * Interface translation.
 *
 * English lives in the code as the default message:
 *
 *   t("popup.snooze.title", "Snooze on this site")
 *   t("refs.more", "Show {count} more {count, plural, one {reference} other {references}}", {count})
 *
 * `npm run i18n:extract` collects every call into src/locales/en.json; other
 * languages live in src/locales/<lang>.json and ship as dist/locales/<lang>.json.
 * Call `initI18n()` once at startup before rendering; until then, and for any
 * message without a current translation, the English default is used.
 *
 * Rules for call sites (enforced by the extractor):
 * - the id and the English message are string literals, not templates;
 * - one call per complete sentence or label — never glue translated fragments,
 *   because word order and inflection differ between languages;
 * - no calls at module scope (they would run before initI18n).
 * A comment starting `// i18n:` directly above a call is shown to translators.
 */

import { formatMessage, messageTags, type MessageValues } from "./i18n-format";

export type { MessageValues };

/** Languages with a shipped catalog. The first is the source language. */
export const SUPPORTED_LOCALES = ["en", "de"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
/** Value of the `language` setting: a supported locale or "auto" (browser language). */
export type LanguagePreference = "auto" | Locale;

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch" };

let locale: Locale = "en";
let catalog: Record<string, string> = {};

export function uiLocale(): Locale {
  return locale;
}

export function resolveLocale(pref: LanguagePreference | undefined, browserLanguage: string): Locale {
  if (pref && pref !== "auto" && (SUPPORTED_LOCALES as readonly string[]).includes(pref)) return pref;
  const base = browserLanguage.toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? (base as Locale) : "en";
}

function browserLanguage(): string {
  try {
    return chrome.i18n.getUILanguage();
  } catch {
    return typeof navigator !== "undefined" ? navigator.language : "en";
  }
}

/** Fetch a shipped catalog. Works in extension pages and the service worker. */
export async function fetchCatalog(target: Locale): Promise<Record<string, string>> {
  if (target === "en") return {};
  const res = await fetch(chrome.runtime.getURL(`dist/locales/${target}.json`));
  if (!res.ok) throw new Error(`catalog ${target}: HTTP ${res.status}`);
  return (await res.json()) as Record<string, string>;
}

export const LOCALE_CATALOG_REQUEST = "FLORA_LOCALE_CATALOG";

function isExtensionContext(): boolean {
  return typeof location !== "undefined" && location.protocol === "chrome-extension:";
}

async function loadCatalog(target: Locale): Promise<Record<string, string>> {
  if (target === "en") return {};
  // Content scripts cannot fetch extension files without exposing them to every
  // page, so they ask the service worker for the catalog instead.
  if (isExtensionContext()) return fetchCatalog(target);
  const reply = (await chrome.runtime.sendMessage({ type: LOCALE_CATALOG_REQUEST, locale: target })) as
    | { catalog?: Record<string, string> }
    | undefined;
  return reply?.catalog ?? {};
}

const SETTINGS_KEY = "flora_settings";

async function readPreference(): Promise<LanguagePreference | undefined> {
  try {
    const raw = await chrome.storage.sync.get(SETTINGS_KEY);
    return (raw[SETTINGS_KEY] as { language?: LanguagePreference } | undefined)?.language;
  } catch {
    return undefined;
  }
}

let initPromise: Promise<void> | null = null;
let listening = false;

/** Load the user's language. Safe to call repeatedly; later calls reuse the first. */
export function initI18n(): Promise<void> {
  initPromise ??= (async () => {
    await applyPreference(await readPreference());
    if (!listening) {
      listening = true;
      try {
        chrome.storage.onChanged?.addListener((changes, area) => {
          if (area !== "sync" || !changes[SETTINGS_KEY]) return;
          const pref = (changes[SETTINGS_KEY].newValue as { language?: LanguagePreference } | undefined)?.language;
          void applyPreference(pref);
        });
      } catch {
        // No storage events outside the extension (tests, docs pages).
      }
    }
  })();
  return initPromise;
}

let applying = 0;

async function applyPreference(pref: LanguagePreference | undefined): Promise<void> {
  const target = resolveLocale(pref, browserLanguage());
  const run = ++applying;
  if (target === locale && (target === "en" || Object.keys(catalog).length)) return;
  let next: Record<string, string> = {};
  let nextLocale: Locale = "en";
  try {
    next = await loadCatalog(target);
    nextLocale = target;
  } catch {
    // Fall back to English.
  }
  // A newer language change may have finished first; keep its result.
  if (run !== applying) return;
  catalog = next;
  locale = nextLocale;
  if (typeof document !== "undefined" && isExtensionContext()) document.documentElement.lang = locale;
}

/** Test hook: switch language synchronously with a given catalog. */
export function setLocaleForTesting(next: Locale, messages: Record<string, string> = {}): void {
  locale = next;
  catalog = messages;
  initPromise = Promise.resolve();
}

/** Translated markup must use exactly the English tags and attributes (also enforced by the catalog check). */
const sameMarkup = (english: string, translated: string): boolean =>
  !english.includes("<") && !translated.includes("<") ? true : messageTags(english).join() === messageTags(translated).join();

function render(id: string, english: string, values?: MessageValues): string {
  const translated = catalog[id];
  if (translated != null && sameMarkup(english, translated)) {
    try {
      return formatMessage(translated, values, locale);
    } catch {
      // A malformed translation falls back to English rather than breaking the UI.
    }
  }
  return formatMessage(english, values, "en");
}

/** Translate a plain-text message. Use with textContent, titles and aria labels. */
export function t(id: string, english: string, values?: MessageValues): string {
  return render(id, english, values);
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/**
 * Translate a message that contains markup (e.g. `<strong>`) for use with
 * innerHTML. Values are escaped; the message's own tags are trusted because
 * `npm run i18n:check` requires every translation to use the same tags.
 */
export function tHtml(id: string, english: string, values?: MessageValues): string {
  const escaped: MessageValues = {};
  for (const [k, v] of Object.entries(values ?? {})) escaped[k] = typeof v === "string" ? escapeHtml(v) : v;
  return render(id, english, escaped);
}

/**
 * Translate static HTML. Elements carry `data-i18n="id"` (their inner HTML is
 * the English message) and/or `data-i18n-attr="title:id; aria-label:id2"`
 * (the attribute's current value is the English message).
 */
export function localizeDocument(root: ParentNode = document): void {
  if (locale === "en") return;
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const translated = catalog[el.dataset.i18n!];
    if (translated != null && sameMarkup(el.innerHTML, translated)) el.innerHTML = translated;
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr!.split(";")) {
      const [attr, id] = pair.split(":").map((s) => s.trim());
      if (!attr || !id) continue;
      const translated = catalog[id];
      if (translated != null) el.setAttribute(attr, translated);
    }
  }
}
