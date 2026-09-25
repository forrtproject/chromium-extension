# Live publisher check

Loads real article pages from `publishers.json` in Chrome for Testing with the built extension, and records what ORE did on each one.

```bash
npm run build
npm run test:live                       # all publishers, in a visible Chrome window
npm run test:live -- --only=pmc,nature  # a subset, by id
npm run test:live -- --headless         # no window; most publishers will block it
```

Results go to `tests/live/output/`:

- `report.html` and `report.pdf`: one row per publisher, plus screenshots of the article, its reference list and the open Meta Report
- `results.json`: the same data, machine-readable
- `snapshots/<id>.html`: the page's HTML after ORE ran, for building offline test fixtures

Each page gets one of these results:

| Result | Meaning |
| --- | --- |
| Pass | ORE marked up the article or its DOIs |
| Fail | The page declares a DOI, but ORE marked nothing up |
| No DOI | Neither the page nor ORE found a DOI |
| Blocked | The site showed a bot check, an empty page or refused access |
| Timed out | ORE showed no activity before the time limit |
| Error | The page could not be loaded |

A page that fails, times out or errors is tried once more before it is reported.

## Bot checks

Several publishers block automated browsers, and nearly all of them block headless ones. The runner does not try to get around this. By default it opens a visible Chrome window, and when a check appears it waits up to two minutes for you to complete it.

The browser profile is kept in `tests/live/.profile`, so checks you have cleared and your cookie choices carry over to the next run. Use `--profile=<dir>` to keep it somewhere else, or delete the folder to start fresh. `--headless` runs without a window and is used automatically on CI.

The runner waits a few seconds between pages. Keep runs small and infrequent anyway: repeated runs can get your IP address blocked by a publisher's security service for a while.

## Contact email

Set `ORE_TEST_EMAIL` to send a contact address with the API requests ORE makes, as a normal install does. Without it, open-access lookups stay off.
