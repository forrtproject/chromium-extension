# Visual regression tests

Most bug reports are about where FLoRA places its pills and badges on a page.
Unit tests cannot see layout, so these tests load the built extension into a
real browser, open fixture pages, take screenshots and compare them pixel by
pixel.

On a pull request, CI compares the PR build with the base build. A person
looks at any changed screenshots and confirms them with a PR comment.

## Run locally

```bash
npm run build         # the extension is loaded from the repo root, which needs dist/
npm run test:visual   # render every fixture and compare with tests/visual/baselines/
```

The baselines are Ubuntu renders from CI. Text renders differently on macOS
and Windows, so there every fixture shows pixel differences. On those systems
`npm run test:visual` writes a report to `tests/visual/output/index.html`
with base, new and diff images side by side, and exits 0. It fails only if a
fixture cannot be captured. On Linux it exits 1 when a fixture differs by
more than 100 pixels.

`npm run test:visual:update` replaces the baselines. It runs only on Linux,
so baselines always come from the same system. To update them, use the
`Visual baselines` workflow (see [Baselines](#baselines)).

The first run downloads Chrome for Testing 152.0.7977.75 into
`~/.cache/puppeteer`. Installed Chrome cannot be used because it ignores
`--load-extension`. The browser runs headless, so no window opens.

Each run writes `<fixture>.actual.png`, `<fixture>.before.png`, a
`<fixture>.diff.png` for every changed fixture, and `results.json` to
`tests/visual/output/` (gitignored).

If Chrome fails to start on macOS with `dlopen … Framework: no such file`, the
download was unpacked without its framework symlinks. Unpack it again with
`ditto`:

```bash
cd ~/.cache/puppeteer/chrome
rm -rf mac_arm-*/chrome-mac-arm64
ditto -x -k *.zip mac_arm-152.0.7977.75/
```

## Fixtures

Every page is captured at 1280×900. Pages taller than the viewport are
captured full-page. Pages that fit are captured as the viewport only, because
Chrome's full-page capture shifts `dir="rtl"` pages sideways.

| Fixture | Page |
| --- | --- |
| `provider-unavailable` | PubPeer and Unpaywall return 503. The test clicks the pill and captures the open popover. |
| `pubmed-results` | PubMed results page with FLoRA panels on two rows |
| `openalex-results` | OpenAlex results page with FLoRA panels on two rows |
| `openalex-record-after-results` | The OpenAlex results page switches to a record page in the same tab, and the record gets a title pill |
| `ref-list-flex` | Reference list built from flex rows with action links |
| `ref-list-grid` | Reference list in a two-column CSS grid |
| `table-bibliography` | Bibliography in a `<table>` |
| `rtl-article` | Arabic article with `dir="rtl"` |
| `editor-textarea` | `contenteditable` editor and a `<textarea>` that contain DOIs |
| `long-article-sticky` | Long article with a sticky header, fixed footer and side panel |
| `shared-block-anchor` | Several DOIs in one block, one badge each |
| `publisher-styled-link-row` | Reference row with publisher separator borders that must not reach the pill |
| `doi-in-href` | Reference list where DOIs appear only in link `href`s |
| `doi-in-text` | Reference list where DOIs appear only as plain text |
| `article-with-dois` | Article with a meta-tag DOI and doi.org reference links |
| `doi-in-table` | DOIs in table cells and in prose inside a table |
| `retracted` | Springer article page with a retraction notice next to the masthead DOI |

The last three pages are unit-test fixtures from `tests/fixtures/`. The others
are in `tests/visual/fixtures/`. Article pages are served from `127.0.0.1`.
The PubMed and OpenAlex pages are saved HTML, served at the real site URL, so
Chrome injects the site-specific content script. They may need to be saved
again when those sites change their HTML.

To add a fixture, add the HTML file, add an entry to `FIXTURES` in `run.ts`,
and seed its DOIs in `mocks.ts`. The page must show FLoRA UI, or the capture
times out and fails.

## No network access

Every lookup is answered locally, so results never depend on live services.

- **Seeded storage.** Before the first page loads, `run.ts` writes the
  contents of `mocks.ts` into the service worker's `chrome.storage`: FLoRA
  replication results for every fixture DOI, the retraction and
  expression-of-concern map, the doi.org, PubPeer and Unpaywall caches, and
  settings with an email address so the setup prompt does not appear. The
  retraction map and settings are written again before each page, in case a
  background sync replaced them.
- **Page requests.** The doi.org handle API, PubPeer and Unpaywall get canned
  JSON responses. Requests to `127.0.0.1` pass. All other requests are aborted.
- **Service worker requests.** A DevTools `Fetch` session on the worker
  answers the OpenAlex ID lookup for the two saved OpenAlex rows. It fails
  every other http(s) request that does not go to `127.0.0.1`. The
  extension's own packaged files load normally.

The `provider-unavailable` DOI is not seeded, so its lookups hit these blocks
and the page shows the "unavailable" state.

## Stable pixels

- Chrome starts with `--disable-gpu` and related flags. Without them, macOS
  Chrome switches between GPU and software rendering between page loads, and
  the text anti-aliasing changes across the whole page.
- After load, a stylesheet turns off animations, transitions and the text
  caret, and hides the "scanning" toast.
- Before the screenshot, the harness waits for fonts to load. Then it waits
  until FLoRA's pills and panels exist and have not changed for 700 ms. If
  that does not happen within 12 s, the fixture fails. The search fixtures
  also fail if the number of FLoRA panels differs from the expected count.
- On Linux, a local compare fails a fixture if more than 100 pixels differ
  (pixelmatch threshold 0.1). A fixed count catches a moved pill on a tall page, where a
  percentage would not. CI uses exact equality instead.

## Pull requests

1. **Capture.** The `Visual evidence` workflow (`visual.yml`) builds the base
   branch and the PR on the same Ubuntu runner. It renders both with the PR's
   harness and fixtures and compares them pixel for pixel. The committed
   baselines play no part in this comparison.
2. **Post.** The `Attach visual evidence` workflow (`visual-publish.yml`)
   runs `.github/scripts/visual-publish.cjs` from `main`. It posts a PR
   comment with base and PR screenshots for every changed fixture. The images
   are stored on the `visual-evidence` branch.
3. **Confirm.** The PR author or another collaborator with write access
   checks the images and posts a comment that contains exactly `visuals ok`.
   A later `visuals not ok` blocks the PR. Editing or deleting the
   `visuals ok` comment withdraws it. A new commit needs a new confirmation.
4. **Commit.** If any fixture changed, the action commits the PR's
   screenshots to `tests/visual/baselines/` on the PR branch. It then starts
   a new capture and checks that the committed PNGs match it.

The required `Visual approval` status on `main` is green when nothing needs
review, or when the capture succeeded and a valid `visuals ok` exists. It is
red if the capture failed.

Review is needed when:

- any fixture renders differently on the PR,
- the PR changes images in `tests/visual/baselines/`, `docs/img/` or
  `assets/icons/`, or
- the PR changes the capture setup: other files in `tests/visual/`, the three
  reused fixtures, the visual workflows and publisher,
  `scripts/docs-screenshots.ts`, `scripts/make-icons.ts`, `package.json`,
  `package-lock.json`, `esbuild.config.ts`, `manifest.json`,
  `tsconfig*.json` or `.npmrc`. A PR controls its own capture. Without this
  rule, a PR could weaken the capture and then report no changes.

If the base build cannot capture a fixture, CI keeps the other base renders.
The PR comment shows that fixture's PR screenshot alone, with one of two
reasons:

- **New fixture: the base build shows no FLoRA UI on it.** The fixture has no
  committed baseline on the base branch. This is expected when a PR adds a
  fixture for a new feature.
- **No base image: the base capture failed on this existing fixture.** The
  fixture has a baseline on the base branch, so it rendered before. Check
  the error in brackets before confirming.

The action can only commit to branches in this repository. For a fork PR
with changed screenshots, move the branch into this repository.

`.github/workflows/test.yml` runs the publisher's tests with
`node --test tests/visual/publisher.test.cjs`.

## Baselines

All baselines are Ubuntu renders from CI. They get there in two ways:

- **Through a PR.** After `visuals ok`, CI commits the PR's screenshots of
  the changed fixtures (step 4 above).
- **With the `Visual baselines` workflow** (`visual-baselines.yml`). It renders
  all fixtures and commits every PNG. Start it from the Actions tab or with
  `gh workflow run visual-baselines.yml`. With `-f pr=<number>`, it commits to
  that PR's branch. Without it, it opens a new PR from `main`. Either way, the
  PR then needs a `visuals ok` comment.

`test:visual:update` renders all fixtures into a temporary folder. It copies
them into `baselines/` only if every fixture succeeds.

## Files

| File | Purpose |
| --- | --- |
| `run.ts` | Starts Chrome, seeds storage, captures and compares each fixture |
| `mocks.ts` | Fixture DOIs, storage seeds and request rules |
| `server.ts` | Static server for the article fixtures |
| `report.ts` | Builds `index.html` from an output folder |
| `publisher.test.cjs` | Tests for `.github/scripts/visual-publish.cjs` |
| `baselines/` | Reference screenshots (Ubuntu renders from CI) |
| `fixtures/` | Fixture pages for these tests |

CI uses these options to capture two builds:

- `VR_REPO_ROOT`: extension folder to load.
- `VR_BASELINE_DIR`, `VR_OUTPUT_DIR`: where baselines are read or written, and
  where results go.
- `VR_BASE_ROOT`, `VR_BASE_RESULTS`: base checkout and base `results.json`.
  They are used to explain a missing base image.
- `--review`: a pixel difference exits 0, so only capture errors fail the run.
- `--partial` (with `--update`): keep the renders that succeed.
