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

## Open a pull request

Target `main`, keep the change focused, and link the issue where applicable. Explain the user-visible problem and resulting behaviour, list the checks you ran, and include before/after screenshots for visual changes. State any checks you could not run. Avoid unrelated formatting or dependency changes.

Changes to visual fixtures, screenshots, or capture setup (including `package.json` or `manifest.json`) need visual approval. After the Visual evidence bot posts, ask a maintainer with write access to comment `visuals ok`; a fork author’s comment cannot approve the visuals. For a fork PR with changed screenshots, a maintainer must also move the branch into this repository so the workflow can commit baselines.

Maintainers review scientific interpretation, privacy, compatibility, and test results before merging. Release creation and store publication are maintainer responsibilities; contributors do not need release credentials or production access.
