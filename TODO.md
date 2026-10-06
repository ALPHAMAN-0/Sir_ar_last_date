# Sir_ar_last_date — work status

Updated 2026-10-06. The app is built and online. The similarity rewrite of
2026-10-06 was tested against real GitHub on a local Worker; it is in the
working tree but is not committed or deployed yet.

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
- [x] 233 unit tests pass; type-check and lint are clean.
- [x] Deployed to Cloudflare Workers on 2026-10-05 (before the similarity rewrite).
- [x] Similarity checked end to end on a local Worker against real GitHub: the demo
      sheet, 16 real repos (one with 6,232 files) and 55 forks of one repo, on the dev
      server and on the production build. No console errors, no CSP violations.
- [x] README with diagrams.

## Not done
- [ ] Commit the similarity rewrite and run `npm run deploy`. Until then the live site
      still compares file names only.
- [ ] After deploy: confirm an edge cache hit, a 429 from the rate limiter, and that
      the token appears in no response and no built file.
- [ ] Test the register against real GitHub with a deadline (expected: AboutMe reads
      "Changed after deadline" for a deadline of 2026-09-25 13:00 Dhaka time; a private
      repo reads "Not found").

### Later, by choice
- Similarity: token-level comparison for edited copies, a "starter repo" field,
  comparing the commit at the deadline (see "Open questions" in SIMILARITY.md).
- By-date screen across all people, inline diff viewer, fork-aware logic,
  per-row deadlines, access code, private repos, auto-deploy on push.
