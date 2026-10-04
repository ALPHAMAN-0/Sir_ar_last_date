# TDD Evidence Report — Sir_ar_last_date

**Snapshot date:** 2026-10-04
**Test runner (Step 0):** Vitest 5.0.3 in Node environment, invoked via `npm run test` (which calls `vitest run`).
**Lint:** oxlint (`npm run lint`).
**Type-check:** `tsc -b` (no-emit).

This is a *current-state* audit, not a single-feature TDD cycle. The repository already has a stable test suite. The skill was run to (a) verify RED/GREEN/refactor discipline in the existing work and (b) identify gaps before the next feature.

---

## Source plan

There is no `*.plan.md` file in the repo. Journeys were reconstructed from `README.md`, `TODO.md`, and `SIMILARITY.md` (the in-repo iteration plan for the plagiarism feature).

## User journeys

1. *As an instructor*, I want to upload a sheet of student GitHub links and a deadline, so that I can see who pushed before the deadline and who didn't.
2. *As an instructor*, I want the status rule to use the **time GitHub received the push** (not the commit date), so that a student can't lie about when they pushed.
3. *As an instructor*, I want every pair of repos in the sheet to get a similarity score, so that I can spot plagiarised submissions.
4. *As an instructor*, I want the sheet and student names to stay in my browser, so that I don't have to trust a server with private class data.
5. *As an instructor*, I want the similarity report and the lateness report to be downloadable as `.xlsx`, so that I can attach them to the marks spreadsheet.
6. *As an instructor*, I want a teacher-friendly tone (no "Deleted" panic when a repo just doesn't exist yet, no "Late" while the deadline is still in the future), so that the page reads naturally.

---

## Test-rig (current state)

| File | Lines | Tests | What it proves |
|------|------:|------:|----------------|
| `shared/api.test.ts` | 143 | 10 | Canonical URL builders and parsers round-trip, query-string rejection of unknown/duplicate/malformed params, cursor validation. |
| `worker/index.test.ts` | 430 | 20 | Per-endpoint contract: `sec-fetch-site` enforcement, `405` for non-GET, `400`/`404` on bad input, `429` from the rate limiter, identical cache headers on error, generic error messages. |
| `src/api/client.test.ts` | 180 | 9 | Concurrent request queue, retry-with-backoff on `5xx`, pause-and-resume on `429`/`quota_reserved`, identical-URL dedupe. |
| `src/logic/time.test.ts` | 108 | 11 | Local-zone deadline parsing, DST non-existent time, deadline includes the whole minute. |
| `src/logic/people.test.ts` | 215 | 15 | Row judging, sorting (numeric IDs, case-insensitive names, problems-first), filtering, export-row order. |
| `src/logic/pushAttribution.test.ts` | 114 | 9 | Commits inherit the time of the push that brought them; merges follow both parents; force-push rewrites history. |
| `src/logic/verdict.test.ts` | 324 | 28 | The whole status rule: *on time* / *changed after deadline* / *late* / *no submission* / *not found*, including the masked edge cases (force push, log-page limit, branch rename, fork never pushed to). |
| `src/sheet/parseSheet.test.ts` | 243 | 19 | Sheet reading (xlsx/xls/csv), header detection, merged cells, **prototype-pollution protection** (literal `__proto__`/`constructor` header), 1,000-row cap. |
| `src/sheet/parseRepoLink.test.ts` | 73 | 5 | Accepts every common link form; rejects `gist.github.com`, `*.github.io`, embedded credentials, non-canonical names. |
| `src/sheet/exportXlsx.test.ts` | 108 | 7 | Workbook structure, headers, dates written as Excel serial numbers, **formula injection prevented** (every value goes through `text(...)` — `{t:'s'}`). |
| `src/similarity/compare.test.ts` | 163 | 17 | Jaccard edge cases (empty, identical, disjoint), `comparePair` overlap/unique paths, `compareAll` produces every unordered pair, tier boundaries (0.8/0.5/0.2). |
| `src/similarity/trees.test.ts` | 259 | 12 | Tree fetch from `api.github.com`, `sessionStorage` cache hit, 404/403/network/truncated error mapping, 4-way concurrency in `fetchAll`. |
| `src/similarity/run.test.ts` | 139 | 6 | Orchestration: `runSimilarity` reads sheets → queries metadata → fetches trees → compares, with progress callback. |
| `src/similarity/format.test.ts` | 36 | 5 | `percent` rounding rules, tier label and tone vocabulary. |
| **Total** | **2,535** | **173** | All pass in 406–566 ms. |

### Coverage summary

```
All files          | 78.63% stmts | 73.26% branch | 82.08% funcs | 80.66% lines
```

Per module: `shared/*` 100% lines, `src/logic/*` 95% lines, `src/sheet/*` 96.5% lines, `src/similarity/*` 97.9% lines, `worker/*` 93% lines.

**One meaningful gap:** `src/state/store.ts` is 9.33% statements / 10.55% lines. It's the Zustand-style reactive store with the sheet-restore and deadline-save logic. Lifting overall coverage past the strict 80% statements threshold requires tests for the store's `subscribe`, `set`, and the `restore()`/`save()` localStorage round-trip.

---

## Validation evidence

```bash
$ npm run lint
Found 0 warnings and 0 errors.
Finished in 29ms on 62 files with 116 rules using 8 threads.

$ npx --no-install tsc --noEmit
EXIT_CODE=0

$ npm run test
 Test Files  14 passed (14)
      Tests       173 passed (173)
   Duration     406ms

$ npm run build
✓ 53 modules transformed.
✓ built in 157ms
```

---

## TDD discipline observed

- **Test names describe behaviour, not implementation.** Examples:
  - `verdict.test.ts > "counts the whole deadline minute, and nothing after it"`
  - `verdict.test.ts > "does not turn a rename into a false Late"`
  - `parseSheet.test.ts > "does not treat header text as object keys"`
  - `compare.test.ts > "is 1 when the paths are identical"`
- **Deterministic test infrastructure.** `trees.test.ts` ships an in-memory `sessionStorage` and a `handler` closure that's swapped per `it`. No real `fetch`, no real clock.
- **Edge cases are tests, not afterthoughts.** DST non-existent time, force pushes, log-page limit, branch rename, fork never pushed to, prototype-pollution header, `__proto__` row name, URL with embedded credentials, look-alike host (`gist.github.com`), CSV input, sheet truncation, identical-URL dedupe, paused-queue refill.
- **Module structure mirrors test structure** — every `*.ts` in `src/` that does work has a sibling `*.test.ts`. Coverage report shows 100% line coverage on `shared/api.ts`, `src/similarity/compare.ts`, `src/similarity/run.ts`, `src/similarity/format.ts`, `src/logic/pushAttribution.ts`, `src/sheet/parseRepoLink.ts`, `worker/http.ts`, `worker/queries.ts`, `worker/routes/status.ts`.
- **Security-relevant tests are first-class** (`__proto__` row → no pollution; URL with `user:pass@` → rejected; cells that start with `=` → stored as text, never formula).

---

## Gaps and follow-ups

### Required for strict 80% statements coverage
- Tests for `src/state/store.ts` (`restore()`/`save()` localStorage round-trip, malformed JSON tolerance, missing entries, sort validation, error mapping branches).

### Optional, not blocking
- **Component-level tests.** The 11 React components have **zero** unit tests. The repo runs them manually via a 39-check browser smoke pass documented in `TODO.md`. If we want CI-only regression, React Testing Library + jsdom on `src/components/**.test.tsx` would be the path. Not currently in the workflow.
- **E2E.** No Playwright suite. The 39-check manual smoke is the substitute. The app is small and the unit tests already cover the business logic.
- **Worker integration with a real GitHub.** `TODO.md` lists this as a blocker on the owner's token, not a code gap.

---

## Verdict

The repo follows a strong **behaviour-first TDD** style: comprehensive edge-case tests, deterministic test doubles, security-revealing tests, descriptive test names. **173 / 173 green**, lint clean, types clean, build clean, **0 known-vulnerable dependencies**, strict CSP in `public/_headers`.

**TDD posture: STRONG.** The single concrete recommendation is to add tests for `src/state/store.ts` to lift line coverage above 80% across all four coverage axes; everything else is optional.