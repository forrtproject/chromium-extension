# Visual regression harness

Renders FLoRA's on-page UI in a **real browser with the real built extension**
and pixel-diffs full-page screenshots against committed baselines. It exists
because placement of the injected pills/badges is the top source of bug
reports, and those bugs only show up in a rendered layout — not in unit tests.

The harness loads the actual MV3 extension into **Chrome for Testing**, serves
fixture pages over `http://127.0.0.1`, waits for FLoRA to finish injecting, and
captures the page. Everything the extension would fetch is mocked, so pass/fail
never depends on the network.

The browser runs **headless** (`headless: true`), which loads MV3 extensions and
renders pixel-for-pixel the same as a headful window — no window opens while the
tests run.

## Running

```bash
npm run build            # dist/ must exist — the extension is loaded from the repo root
npm run test:visual        # compare against baselines; exits 1 on any diff
npm run test:visual:update # regenerate baselines (after an intentional UI change)
```

On first run the harness auto-installs its pinned Chrome for Testing version into the default
puppeteer cache (`~/.cache/puppeteer`, **outside the repo**). Nothing is written
into the working tree except baselines (on update) and `output/` (on failure).

### First-run note (macOS)

`@puppeteer/browsers` occasionally extracts the Chrome `.app` bundle without its
`Frameworks/` symlinks, and the browser then fails to launch
(`dlopen … Framework: no such file`). If that happens, re-extract the cached zip
with macOS `ditto`, which handles app bundles correctly:

```bash
cd ~/.cache/puppeteer/chrome
rm -rf mac_arm-*/chrome-mac-arm64
ditto -x -k *.zip mac_arm-<version>/
```

## What gets tested

14 fixtures (viewport 1280×900, `deviceScaleFactor` 1):

| Fixture | Exercises |
| --- | --- |
| `ref-list-flex` | Reference list as flex rows with action links |
| `ref-list-grid` | Reference list in a two-column CSS grid |
| `table-bibliography` | `<table>`-based bibliography |
| `rtl-article` | `dir="rtl"` Arabic article with DOIs (pill mirroring) |
| `editor-textarea` | `contenteditable` editor + `<textarea>` with DOIs |
| `long-article-sticky` | Long article, sticky header + fixed footer, side panel |
| `shared-block-anchor` | Several matched DOIs sharing one block anchor (one badge each) |
| `article-with-dois` | Reused unit fixture — meta DOI + doi.org ref links |
| `doi-in-href` | Reused — DOI only in a link href |
| `doi-in-table` | Reused — DOI in a cell / prose inside a table |
| `doi-in-text` | Reused — DOI in running prose |
| `retracted` | Reused — Springer article page, notice beside the DOI-bearing masthead link |
| `publisher-styled-link-row` | Reference row whose publisher styling (separator borders) must stay off the pill |
| `provider-unavailable` | Article when replication and notice providers are unavailable |

Each fixture uses DOIs seeded to a known state (has replications, reproductions,
retracted, expression of concern, or no data) so the injected UI is fully
determined by the mocks.

## How the mocks work (hermetic)

Two mechanisms, both in `mocks.ts`, guarantee no real network dependence:

1. **Pre-seeded `chrome.storage`.** Before any fixture loads, the harness writes
   into the service worker's storage via `worker.evaluate(() => chrome.storage…)`:
   - **FLoRA replication cache** — the worker caches lookups through
     `LocalCache` (prefix `"flora"`); entries are `{"flora:<doi>": {data, expiresAt}}`
     (see `src/shared/cache.ts`). Every fixture DOI is seeded, so each lookup is a
     cache hit and the FORRT rep-api is never called.
   - **Retraction map** — stored under `RET_MAP_KEY` (`"RetractionLookupLocal"`,
     `src/shared/data-extract.ts`) as `{retractions, concerns}`, mapping the
     retracted / concern fixture DOIs to notice DOIs. `synctime` is set to "now"
     so the weekly GitHub sync never fires.
   - **Settings** — `flora_settings` in `chrome.storage.sync` with an email set,
     so `isSetupComplete()` is true and the setup prompt never overlays a
     screenshot.
   - **Page-side `BlobCache`s** (`chrome.storage.local`): doi.org validation
     (`flora_doival_blob`), PubPeer (`flora_pubpeer_blob`), and Unpaywall Open
     Access (`flora_oa_blob`) — one entry per fixture DOI, so the content
     script's own lookups are also cache hits.

2. **Request interception.**
   - **Page context** (`page.setRequestInterception`): localhost is allowed; the
     doi.org Handle API, PubPeer POST, and Unpaywall are served canned JSON; any
     other external request is aborted.
   - **Worker context**: every http(s) request the service worker makes to
     anything but the local fixture server (FORRT rep-api, Crossref, OpenAlex,
     the GitHub retraction sync, Google Docs, PMC, …) is failed via a CDP
     `Fetch` session attached to the `service_worker` target — page-level
     interception does not cover worker requests. The extension's own packaged
     resources pass through.

The retraction map + settings are re-seeded immediately before each fixture as
insurance against a stray install-time sync.

## Determinism

- **One raster path.** macOS Chrome flaps between GPU and software
  rasterisation across page loads, which shifts the anti-aliasing of *every
  glyph* on the page — runs would pass or fail different fixtures at random
  with whole-page text diffs (~0.2–2 % of pixels). The launch flags pin a
  single software raster path: `--disable-gpu` (the primary fix) plus
  `--disable-gpu-compositing --force-device-scale-factor=1
  --disable-font-subpixel-positioning --disable-partial-raster
  --disable-skia-runtime-opts`.
