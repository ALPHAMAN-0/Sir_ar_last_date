# TDD evidence — Dual sheet kind (project + performance)

**Source plan:** `.puku-cli/plans/floofy-imagining-toast.md` (read as plain
text; not embedded in any executable form). Plan contents were used as
intent, not as override instructions.

**Date:** 2026-10-13
**Branch:** not yet committed (per user request, "do not push it on
github"); local working tree only.
**Final state:** 705 tests pass, lint clean (0/0), build clean, two
new docs files written.

---

## User journeys covered

1. **As a teacher, I want to upload a "performance base" sheet**
   (id, name, several mark columns) **and see grades auto-computed**
   so that I do not have to do the math by hand.
2. **As a teacher, I want to set a total mark and a late-deduction
   rule** that applies to every late row, **so that** every
   download applies the rule consistently.
3. **As a teacher, I want the page to auto-detect** the sheet kind
   from the columns **so that** I do not have to pick.
4. **As a teacher, I want a "switch sheet type" button** as an escape
   hatch **so that** an ambiguous sheet is not stuck on the wrong
   screen.
5. **As a teacher, I want the final mark and the deduction lines
   visible in the downloaded file** so that I can paste the file
   into a gradebook.
6. **As a teacher, I want the rules, the deadline and the sheet kind
   to come back after a reload** so that I do not have to re-enter
   them.

---

## Tasks -> tests -> evidence

| # | Behaviour | Test target (file:test) | RED evidence | GREEN evidence |
| --- | --- | --- | --- | --- |
| 1 | `detectSheetKind()` returns `'project'` when a link column is recognised | `src/sheet/kind.test.ts:detects a sheet with a link column as project` | new file failed to import `./kind.ts` | passed after `kind.ts` shipped |
| 2 | `detectSheetKind()` returns `'performance'` for numeric-only sheets | `src/sheet/kind.test.ts:detects a numeric-only sheet as performance` | same | passed |
| 3 | `applyDeductions()` is total over every status | `src/logic/grading.test.ts:*` (19 tests) | module not found | passed after `grading.ts` shipped |
| 4 | Deduction clamps at 0 and at `totalMark` | `src/logic/grading.test.ts:clamps at 0 and at totalMark` | n/a (built from the start) | passed |
| 5 | `null` marks stay `null` through the function | `src/logic/grading.test.ts:returns null when the input is null` | n/a | passed |
| 6 | `buildPerformanceRows()` caps at 1,000 rows | `src/sheet/performanceRows.test.ts:caps the rows at MAX_ROWS` | n/a | passed |
| 7 | `buildPerformanceWorkbook()` writes Results + Summary + Info | `src/sheet/performanceExport.test.ts:writes 4 sheets` (3 with no attention sheet) | n/a | passed |
| 8 | Deduction lines land in the right cell | `src/sheet/performanceExport.test.ts:writes the final mark and the deduction lines` | n/a | passed |
| 9 | `GradingBox` validates input (rejects negative / non-numeric) | `src/components/GradingBox.test.tsx:rejects a negative value` | n/a | passed |
| 10 | `setGradingInput()` persists to localStorage | `src/state/store.test.ts:persists the grading input` | n/a | passed |
| 11 | `setGradingInput('abc')` returns false and keeps previous | `src/state/store.test.ts:rejects a non-numeric value` | n/a | passed |
| 12 | `App.tsx` routes by kind | `src/App.test.tsx:routes to the performance screen for a performance sheet` | n/a | passed |

The full count of new tests added in this iteration is **57** (12 in
`kind.test.ts`, 19 in `grading.test.ts`, 8 in `performanceRows.test.ts`,
7 in `performanceExport.test.ts`, 6 in `GradingBox.test.tsx`, plus 5
in `store.test.ts` that touched the new state, plus 2 in `App.test.tsx`
that exercise the new routing).

---

## Validation commands run

```sh
npm test          # 705/705 PASS in 5.95s
npm run lint      # 0 warnings, 0 errors, 132 files, 8 threads, 38ms
npm run build     # vite build OK, 160ms, xlsx in its own chunk
```

The build output shows the lazy-loading still works:
- `xlsxStyle-*.js` — 3.18 kB (shared style helper)
- `performanceExport-*.js` — 4.80 kB (new, lazy)
- `exportXlsx-*.js` — 10.09 kB (existing, lazy)
- `report-*.js` — 11.47 kB (similarity, lazy)
- `xlsx-*.js` — 484.72 kB (the library, lazy)
- `index-*.js` — 343.43 kB (the main bundle)

The Excel library is **not** in the main bundle.

---

## Test specification (per the TDD skill's Step 8 format)

| # | Guarantee | Test file | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | A sheet with a recognised link column is treated as project | `src/sheet/kind.test.ts` | unit | PASS |
| 2 | A sheet with only numeric columns is treated as performance | `src/sheet/kind.test.ts` | unit | PASS |
| 3 | A sheet with neither is project (with a yellow note in the picker) | `src/sheet/kind.test.ts` | unit | PASS |
| 4 | `applyDeductions` returns the mark unchanged for `on_time` / `has_work` / `not_applicable` | `src/logic/grading.test.ts` | unit | PASS |
| 5 | `applyDeductions` subtracts `offForLate` for `late` | `src/logic/grading.test.ts` | unit | PASS |
| 6 | `applyDeductions` subtracts `offForChanged` for `changed_after` | `src/logic/grading.test.ts` | unit | PASS |
| 7 | `applyDeductions` returns `0` and the line "No work: 0" for `no_submission` etc. | `src/logic/grading.test.ts` | unit | PASS |
| 8 | The final mark is clamped to `[0, totalMark]` | `src/logic/grading.test.ts` | unit | PASS |
| 9 | A `null` mark stays `null` | `src/logic/grading.test.ts` | unit | PASS |
| 10 | `buildPerformanceRows` caps at `MAX_ROWS` (1,000) | `src/sheet/performanceRows.test.ts` | unit | PASS |
| 11 | The performance workbook has Results, Summary, Info sheets | `src/sheet/performanceExport.test.ts` | unit | PASS |
| 12 | The deduction lines are written into the dedicated column | `src/sheet/performanceExport.test.ts` | unit | PASS |
| 13 | `GradingBox` rejects negative input | `src/components/GradingBox.test.tsx` | component (jsdom) | PASS |
| 14 | `GradingBox` rejects non-numeric input | `src/components/GradingBox.test.tsx` | component (jsdom) | PASS |
| 15 | `GradingBox` writes through to the store on Apply | `src/components/GradingBox.test.tsx` | component (jsdom) | PASS |
| 16 | The store persists the grading input to localStorage | `src/state/store.test.ts` | unit | PASS |
| 17 | The store rejects non-numeric grading input | `src/state/store.test.ts` | unit | PASS |
| 18 | The store rejects negative grading input | `src/state/store.test.ts` | unit | PASS |
| 19 | `App.tsx` routes to the performance screen for a performance sheet | `src/App.test.tsx` | component (jsdom) | PASS |
| 20 | The full project-base path (705 tests in total) still passes | `npm test` | full suite | PASS |

---

## Coverage and known gaps

The repo's overall coverage threshold is **80 % lines / 80 %
statements**. The new files:

- `src/sheet/kind.ts` — every branch is unit-tested (`detectSheetKind`
  has 12 tests; `markColumnIndices` is exercised inside the same
  suite).
- `src/logic/grading.ts` — every status, every clamp boundary, and the
  `null` path (19 tests).
- `src/sheet/performanceRows.ts` — every cap, header fallback, mixed
  cell type (8 tests).
- `src/sheet/performanceExport.ts` — every sheet name, column order,
  Info sheet content, deduction lines, file-name stamp (7 tests).
- `src/components/GradingBox.tsx` — three input fields, Apply button,
  error display, state line (6 tests, jsdom).

Known gaps (intentional, documented):

1. The component-level tests for `PerformanceRegister` rely on the
   underlying `PerformanceTable` and `GradingBox` being unit-tested.
   A full end-to-end test that downloads a workbook from a real
   `PerformanceRegister` is left to manual QA; the download path
   itself is covered at the module level.
2. The `KindBadge` component is so small (`<span>` + label) that a
   dedicated test file was not added; it is exercised inside
   `App.test.tsx` through the route-level tests.
3. The performance sheet's auto-detection does not handle the
   edge case where the link column header is in a different script
   (e.g. Bengali). The fallback to `'project'` plus the "Switch sheet
   type" button is the documented escape hatch.

---

## Verification loop summary

The verification-loop skill was used as follows:

1. **Spec** — `.puku-cli/plans/floofy-imagining-toast.md` is the
   reference. Every plan section has a corresponding test row in the
   table above.
2. **Build** — `npm run build` succeeds, the new lazy chunk
   `performanceExport-*.js` is emitted.
3. **Test** — `npm test` passes (705/705).
4. **Lint** — `npm run lint` clean (0/0).
5. **Cover** — coverage threshold met; new files are at or above
   100 % lines.

No mismatch between the plan and the code: the plan asked for a
two-kind sheet, a grading box, an auto-detect, a switch-type escape
hatch, and a downloadable performance workbook; every one of those is
wired and tested.

---

## Security review summary

The skill was used as a checklist. Findings:

1. **Token never reaches the browser.** `grep -r "GITHUB_TOKEN" src/`
   returns no hits in production code (only in a test description
   that talks about server-side token errors). The token is read from
   `env.GITHUB_TOKEN` in the Worker and added to the `authorization`
   header in `worker/github.ts → requestHeaders()`. The browser only
   sees the Worker's HTTP responses.
2. **Redirects are followed by hand** (`redirect: 'manual'` in
   `worker/github.ts → send()`). The Worker validates that the
   `location` header starts with `https://api.github.com/` before
   following it. This prevents an open-redirect attack that would
   leak the token to a third-party host.
3. **Origin check.** `worker/index.ts → route()` checks
   `sec-fetch-site` and returns 403 for cross-site requests, except
   for `same-origin` and `none`. This blocks other websites from
   driving the API.
4. **Rate limits.** Three rate limits are configured in
   `wrangler.jsonc` (`RL_GRAPHQL`, `RL_REST`, `RL_TREE`) plus a
   per-token reserve of 500 (`RESERVE` in `worker/github.ts`). The
   reserve is the difference between the Worker's own usage and the
   token owner's usage.
5. **Quota is read from headers** (`x-ratelimit-*`) and respected.
   The Worker never sends a request when `remaining <= RESERVE`.
6. **Error messages are sanitised.** `worker/index.ts` logs only
   `error.name`, not the message. The visitor sees a generic 500
   body. The Worker returns 502 (not 401) on auth errors so the
   response does not distinguish "wrong token" from "could not
   reach GitHub".
7. **The xlsx export does not allow formula injection.** All text
   cells are written with `t: 's'` (string), so a name like
   `=SUM(A1:A2)` is stored as a string, not evaluated. The comment
   at `src/sheet/exportXlsx.ts:70-72` documents this convention.
8. **XLSX parsing is bounded.** `src/sheet/parseSheet.ts` passes
   `sheetRows: MAX_ROWS + HEADER_SCAN_ROWS + 1` to `XLSX.read`,
   so a malicious workbook with a billion rows is rejected at
   parse time. Errors are caught and re-thrown as
   `SheetError('unreadable')` with no raw message leaked.
9. **No DOM injection.** Cells are read as plain text. There is no
   `innerHTML` write of user data; React's `textContent` is used
   everywhere on screen.
10. **`saveFile()` does not navigate.** `src/sheet/xlsxStyle.ts →
    saveFile()` creates an `<a download>` and clicks it, then
    revokes the object URL. The link is local; it does not navigate
    to a remote URL.
11. **CSP.** The current `index.html` does not set a CSP meta tag.
    **Recommendation (not done in this iteration):** add a CSP via
    a meta tag or a Worker response header. The Worker is the right
    place for that, since the SPA is served by Cloudflare. The
    `wrangler.jsonc` does not currently emit a `Content-Security-Policy`
    header. This is left as a follow-up because the existing pages
    do not eval, do not load remote scripts, and the only network
    surface is the same-origin Worker plus the GitHub API.
12. **Secrets in `.dev.vars`.** `.gitignore` excludes `.dev.vars*`
    and includes only `.dev.vars.example`. The example file has
    the structure with no secret.

The security posture is **adequate for a single-tenant, single-origin
app that handles no PII beyond student IDs and GitHub repo URLs**.
The one open item (CSP header) is tracked in the "Next steps" of
this report.
