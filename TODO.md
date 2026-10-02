# Sir_ar_last_date — work status

Updated 2026-10-02. The app is built and runs locally. It has not been tested
against real GitHub yet and is not online, because both need the owner's token
and Cloudflare login.

## Done
- [x] Server (`worker/`): GitHub client with quota reserve and back-off, five routes,
      request validation, cache headers, per-visitor rate limits.
- [x] Sheet reader, column detection and column picker.
- [x] The status rule (On time / Changed after deadline / Late / No submission / Not found).
- [x] Push time for every commit, and the timeline with the deadline line.
- [x] Screens: upload, register table (sort, filter, search), person timeline with
      changed files, phone layout, dark mode.
- [x] Excel export in the on-screen order.
- [x] Security headers (`public/_headers`), strict Content-Security-Policy.
- [x] 133 unit tests pass; type-check and lint are clean.
- [x] Browser test with sample data: 39 of 39 checks pass on the dev server and on
      the production build (no console errors, no CSP violations).
- [x] README.

## Not done
### Needs the owner
- [ ] GitHub token: `.dev.vars` still contains `PASTE_TOKEN_HERE`. Create a fine-grained
      token with "Public repositories" access and no permissions, and paste it there.
- [ ] Cloudflare: sign up, then `npx wrangler login`.
- [ ] `npx wrangler secret put GITHUB_TOKEN`, then `npm run deploy`.

### Then
- [ ] Test against real GitHub with the token (expected: AboutMe reads "Changed after
      deadline" for a deadline of 2026-09-25 13:00 Dhaka time; a private repo reads
      "Not found").
- [ ] After deploy: confirm an edge cache hit, a 429 from the rate limiter, and that
      the token appears in no response and no built file.

### Later, by choice
- By-date screen across all people, inline diff viewer, fork-aware logic,
  per-row deadlines, access code, private repos, auto-deploy on push.
