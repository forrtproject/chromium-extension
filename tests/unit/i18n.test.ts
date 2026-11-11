import { afterEach, describe, expect, it } from "vitest";
import { formatMessage, messageArguments, messageTags } from "../../src/shared/i18n-format";
import { localizeDocument, resolveLocale, setLocaleForTesting, t, tHtml } from "../../src/shared/i18n";
import { EN_FILE, extract, localeFile, readJson, translationProblems, type SourceCatalog, type TranslationCatalog } from "../../scripts/i18n/catalog";

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
    expect(resolveLocale("auto", "fr-FR")).toBe("en");
    expect(resolveLocale("en", "de-DE")).toBe("en");
    expect(resolveLocale(undefined, "de")).toBe("de");
  });
});

describe("catalogs", () => {
  it("en.json matches the messages in the code (run `npm run i18n -- extract`)", () => {
    const { catalog, errors } = extract();
    expect(errors).toEqual([]);
    expect(catalog).toEqual(readJson<SourceCatalog>(EN_FILE, {}));
  });

  it("German translations keep placeholders and markup", () => {
    const en = readJson<SourceCatalog>(EN_FILE, {});
    expect(translationProblems(en, readJson<TranslationCatalog>(localeFile("de"), {}))).toEqual([]);
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
  });
});
