# Sir_ar_last_date — work status

Updated 2026-10-06. The app is built and online at
https://sir-ar-last-date.sir-last-date.workers.dev, including the similarity
rewrite (deployed 2026-10-06, version 4f73fa07).

## Done
- [x] Server (`worker/`): GitHub client with quota reserve and back-off, six routes,
      request validation, cache headers, per-visitor rate limits.
- [x] Sheet reader, column detection and column picker.
- [x] The status rule (On time / Changed after deadline / Late / No submission / Not found).
- [x] Push time for every commit, and the timeline with the deadline line.
- [x] Screens: upload, register table (sort, filter, search), person timeline with
      changed files, phone layout, dark mode.
- [x] Excel export in the on-screen order.
- [x] Security headers (`public/_headers`), strict Content-Security-Policy.
- [x] Similarity tab: identical files by content, starter files, people who handed in
      the same repo, and a six-sheet `.xlsx` report (see README).
- [x] Deployed to Cloudflare Workers on 2026-10-05 (before the similarity rewrite).
- [x] Similarity checked end to end on a local Worker against real GitHub: the demo
      sheet, 16 real repos (one with 6,232 files) and 55 forks of one repo, on the dev
      server and on the production build. No console errors, no CSP violations.
- [x] Similarity rewrite committed.
- [x] Tests for the store (`src/state/store.test.ts`): loading in batches, splitting a
      failing batch, dropping late answers, push-log paging, refresh, saving in the browser.
- [x] Screen tests (`src/components/*.test.tsx`, jsdom + Testing Library).
- [x] CI on GitHub Actions: lint, tests and build on every push and pull request.
- [x] `npm run coverage`; coverage output is no longer committed.
- [x] README with diagrams.
- [x] Deployed 2026-10-06 and checked live: security headers present, edge cache
      answers a repeat (`cf-cache-status: HIT`), `/api/v1/tree` works, an uncached
      request from another site gets 403, and the token is in no response and no
      built file.
- [x] Similarity, "who had it first" (2026-10-07): for each pair, which repo had the
      shared files on GitHub first, from the push log and the files at each pushed
      commit; a repo is named only when that is clear, otherwise "Cannot tell". New
      column, evidence in the opened pair, and a seventh sheet in the report (see README).
      Checked in a headless browser with a faked API and with this repo's real push log.
- [x] Results report (2026-10-07): the Notes columns are gone, and a First push date
      stands between Repo created and Last push. It is read when Download is pressed,
      the same way the person screen reads it (see README, "The results report").
- [x] Results report (2026-10-08): a **Commits by person** column after Branch, who
      committed on the main branch with their commits and share, merges included and
      shown. Read when Download is pressed, after the first pushes, from the same commit
      lists the person screen uses (see README, "The results report").
- [x] Padding commits (2026-10-08): the Worker says per file whether the text changed
      beyond whitespace (judged from the diff, which still never leaves the Worker);
      "Check commits" on the Register reads the files of every commit on screen (newest
      200 per repo) and the report tells real, tiny, only-whitespace and empty commits
      apart per person, with a "Padding commits" number column; the person screen tags
      each commit and sums them up per person (see README, "The results report").

## Not done
- [ ] Go online from GitHub Actions only when the tests pass (2026-10-07). The
      `deploy` job is written (`.github/workflows/ci.yml`; README, "Put it online").
      Still to do, in this order: add the `CLOUDFLARE_API_TOKEN` secret on GitHub,
      watch one push go online through the job, then disconnect the repo under the
      Worker's **Settings > Builds** at Cloudflare. That connection deploys every
      push without waiting for the tests: commit `94c21d7` went online on
      2026-10-06 with 4 failing tests.
- [ ] Run "who had it first" once on the local Worker with a real token. Everything
      else was checked without one; this is the only check of the new `parent` and
      `templateRepository` fields against GitHub itself (their names were checked
      against GitHub's published schema).
- [ ] The per-visitor rate limiter did not trigger on the live site: 107 different
      `/repos` requests from one address in under a minute (limit 40) all got 200.
      Cloudflare calls the limiter "permissive, eventually consistent", but 2.7x is
      a lot. Find out why. Until then the quota reserve (stop at 500 left) is the
      only brake, so one visitor could use up the hour for everyone.
- [ ] Test the register against real GitHub with a deadline (expected: AboutMe reads
      "Changed after deadline" for a deadline of 2026-09-25 13:00 Dhaka time; a private
      repo reads "Not found").
- [ ] Choose a license if the repo is or becomes public.

### Later, by choice
- Similarity: a "starter repo" field, comparing the commit at the deadline, a
  direction between two forks of one starter repo, and reading on past 40 pushes
  for a repo that grew slowly (see "Open questions" in SIMILARITY.md). A
  token-level comparison for edited copies was considered on 2026-10-07 and
  decided against.
- By-date screen across all people, inline diff viewer, fork-aware logic,
  per-row deadlines, access code, private repos.
