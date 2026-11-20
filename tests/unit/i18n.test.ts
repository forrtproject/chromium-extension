import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { formatMessage, messageArguments, messageTags, styleIssues } from "../../src/shared/i18n-format";
import { SUPPORTED_LOCALES, intlLocale, localizeDocument, resolveLocale, setLocaleForTesting, t, tHtml } from "../../src/shared/i18n";
import {
  EN_FILE, STYLE_FILE, US_SPELLING_FILE, extract, localeFile, readJson, translationProblems, usEnglishCatalog,
  type LanguageStyle, type SourceCatalog, type TranslationCatalog,
} from "../../scripts/i18n/catalog";

afterEach(() => setLocaleForTesting("en"));

describe("message format", () => {
  it("fills arguments, plurals and selects", () => {
    const msg = "Show {count} more {count, plural, one {reference} other {references}}";
    expect(formatMessage(msg, { count: 1 })).toBe("Show 1 more reference");
    expect(formatMessage(msg, { count: 3 })).toBe("Show 3 more references");
    expect(formatMessage("{n, plural, =0 {none} one {# item} other {# items}}", { n: 0 })).toBe("none");
    expect(formatMessage("{n, plural, one {# Eintrag} other {# Einträge}}", { n: 1200 }, "de")).toBe("1.200 Einträge");
    expect(formatMessage("{kind, select, retraction {Retracted} other {Flagged}}", { kind: "retraction" })).toBe("Retracted");
  });

  it("supports quoted braces and apostrophes", () => {
    expect(formatMessage("ORE''s '{'braces'}'")).toBe("ORE's {braces}");
    expect(formatMessage("ORE's pills")).toBe("ORE's pills");
  });

  it("reports arguments and tags for parity checks", () => {
    expect([...messageArguments("{a} and {n, plural, one {#} other {{b}}}")].sort()).toEqual(["a", "b", "n"]);
    expect(messageTags('<strong>Hi</strong> <a  href="x">y</a>')).toEqual(['</a>', '</strong>', '<a href="x">', '<strong>']);
  });
});

describe("runtime", () => {
  it("falls back to English and uses translations when loaded", () => {
    expect(t("test.hello", "Hello {name}", { name: "Ada" })).toBe("Hello Ada");
    setLocaleForTesting("de", { "test.hello": "Hallo {name}" });
    expect(t("test.hello", "Hello {name}", { name: "Ada" })).toBe("Hallo Ada");
    expect(t("test.other", "Untranslated")).toBe("Untranslated");
  });

  it("escapes values in HTML messages", () => {
    expect(tHtml("test.html", "<strong>{name}</strong>", { name: "<i>x</i>" })).toBe("<strong>&lt;i&gt;x&lt;/i&gt;</strong>");
  });

  it("falls back to English when a translation is malformed", () => {
    setLocaleForTesting("de", { "test.bad": "Hallo {name" });
    expect(t("test.bad", "Hello {name}", { name: "Ada" })).toBe("Hello Ada");
  });

  it("localizes static HTML", () => {
    document.body.innerHTML = '<button data-i18n="test.btn" data-i18n-attr="title:test.btnTitle" title="Close it">Close</button>';
    setLocaleForTesting("de", { "test.btn": "Schließen", "test.btnTitle": "Fenster schließen" });
    localizeDocument();
    const btn = document.querySelector("button")!;
    expect(btn.textContent).toBe("Schließen");
    expect(btn.title).toBe("Fenster schließen");
  });

  it("resolves the language from the setting or the browser", () => {
    expect(resolveLocale("auto", "de-AT")).toBe("de");
    expect(resolveLocale("auto", "fr-FR")).toBe("fr");
    expect(resolveLocale("auto", "fr-FR", ["de"])).toBe("en");
    expect(resolveLocale("fr", "de-DE", ["de"])).toBe("de");
    expect(resolveLocale("auto", "pt")).toBe("pt-BR");
    expect(resolveLocale("auto", "pt-PT")).toBe("pt-PT");
    expect(resolveLocale("auto", "pt-AO")).toBe("pt-PT");
    expect(resolveLocale("auto", "zh-CN")).toBe("zh-CN");
    expect(resolveLocale("auto", "zh-SG")).toBe("zh-CN");
    expect(resolveLocale("auto", "zh-Hans-HK")).toBe("zh-CN");
    expect(resolveLocale("auto", "zh-TW")).toBe("en");
    expect(resolveLocale("auto", "zh-Hant")).toBe("en");
    expect(resolveLocale("auto", "ar-EG")).toBe("ar");
    expect(resolveLocale("auto", "no")).toBe("nb");
    expect(resolveLocale("auto", "nn-NO")).toBe("nb");
    expect(resolveLocale("auto", "ja-JP")).toBe("ja");
    expect(resolveLocale("en", "de-DE")).toBe("en");
    expect(resolveLocale(undefined, "de")).toBe("de");
    expect(resolveLocale("auto", "en-US")).toBe("en-US");
    expect(resolveLocale("auto", "en_US")).toBe("en-US");
    expect(resolveLocale("auto", "en-GB")).toBe("en");
    expect(resolveLocale("auto", "en-AU")).toBe("en");
  });

  it("formats dates for UK English rather than Intl's US default", () => {
    setLocaleForTesting("en");
    expect(new Date(2026, 10, 18).toLocaleDateString(intlLocale())).toBe("18/11/2026");
    setLocaleForTesting("en-US");
    expect(new Date(2026, 10, 18).toLocaleDateString(intlLocale())).toBe("11/18/2026");
    setLocaleForTesting("en");
  });
});

