# Dev channel — automatic updates for testers

Testers install once. After that every push to `main` reaches them on its own:
no zip to download, no folder to unpack, no **Reload** button in
`chrome://extensions`.

It works by self-hosting the two things Chrome's own update mechanism wants — a
signed `.crx` and an `updates.xml` that names its version — as assets on a
rolling `dev-latest` prerelease, and pointing Chrome at them.

## Why testers need a one-time setup step

Chrome has refused to install a `.crx` dragged in from outside the Web Store
since Chrome 33. There is no flag or preference that re-enables it. The
supported route for an extension you host yourself is Chrome's enterprise
policy layer: a tester registers this extension's id and update URL once, and
from then on Chrome treats it like any other managed extension — it installs it,
polls for new versions, and applies them silently.

That one file is the whole tester burden, and it never has to be repeated.

## Maintainer setup (once)

1. **Create the signing key.** It defines the extension's identity: every future
   build must be signed with the same key or Chrome sees an unrelated extension
   and stops updating.

   ```bash
   openssl genrsa -out flora-dev.pem 2048
   ```

2. **Back it up somewhere durable** (a password manager, not the repo). `*.pem`
   is gitignored. Losing it means every tester has to install the channel again
   under a new id.

3. **Add it as a repository secret** named `CRX_PRIVATE_KEY` — Settings →
   Secrets and variables → Actions → New repository secret. Paste the file's
   full contents, `-----BEGIN…` line included.

4. **Check the identity it produces**, so you can recognise it in
   `chrome://extensions`:

   ```bash
   CRX_KEY_FILE=flora-dev.pem npm run crx:id
   ```

   ```
   extension id   : hfpimbdklaliabelnggnpbmmadgojdpa
   manifest "key" : MIIBIjANBgkq…
   ```

   The `manifest "key"` line is optional: adding it to `manifest.json` as
   `"key"` makes your *unpacked* local build share the packed build's id. Handy,
   but skip it unless you want that — it has no effect on the update flow.

Until `CRX_PRIVATE_KEY` exists the workflow skips itself and says so in the run
summary, so `main` stays green in the meantime.

## What happens on each push to `main`

`.github/workflows/dev-channel.yml` runs the test suite, builds, packs, and
replaces the assets on the `dev-latest` prerelease. It refuses to publish a
build whose tests fail.

Versions are stamped `<manifest version>.<run number>` — `0.1.0.83` — so they
increase monotonically (Chrome only installs an update whose version is
strictly higher) and always sort below the next real release: `0.1.0.83` is
older than `0.1.1`. When you cut a real release, bump `manifest.json` and dev
builds follow along.

Published assets:

| Asset | What it is |
| --- | --- |
| `flora-dev.crx` | The signed build Chrome installs |
| `updates.xml` | The manifest Chrome polls; names the current version |
| `flora-dev-channel-windows.reg` | Tester setup, Windows |
| `flora-dev-channel-macos.mobileconfig` | Tester setup, macOS |
| `flora-extension.zip` | Plain unpacked build, for hand-loading |

Their URLs are stable — `…/releases/download/dev-latest/updates.xml` always
resolves to the newest one — which is what lets a tester's setup keep working
without ever being touched again.

## Tester instructions

Both files are on the [dev-latest
release](https://github.com/forrtproject/flora-chromium/releases/tag/dev-latest).

**Windows** — download `flora-dev-channel-windows.reg`, double-click it, accept
the warning, and restart Chrome. (It writes one key under
`HKEY_CURRENT_USER\SOFTWARE\Policies\Google\Chrome\ExtensionSettings` — no
admin rights needed.)

**macOS** — download `flora-dev-channel-macos.mobileconfig`, double-click it,
then approve it in System Settings → Privacy & Security → Profiles, and restart
Chrome.

FLoRA then appears in `chrome://extensions` on its own, labelled as installed by
policy. It can be disabled but not uninstalled from that page — see *Leaving the
channel* below.

**When updates arrive:** Chrome checks the update URL roughly every five hours,
so a new build lands within that window. To pull one immediately, open
`chrome://extensions`, turn on **Developer mode**, and click **Update**.

**Tabs already open** when an update applies keep running the old content script
until they're refreshed. New page loads get the new build.

### Leaving the channel

- **Windows:** delete the `…\ExtensionSettings\<extension id>` registry key
  (`regedit`, or `reg delete`), then restart Chrome.
- **macOS:** remove the *FLoRA dev channel* profile in System Settings →
  Privacy & Security → Profiles, then restart Chrome.

Chrome uninstalls the extension when the policy goes away.

## Caveats worth knowing

- **Corporate-managed machines** may ignore user-level policy, or block
  extension policies outright. Those testers fall back to
  `flora-extension.zip` and **Load unpacked**.
- **Chromium forks** use their own policy locations — Edge reads
  `…\Policies\Microsoft\Edge`, Brave `…\Policies\BraveSoftware\Brave-Browser`.
  The same two values work; only the path changes.
- **Every push to `main` ships.** Feature branches don't, so branch work stays
  private to you until it merges. If you'd rather testers only got tagged
  builds, change the workflow's trigger to `push: tags`.
- **The signing key is the channel.** Rotating it orphans every existing
  installation.

## The alternative: an unlisted Web Store listing

Uploading the same build to the Chrome Web Store as **Unlisted** removes the
policy step entirely — testers install from a link like any normal extension,
and updates are handled by Google. It costs a one-time $5 developer
registration, and each version waits on review (usually hours, occasionally
days, and `<all_urls>` permissions draw closer scrutiny). The Web Store API can
be driven from CI the same way this workflow is.

Worth switching to if the tester group grows beyond people you can hand a file
to, or if the policy step proves to be a support burden. For a fast loop with a
handful of testers, self-hosting wins on latency: a build is live the moment CI
finishes.