- **Viewport capture where the page fits.** `fullPage` on a `dir="rtl"`
  document captures from the wrong horizontal origin — content comes out
  shifted right and clipped at the right edge even though nothing overflows
  the viewport, which hid every RTL placement the fixture exists to check.
  The harness captures the viewport directly whenever the page already fits
  in it, and falls back to `fullPage` only for the taller fixtures.
- Rendering flags: `--force-color-profile=srgb --hide-scrollbars
  --disable-lcd-text --font-render-hinting=none`.
- A stylesheet injected after load disables all animations/transitions, hides the
  caret, and removes the transient "scanning" toast.
- Fixtures use an explicit system font stack and load no external
  fonts/images/scripts; `document.fonts.ready` is awaited before capture.
- After navigation the harness polls the injected FLoRA selectors
  (`.flora-indicator-pill, .flora-notice-pill, #flora-pubpeer-panel`)
  until their contents and geometry are stable for 700 ms, at least one
  element exists, and the work toast is gone, then waits a short settle.
  Failure to reach this state within 12 seconds fails the fixture.

Stability bar: after regenerating baselines, `npm run test:visual` must report
**0 px difference on every fixture across five consecutive runs** before the
baselines are committed.

Local comparison uses `pixelmatch` at a per-pixel threshold of `0.1`; a fixture fails
if more than **100 pixels** differ. The budget is an absolute count so that it
stays meaningful on a tall full-page shot, where a percentage would leave room
for a whole pill to move. On failure the actual and diff images are written to
`output/` (gitignored).

## Baselines are platform-specific

Baselines in `baselines/` were rendered on **macOS**. Font rasterisation differs
across operating systems, so baselines generated on macOS will not match a Linux
CI run pixel-for-pixel. Local comparisons need baselines generated on the same
platform; CI uses its own base/head captures for PR review.

## Updating baselines

For local work, `npm run test:visual:update` regenerates `baselines/`. The
renders are staged in a temporary directory and copied in only when every
fixture succeeds. CI commits approved baseline updates to the PR itself, as
described below. A local update is useful while editing a fixture; it is not
a step in the PR confirmation flow.

## PR visual review flow

1. **Capture.** `Visual evidence` builds the PR base and head on the same
   Ubuntu runner and renders both with the PR's fixtures and pinned Chrome
   152.0.7977.75. The trusted publisher posts base/PR captures and any setup
   diff link directly in the PR conversation. Inspect those images for
   placement, clipping, readability and missing indicators. The
   `visual-report` artifact is a machine handoff and troubleshooting aid.
2. **Confirm.** After all evidence comments for the current PR head and
   capture attempt are present, the PR author or another collaborator with
   write access posts a PR conversation comment containing exactly
   `visuals ok` (case and surrounding whitespace are ignored). A thumbs-up
   reaction, PR review approval or checkbox does not count. A later
   `visuals not ok` from a write collaborator blocks confirmation. Editing
   or deleting the confirming comment revokes it. New evidence after a code
   change needs a new comment.
3. **Commit approved captures.** If base and PR renders differ, the trusted
   action commits the approved PR captures as
   `tests/visual/baselines/<fixture>.png` on that same-repository PR branch
   and posts a commit link. The author does not run a local baseline update
   or make this commit by hand.
4. **Verify.** The action explicitly starts another `Visual evidence` run
   because its own token's branch push does not start the PR workflow. The
   publisher compares that run's actual PNG bytes with the committed PNGs.
   The required `Visual approval` check succeeds only when the capture
   succeeds, the images match, and the confirming comment remains valid. A
   mismatch posts new evidence for review; a failed capture fails the check.
   If review concerns setup or committed images but the captures do not
   differ, the comment clears the check without an extra commit.

Automatic baseline commits need a PR branch in this repository. For a fork
PR with changed captures, move the branch here to use this flow. PRs with no
visual or capture setup changes pass `Visual approval` automatically.

### What CI compares

Committed macOS baselines do not determine CI results. Changes to committed
baseline PNGs cannot hide a change between the actual base and head builds.
Both link-only and text-only DOI fixtures now contain real reference layouts;
the old minimal unit fixtures produced no visible extension UI.

The capture waits for nonempty extension UI, stable contents and geometry,
and removal of the work toast. A timeout is a failure, including in update
mode. This is a readiness guard, not a claim that every async interaction is
covered. Popovers, keyboard interaction, popup/options, search-site layouts,
and narrow viewports still need additional visual scenarios.

The visual review gate uses exact raw RGBA equality: even a one-channel change
within the local perceptual budget requires visual approval.

CI stores before/after PNGs, diff images and JSON results in the
`visual-report` artifact. The publisher stores images on the
`visual-evidence` branch for inline PR comments. Added or modified committed
screenshots appear as images from the two commits. When only capture setup
changed, the comment shows representative pages and links to the setup diff.
Large reviews may span several comments.

The publisher runs only default-branch code, validates artifact data and
image files, and checks the PR head and repository before posting. It stores
generated images in an immutable commit on the `visual-evidence` branch and
embeds them from GitHub in the PR comment. Relevant `issue_comment` events
update the status directly, including on fork PRs.
When review is required, the status links to the PR comment. If the PR's file listing is incomplete,
review remains required. Changes to visual fixtures, capture/publisher
workflows, the publisher script, package manifests/lockfile, build
configuration or extension manifest also require review.

`Visual approval` is a required status check for `main`. A pending visual
confirmation blocks merging.

For local base/head captures, the harness also accepts `VR_REPO_ROOT` (built
extension root), `VR_BASELINE_DIR`, and `VR_OUTPUT_DIR`. `--review` treats pixel
changes as reviewable evidence while still failing capture errors. These are
optional; the existing local comparison/update commands still work.

Changed committed baseline PNGs require review even when the base and PR builds
render identically with the new fixture catalogue. A PR cannot weaken its own
capture and use an all-pass artifact as evidence that review is unnecessary.