describe("US English", () => {
  it("changes only British spellings and keeps the message valid", () => {
    const en = readJson<SourceCatalog>(EN_FILE, {});
    const us = usEnglishCatalog(en, readJson(US_SPELLING_FILE, {}));
    expect(us["walkthrough.pill.parts"]).toMatch(/\bcolored\b/);
    expect(Object.values(us).join(" ")).not.toMatch(/colour|behaviour|recognis|judgement|towards/i);
    expect(usEnglishCatalog({ x: { message: "Recognised towards the centre", where: [] } }, { recognis: "recogniz", towards: "toward", centre: "center" }))
      .toEqual({ x: "Recognized toward the center" });
  });
});

describe("catalogs", () => {
  it("en.json matches the messages in the code (run `npm run i18n -- extract`)", () => {
    const { catalog, errors } = extract();
    expect(errors).toEqual([]);
    expect(catalog).toEqual(readJson<SourceCatalog>(EN_FILE, {}));
  });

  it("every supported language has a style guide whose examples follow it", () => {
    const en = readJson<SourceCatalog>(EN_FILE, {});
    const styles = readJson<Record<string, LanguageStyle>>(STYLE_FILE, {});
    for (const lang of SUPPORTED_LOCALES.filter((l) => !l.startsWith("en"))) {
      expect(styles[lang], `style guide for ${lang}`).toBeDefined();
      expect(styles[lang].avoid?.length, `avoid rules for ${lang}`).toBeGreaterThan(0);
    }
    for (const [lang, style] of Object.entries(styles)) {
      for (const [id, text] of Object.entries(style.examples)) {
        expect(en[id], `${lang} example ${id}`).toBeDefined();
        expect(translationProblems(en, { [id]: { message: text, source: en[id].message, status: "reviewed" } }, lang)).toEqual([]);
        expect(styleIssues(text, style.avoid), `${lang} ${id}`).toEqual([]);
      }
    }
  });

  it("each language's avoid rules catch the mistakes they describe", () => {
    const styles = readJson<Record<string, LanguageStyle>>(STYLE_FILE, {});
    const bad: Record<string, string[]> = {
      de: ["Lade die Seite neu, damit du alles siehst.", "Bitte laden Sie die Seite neu."],
      fr: ["Recharge ta page.", "Vraiment?", "Vraiment ?"],
      es: ["Recarga tu página.", "¿Quieres que te ayude, tú?"],
      "pt-BR": ["Recarrega a tua página.", "Abra o ficheiro."],
      "pt-PT": ["Você pode recarregar.", "Abra o arquivo.", "O ORE está carregando."],
      ro: ["Reîncarcă pagina, ţi se va arăta.", "Poți reîncărca dacă tu vrei."],
      hu: ["Töltsd újra, te is."],
      ko: ["당신의 설정을 확인하세요."],
      "zh-CN": ["你好", "ORE 已更新,请重新加载", "設定"],
      ar: ["أنت تستخدم ORE", "تم التحديث, يرجى"],
      pl: ["Odśwież swoją stronę, a twój raport się pojawi.", "Czy Pan chce kontynuować?"],
      nl: ["Herlaad je pagina.", "Jouw instellingen zijn opgeslagen."],
      cs: ["Obnov si tvůj prohlížeč.", "Co ty na to?"],
      sk: ["Obnov si tvoj prehliadač.", "Čo ty na to?"],
      ru: ["Обнови свою страницу, ты увидишь результат.", "Твой отчёт готов."],
      fi: ["Sinun pitää ladata sivu uudelleen.", "Teidän asetuksenne on tallennettu."],
      sv: ["Vill ni fortsätta?"],
      nb: ["Vil De fortsette nå?"],
      it: ["Ricarica la tua pagina.", "Tu puoi continuare."],
      ja: ["あなたの設定を確認してください。", "ORE を更新した,続行", "更新が必要だ。"],
    };
    for (const [lang, samples] of Object.entries(bad)) {
      for (const s of samples) expect(styleIssues(s, styles[lang].avoid), `${lang}: ${s}`).not.toEqual([]);
    }
    expect(styleIssues("Bitte die Seite neu laden. Sie zeigt dann alles.", styles.de.avoid)).toEqual([]);
    expect(styleIssues("Seite neu laden, um Prüfungen auszuführen.", styles.de.avoid)).toEqual([]);
  });

  it("every translation catalog keeps placeholders and markup", () => {
    const en = readJson<SourceCatalog>(EN_FILE, {});
    const styles = readJson<Record<string, LanguageStyle>>(STYLE_FILE, {});
    for (const lang of Object.keys(styles).filter((l) => existsSync(localeFile(l)))) {
      expect(translationProblems(en, readJson<TranslationCatalog>(localeFile(lang), {}), lang), lang).toEqual([]);
    }
  });
});

