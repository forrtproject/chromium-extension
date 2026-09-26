# Live publisher check

Loads real article pages in Chrome for Testing with the built extension, and records what ORE did on each one.

```bash
npm run build
npm run test:live -- --top=20                   # the 20 domains with the most FReD DOIs
npm run test:live                               # every domain (several hours)
npm run test:live -- --refresh                  # rebuild the domain list from FReD, then run
npm run test:live -- --only=www-nature-com,psycnet-apa-org
npm run test:live -- --headless                 # no window; most publishers will block it
```

## Which pages are tested

`publishers.json` lists one page per website that hosts papers in the FORRT Replication Database. `--refresh` rebuilds it:

1. Downloads `output/flora.csv` from [forrtproject/FReD-data](https://github.com/forrtproject/FReD-data) (`--csv=<file>` uses a local copy instead).
2. Collects every original and replication DOI.
3. Looks up each DOI's registered landing page through the DOI system (`doi.org/api/handles`), without visiting publisher sites. Results are cached in `tests/live/.cache`, so later refreshes only look up new DOIs.
4. Groups the DOIs by website. Redirect services such as `linkinghub.elsevier.com` count as the site they lead to.
5. Picks, for each website, the original study with the most replications, and tests its `https://doi.org/…` link.

The list is sorted by how many FReD DOIs each website hosts. Entries added by hand, for websites FReD does not point to, are kept on refresh.

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

A page that fails, finds no DOI, times out or errors is tried once more before it is reported.

## Bot checks

Several publishers block automated browsers, and nearly all of them block headless ones. The runner does not try to get around this. By default it opens a visible Chrome window, and when a check appears it waits 20 seconds, which is enough for checks that clear themselves or that you click through. If the check is still there, the page is recorded as Blocked and the run moves on. `--check-wait=<seconds>` changes the wait; `--check-wait=0` skips it. Headless runs never wait.

The browser profile is kept in `tests/live/.profile`, so checks you have cleared and your cookie choices carry over to the next run. Use `--profile=<dir>` to keep it somewhere else, or delete the folder to start fresh. `--headless` runs without a window and is used automatically on CI.

The runner waits a few seconds between pages. Keep runs small and infrequent anyway: repeated runs can get your IP address blocked by a publisher's security service for a while.

## Contact email

Set `ORE_TEST_EMAIL` to send a contact address with the API requests ORE makes, as a normal install does. Without it, open-access lookups stay off.
