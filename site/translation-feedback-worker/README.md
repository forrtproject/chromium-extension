# Translation feedback relay

Cloudflare Worker that lets people without a GitHub account send feedback from
https://forrt.org/chromium-extension/translate/feedback/ (`docs/translate/feedback/`).
It checks Cloudflare Turnstile, a hidden honeypot field and a per-IP limit
(5 a minute), then posts the message to
issue #295 as a GitHub App. Mentions, issue references, images and HTML in the
message are neutralised before posting.

`GET /comments` serves the issue and its comments to the page, read with the
app's token (5,000 requests an hour) and cached for 60 seconds, so visitors
don't run into GitHub's limit of 60 anonymous reads an hour.

The sender's email is never posted. It is stored in the `CONTACTS` KV namespace
under `comment:<comment id>` and expires after a year.

## One-time setup

1. **GitHub App** (needs an owner of the forrtproject organisation)
   - Organisation settings → Developer settings → GitHub Apps → New GitHub App.
   - Name: `ORE translation feedback`. Homepage URL: `https://forrt.org/chromium-extension/translate/feedback/`.
   - Webhook: untick **Active**.
   - Repository permissions: **Issues: Read and write**. Nothing else.
   - Where can it be installed: **Only on this account**.
   - Create it, note the **App ID**, then **Generate a private key** (downloads a `.pem`).
   - Install App → forrtproject → **Only select repositories** → `chromium-extension`.

2. **Turnstile** (Cloudflare dashboard → Turnstile → Add widget)
   - Hostname: `forrt.org`. Mode: Managed.
   - Note the **site key** and the **secret key**.

3. **Deploy the Worker** (from this folder)

   ```sh
   npx wrangler login
   npx wrangler kv namespace create CONTACTS   # paste the printed id into wrangler.toml
   npx wrangler secret put GITHUB_APP_ID
   npx wrangler secret put GITHUB_APP_PRIVATE_KEY < path/to/app.private-key.pem
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler deploy
   ```

   `deploy` prints the Worker URL, e.g. `https://ore-translation-feedback.<account>.workers.dev`.

4. **Turn the form on**: in `docs/translate/feedback/index.html` set

   ```js
   const FEEDBACK_ENDPOINT = "https://ore-translation-feedback.<account>.workers.dev/feedback";
   const TURNSTILE_SITEKEY = "<site key>";
   ```

   then commit and merge to main; GitHub Pages publishes `docs/`.

## Finding who sent a comment

Every comment's link ends in `#issuecomment-<id>`. From this folder:

```sh
npx wrangler kv key get --binding CONTACTS --remote "comment:<id>"
npx wrangler kv key list --binding CONTACTS --remote   # everyone, with name, email and language
```

The same list is under Cloudflare dashboard → Storage & Databases → KV →
CONTACTS. To delete someone's details on request:
`npx wrangler kv key delete --binding CONTACTS --remote "comment:<id>"`.

Delete the downloaded `.pem` once it is stored as a secret. To stop the relay,
uninstall the GitHub App or run `npx wrangler delete`.
