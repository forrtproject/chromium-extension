# Translation feedback relay

Cloudflare Worker behind the translation review page,
https://forrt.org/chromium-extension/translate/ (`docs/translate/`, built from
`src/review-page/`). It lets reviewers without a GitHub account take part and
posts on issue #295 as the `ore-translation-feedback` GitHub App.

| Endpoint | What it does |
|---|---|
| `GET /comments` | Issue #295 and its comments for the style-guide panel, read with the app's token and cached for 60 s |
| `POST /review` | A line-by-line review: stored in `REVIEWS` in the import format, with a credited summary posted on #295 |
| `POST /feedback` | Feedback on a language's style guide, optionally ticking its checklist items |

Every POST passes Cloudflare Turnstile, a hidden honeypot field and a per-IP
limit (5 a minute), and only `https://forrt.org` may call it. Mentions, issue
references, images and HTML are neutralised before posting.

The sender's email is never posted. It is stored in `CONTACTS` under
`comment:<comment id>` and expires after a year.

## Applying a review

Each review comment on #295 ends with its key. From this folder:

```sh
npx wrangler kv key get --binding REVIEWS --remote "review:de:…" > review.json
cd ../.. && npm run i18n -- import site/translation-feedback-worker/review.json
```

`npx wrangler kv key list --binding REVIEWS --remote` lists every stored review.

## Finding who sent a comment

A comment's link ends in `#issuecomment-<id>`:

```sh
npx wrangler kv key get --binding CONTACTS --remote "comment:<id>"
npx wrangler kv key list --binding CONTACTS --remote   # everyone, with name, email and language
```

To delete someone's details on request:
`npx wrangler kv key delete --binding CONTACTS --remote "comment:<id>"`.

## Setup (already done; for a fresh account)

1. **GitHub App** (owner of forrtproject): Issues read and write only, webhook
   off, installed only on `chromium-extension`. Store its ID and private key
   with `npx wrangler secret put GITHUB_APP_ID` and
   `npx wrangler secret put GITHUB_APP_PRIVATE_KEY < key.pem`, then delete the `.pem`.
2. **Turnstile** widget for `forrt.org`, managed mode. Put its secret in
   `npx wrangler secret put TURNSTILE_SECRET` and its site key in
   `src/review-page/relay.ts`.
3. **KV**: `npx wrangler kv namespace create CONTACTS` and `… create REVIEWS`;
   put the ids in `wrangler.toml`.
4. `npx wrangler deploy`, and put the Worker URL in `src/review-page/relay.ts`.