describe("message forms", () => {
  it("splits plurals into full sentences and rebuilds them", async () => {
    const { messageForms, formsToMessage, formatMessage: fmt } = await import("../../src/shared/i18n-format");
    const msg = "Show {count} more {count, plural, one {reproduction} other {reproductions}}";
    const forms = messageForms(msg);
    expect(forms.map((f) => f.text)).toEqual(["Show {count} more reproduction", "Show {count} more reproductions"]);
    const rebuilt = formsToMessage(forms);
    for (const n of [1, 4]) expect(fmt(rebuilt, { count: n })).toBe(fmt(msg, { count: n }));
  });

  it("turns # into the named number and expands nested choices", async () => {
    const { messageForms, formsToMessage, formatMessage: fmt } = await import("../../src/shared/i18n-format");
    const msg = "{x, select, yes {A {n, plural, one {# p} other {# ps}} — inc} other {A {n, plural, one {# p} other {# ps}}}}";
    const forms = messageForms(msg);
    expect(forms).toHaveLength(4);
    expect(forms[0]).toEqual({ path: [{ name: "x", type: "select", key: "yes" }, { name: "n", type: "plural", key: "one" }], text: "A {n} p — inc" });
    const rebuilt = formsToMessage(forms);
    for (const x of ["yes", "no"]) for (const n of [1, 3]) expect(fmt(rebuilt, { x, n })).toBe(fmt(msg, { x, n }));
  });

  it("adds plural categories a language needs and quotes literal braces", async () => {
    const { messageForms, formsToMessage, formatMessage: fmt } = await import("../../src/shared/i18n-format");
    expect(messageForms("{n, plural, one {# a} other {# b}}", ["few", "many"]).map((f) => f.path[0].key)).toEqual(["one", "few", "many", "other"]);
    expect(fmt(formsToMessage(messageForms("'{'x'}' {n, plural, one {#} other {#}}")), { n: 2 })).toBe("{x} 2");
  });
});

describe("translation checks", () => {
  it("escapes values inside translated markup", () => {
    setLocaleForTesting("de", { "test.html": "<strong>{name}</strong> fertig" });
    expect(tHtml("test.html", "<strong>{name}</strong> done", { name: "<img src=x onerror=alert(1)>" }))
      .toBe("<strong>&lt;img src=x onerror=alert(1)&gt;</strong> fertig");
  });

  it("ignores a translation whose markup differs from the English", () => {
    setLocaleForTesting("de", { "test.link": '<a href="https://evil.example">Hier</a>' });
    expect(tHtml("test.link", '<a href="https://forrt.org">Here</a>')).toBe('<a href="https://forrt.org">Here</a>');
  });

  it("flags changed attributes, missing cases and dropped placeholders", async () => {
    const { translationIssues } = await import("../../src/shared/i18n-format");
    expect(translationIssues('<a href="x">a</a>', '<a href="y">b</a>', "de")).toHaveLength(1);
    expect(translationIssues('<a href="x">a</a>', '<a href="x">b</a>', "de")).toEqual([]);
    expect(translationIssues("{n, plural, one {# a} other {# b}}", "{n, plural, other {# b}}", "de")).toHaveLength(1);
    expect(translationIssues("Show {n, plural, one {# more} other {# more}}", "{n, plural, one {# weitere} other {weitere}}", "de")[0]).toMatch(/Missing placeholder.*n = other/);
    // The singular may leave out its own number.
    expect(translationIssues("{n, plural, one {# more paper} other {# more papers}}", "{n, plural, one {Ein weiterer Artikel} other {# weitere Artikel}}", "de")).toEqual([]);
    expect(translationIssues("{n, plural, one {# comment} other {# comments}}", "{n, plural, one {Un commentaire} many {# commentaires} other {# commentaires}}", "fr")[0]).toMatch(/n = one/);
    expect(translationIssues("{n, plural, one {# comment} other {# comments}}",
      "{n, plural, zero {لا توجد تعليقات} one {تعليق واحد} two {تعليقان} few {# تعليقات} many {# تعليقًا} other {# تعليق}}", "ar")).toEqual([]);
  });
});
