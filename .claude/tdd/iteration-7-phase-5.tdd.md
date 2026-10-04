# TDD Evidence Report — Iteration 7 (Phase 5: similarity .xlsx download)

**Date:** 2026-10-05
**Branch:** `main`
**Test runner:** Vitest 5.0.3 (`npm run test`)
**Lint:** oxlint (`npm run lint`)
**Type-check:** `tsc --noEmit`

## Source plan

`SIMILARITY.md` Phase 5 — *"build the workbook, add a Download button, write tests."* The plan was already approved and the previous iteration closed with this phase listed but un-started.

## User journey covered

> *As an instructor, I want the similarity table to be downloadable as a `.xlsx` so that I can attach it to the marks spreadsheet and share it with colleagues.*

## RED → GREEN → refactor cycle

| Stage | Commit | Validation command | Result | What it proves |
|---|---|---|---|---|
| RED | `2a1d267 test: add reproducer for similarity .xlsx report` | `npx vitest run src/similarity/report.test.ts` | ❌ "Cannot find module './report.ts'" | Test file was added and the missing-module compile error is the intended RED signal. |
| GREEN | `a6eb6dc feat: similarity .xlsx download (Phase 5)` | `npm run test` `npm run lint` `tsc --noEmit` `npm run build` | ✅ 182/182, lint clean, types clean, build clean | `report.ts` satisfies all 9 tests; `SimilarityView` shows the button; CSS rule added. |
| Refactor | `f2a5d0b refactor: thread writer into downloadReport for testability` | `npm run test -- --coverage` | ✅ 183/183, `report.ts` 100% lines | Browser-only side effect is now exercised; thread-the-writer lets the test pass a stub. |
| Docs | `0214182 docs: SIMILARITY iteration 7 — Phase 5 done` | (markdown only) | n/a | Plan status updated. |

## Test specification

| # | What is guaranteed | Test file / command | Result |
|---|---|---|---|
| 1 | Workbook has Results + Info sheets, headers in row 1, rows in caller order | `report.test.ts > buildReportWorkbook > keeps the given pair order and writes the header row` | PASS |
| 2 | Overlap % / Overlap / Union are written as numeric cells | `> writes overlap percentage as a number and overlap/union as numbers` | PASS |
| 3 | Shared paths are joined with newlines into a single text cell | `> joins path lists with newlines and writes them as plain text` | PASS |
| 4 | Cells beginning with `=`, `+`, `@`, or `HYPERLINK(...)` stay text — formula-injection safe | `> never writes a formula, even when an id or name starts with "="` | PASS |
| 5 | Missing values write as blank cells; overlap=0 still writes a `t:'n', v:0` cell | `> leaves unknown values blank and writes shared count as a number` | PASS |
| 6 | Info sheet records source sheet, checked-at time, zone, totalTrees, failedTrees, totalPairs | `> records the source sheet, checked-at time and zone on the Info sheet` | PASS |
| 7 | Info sheet describes the method in plain English | `> describes how similarity was computed in plain English` | PASS |
| 8 | File name is `similarity-YYYY-MM-DD-HHMM.xlsx` in the local zone | `> reportFileName > names the file after the check time in local zone` | PASS |
| 9 | Minutes padded to four digits (`0000`, `0100`, …) | `> produces a four-digit time even when minutes are zero` | PASS |
| 10 | `downloadReport` calls the writer with the right name and `{compression: true}` | `> downloadReport > writes the workbook to disk with the right name and compression` | PASS |

## Coverage after this iteration

```
All files          | 79.18 % stmts | 73.55 % branch | 83.65 % funcs | 81.33 % lines
src/similarity     | 95.45 % stmts | 86.27 % branch | 97.91 % funcs | 98.36 % lines
report.ts          | 95.83 % stmts | 57.14 % branch | 100 % funcs   | 100 % lines  (1 uncovered branch on `null` checkedAt)
```

Coverage moved from **80.66 % → 81.33 % lines** and **78.63 % → 79.18 % statements**. The 80% statements target is now closer.

## Validation evidence (commands and excerpts)

```bash
$ npx vitest run src/similarity/report.test.ts
 ✓ src/similarity/report.test.ts (10 tests) 33ms
 Test Files  1 passed (1)
      Tests  10 passed (10)

$ npx tsc --noEmit ; echo TSC=$?
TSC=0

$ npm run lint
Found 0 warnings and 0 errors.
Finished in 31ms on 67 files with 116 rules using 8 threads.

$ npm run test
 Test Files  14 passed (14)  →  15 passed (15)
      Tests       173 passed (173)  →  183 passed (183)

$ npm run build
✓ 53 modules transformed.
✓ built in 198ms
```

## Production behaviour change

- `SimilarityView` now renders a **Download .xlsx** button when the comparison is ready and at least one pair exists. Click → maps `sortedPairs` to `ReportPair[]` using the per-repo `metaByKey` map (id, name, branch, head oid from the sheet) and the existing `Pair` data → calls `downloadReport(pairs, {sheetName, checkedAt, totalTrees, failedTrees, totalPairs, zone})` → browser downloads `similarity-YYYY-MM-DD-HHMM.xlsx` with two sheets:
  - **Results** — 13 columns: A id, A name, A branch, A head oid, B id, B name, B branch, Overlap %, Overlap, Union, Shared paths (newline-joined), Only in A, Only in B. All text cells go through `text()`, so values beginning with `=`, `+`, `@`, or `HYPERLINK(...)` stay text in Excel — same formula-injection safety as `exportXlsx.ts`.
  - **Info** — 9 rows: source sheet name, pairs in this file, checked-at (Excel serial in local zone), time zone, total pairs compared, trees requested, trees that could not be listed, trees with a comparison, and a one-line Jaccard method description.

## Known gaps and follow-ups

- **Cross-module dedup**: `report.ts` and `exportXlsx.ts` both contain small `text()` / `number()` / `excelDate()` helpers plus `DATE_FORMAT`, `MS_PER_DAY`, `EXCEL_EPOCH_OFFSET` constants. Out of scope for this iteration; a future `src/sheet/xlsx.ts` could host them.
- **Static import of `xlsx`**: `report.ts` imports `* as XLSX from 'xlsx'`, which is a ~485 kB dependency. The main bundle now weighs 769 kB (up from 281 kB). Lazy-loading behind the click is the same pattern used by `downloadSample()` elsewhere — could be added in a follow-up iteration if the bundle size matters.
- **`src/state/store.ts` coverage**: still the only meaningful gap (9.33 % statements). Separate TDD cycle.

## Verdict

**Phase 5 closed.** The plagiarism/similarity feature is now end-to-end usable: upload sheet → see status table → click Similarity tab → read top pairs → expand for shared/unique paths → click **Download .xlsx** → share with colleagues. The verifier-flagged gap from earlier in this session is gone.

Branch `main` is in a green state with three focused commits (`test:` → `feat:` → `refactor:`) plus one doc update. Safe to merge.