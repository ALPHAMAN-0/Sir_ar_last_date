# Sir_ar_last_date — work status

Stopped on 2026-10-02 at the owner's request. The app does **not** run yet.
Full plan: `~/.claude/plans/ok-i-want-to-distributed-sky.md`

## Done
- [x] Plan agreed (sheet format, deadline rule, statuses, hosting, screens).
- [x] Project set up: Vite + React + TypeScript, Cloudflare Vite plugin, Wrangler config
      (`wrangler.jsonc`: single-page app, Workers Cache, two rate limiters, required
      secret), Vitest, SheetJS 0.20.3, secrets ignored by git.
- [x] Server (`worker/`): GitHub client with quota reserve and back-off, and the five
      routes `/api/v1/repos`, `/activity`, `/commits`, `/commit`, `/status`.
- [x] Shared request rules (`shared/`): input validation and one canonical URL per request.
- [x] Server tests: 30 pass. Server type-check is clean.
- [x] Link reader (`src/sheet/parseRepoLink.ts`) and time helpers (`src/logic/time.ts`) written.

## Not done
### Small fixes
- [ ] 2 of 35 tests fail in `src/sheet/parseRepoLink.test.ts`. The two bad links are
      still rejected; only the expected reason in the test is wrong
      (`github.com@evil.example` gives `malformed`, `github.com/a/..` gives `not_a_repo`).
- [ ] `src/App.tsx` and `src/main.tsx` are still the Vite demo and import files that were
      deleted, so `npm run dev` and `npm run build` fail for the page until the real
      screens are written.
- [ ] `README.md` is still the Vite template text.

### Logic still to write (each with tests)
- [ ] Sheet reader: read the Excel file, find the id / name / link columns, merged
      cells, links stored as hyperlinks (`src/sheet/parseSheet.ts`).
- [ ] The On time / Changed after deadline / Late / No submission / Not found rule
      (`src/logic/verdict.ts`).
- [ ] Push time for each commit (`src/logic/pushAttribution.ts`).
- [ ] Tests for the time helpers.
- [ ] Excel export (`src/sheet/exportXlsx.ts`).

### Page still to write
- [ ] Browser API client: request queue, retries, pause when a limit is hit.
- [ ] App state, remembered in the browser, with a Clear button.
- [ ] Screens: upload, deadline box, people table (sort, filter, search),
      person timeline with changed files, limit notice, styling, phone layout.
- [ ] `public/_headers` (security headers) and `public/robots.txt`.

### Testing still to do
- [ ] Nothing has been tested against real GitHub through the server yet.
- [ ] Browser test with a test sheet (AboutMe must read "Changed after deadline" for a
      deadline of 2026-09-25 13:00 Dhaka time).
- [ ] After deploy: edge cache hit, 429 from the rate limiter, token never in any response.

### Steps only the owner can do
- [ ] GitHub token: `.dev.vars` still contains `PASTE_TOKEN_HERE`. Create a fine-grained
      token with "Public repositories" access and no permissions, and paste it there.
- [ ] Cloudflare: sign up, `npx wrangler login`, `npx wrangler secret put GITHUB_TOKEN`.
- [ ] Deploy: `npm run deploy`.

### Git
- [ ] Only the first setup is committed (`07e1565`, pushed to the private repo).
      Everything written after it (`shared/`, most of `worker/`, `src/sheet/`,
      `src/logic/`, this file) is not committed.
