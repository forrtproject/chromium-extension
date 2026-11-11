# Contributing to FORRT ORE

We welcome bug reports, documentation improvements, accessibility fixes, tests, and focused improvements to the Open Research Extension. Please follow the [FORRT Code of Conduct](https://forrt.org/coc/).

## Start with an issue

Check [existing issues](https://github.com/forrtproject/chromium-extension/issues) and pull requests before starting. For a new feature, provider, permission, or substantial change to DOI matching or evidence labels, discuss the proposal in an issue first. Small fixes can go straight to a pull request.

For a bug, include the extension version, browser and operating system, a public example URL, steps to reproduce, and expected and actual behaviour. Screenshots help with placement problems. The popup's **Debug mode** and **Report an issue** can prepare a diagnostic report; review it and remove private page titles, URLs, or other sensitive details before submitting. Never include API keys or private browsing data.

## Set up a development copy

Install Node.js 24, matching CI. Fork the repository, then replace `YOUR-USERNAME` below with your GitHub username:

```bash
git clone https://github.com/YOUR-USERNAME/chromium-extension.git
cd chromium-extension
git remote add upstream https://github.com/forrtproject/chromium-extension.git
git switch -c fix/describe-your-change
npm ci
npm run build
```

In `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the repository root. After editing, rebuild and reload the extension. Use a separate browser profile for development. See the [README](README.md#development) for the architecture and site-adapter conventions.

## Check your change

Run the same core checks as pull-request CI:

```bash
npm run typecheck
node --test tests/visual/publisher.test.cjs
npm test
npm run build
```

Add a focused regression test for a behaviour change. Ordinary tests should mock provider responses rather than rely on live APIs. For publisher placement or search-result UI changes, include a small HTML fixture and inspect the visual results. Follow the [visual test guide](tests/visual/README.md) for local reports, CI screenshot approval, and baseline updates. Its first local run downloads Chrome for Testing; macOS and Windows results are intended for visual inspection rather than matching Linux pixels. [Live checks](tests/live/README.md) are optional and use real sites; describe any you ran.

Preserve distinctions between unavailable providers, confirmed no-matches, replication outcomes, retractions, and expressions of concern. Do not turn missing data into a scientific conclusion. Changes to permissions, diagnostics, storage, or network requests should explain their privacy implications. Edit source files rather than generated `dist/` output.

## Translations

ORE's interface can be translated; German is the first language. You don't need to code to help.

**Reviewing a translation.** Open the [translation review page](https://forrt.org/chromium-extension/translate/), choose the language, and work through the cards, starting with those marked for careful review: correct the draft, then press **Approve**. Routine labels can be skimmed and approved together. Your work is kept in your browser. When you're done, press **Download my review** and attach the file to a [GitHub issue](https://github.com/forrtproject/chromium-extension/issues/new?title=Translation%20review). Please follow the glossary shown on the page.

**Writing code with user-facing text.** Put every message that users see through `t()` from `src/shared/i18n.ts`, with an id and the English text as literals, e.g. `t("popup.snooze.pausedUntil", "Paused until {time}", {time})`. Use whole sentences with `{placeholders}` and ICU plurals (`{count, plural, one {# paper} other {# papers}}`) instead of joining fragments, because word order differs between languages. Use `tHtml()` instead of `t()` when the message itself contains markup and goes into `innerHTML`; it escapes the values, and translations must keep the English tags and attributes exactly. Static HTML uses `data-i18n="id"` and `data-i18n-attr="title:id"`. A `// i18n:` comment above a call is shown to translators. Debug logs, issue reports and messages with ids under `debug.` (the debug-mode progress panel, testing-build banners) stay in English and are not translated. After changing English text, run:

```bash
npm run i18n -- extract
```

and commit the updated `src/locales/en.json`; `npm test` fails if it is out of date. Translations of changed English are marked stale and fall back to English until they are updated.

**Maintainers.** Machine-translate new and changed messages (needs `OPENROUTER_API_KEY`; costs cents) and apply reviewers' files:

```bash
npm run i18n -- translate de
npm run i18n -- import ~/Downloads/ore-translation-de-2026-11-11-name.json
npm run i18n -- check
npm run build
```

`translate` also rates each new draft as a quick check, read-it or careful-review item (`npm run i18n -- classify de` rates unrated drafts and `classify de --all` re-rates every draft; GPT-6.1 Sol via OpenRouter), which the review page uses to sort and to offer bulk approval of routine labels. It never overwrites reviewed text without keeping it in a note, and `import` skips entries whose English has changed since the review. `npm run build` also refreshes the review page's data in `docs/translate/data/`, so commit those files to publish new messages for review. To add a language, add it to `SUPPORTED_LOCALES` and `LOCALE_NAMES` in `src/shared/i18n.ts`, to `LANGUAGE_NAMES` in `scripts/i18n/translate.ts` and `scripts/i18n/classify.ts`, to the review page's `LANGUAGES`, and to the glossary. `npm run watch` builds the catalogs once at start; restart it after editing `src/locales/`.

## Open a pull request

Target `main`, keep the change focused, and link the issue where applicable. Explain the user-visible problem and resulting behaviour, list the checks you ran, and include before/after screenshots for visual changes. State any checks you could not run. Avoid unrelated formatting or dependency changes.

Changes to visual fixtures, screenshots, or capture setup (including `package.json` or `manifest.json`) need visual approval. After the Visual evidence bot posts, ask a maintainer with write access to comment `visuals ok`; a fork author’s comment cannot approve the visuals. For a fork PR with changed screenshots, a maintainer must also move the branch into this repository so the workflow can commit baselines.

Maintainers review scientific interpretation, privacy, compatibility, and test results before merging. Release creation and store publication are maintainer responsibilities; contributors do not need release credentials or production access.
