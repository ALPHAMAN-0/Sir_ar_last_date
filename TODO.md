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

## Not done
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
- Similarity: token-level comparison for edited copies, a "starter repo" field,
  comparing the commit at the deadline (see "Open questions" in SIMILARITY.md).
- By-date screen across all people, inline diff viewer, fork-aware logic,
  per-row deadlines, access code, private repos, auto-deploy on push.
