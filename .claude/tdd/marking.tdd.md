# TDD evidence: marking, two uploads, Mid / Final, light theme (2026-10-17)

**Source plan.** None on file. The journeys below come from the session's
interview (grill-me) with the teacher who uses the app. Decisions taken there:
lab sheets are `id, name, repolink` plus their own columns; each repo has `Mid/`
and `Final/` folders, each term judged by its own folder and its own deadline;
a project sheet has one deadline; the rules table is total, late (one flat
amount), changed after, no submission; a per-student bonus column; the final
mark is never above the total; "Late by" spelled out in the file; an always-light
warm paper + sage look.

**Deviation from the workflow.** No checkpoint commits were made. The work is
on `main`, where a push deploys, and the user had not asked for commits. RED and
GREEN are recorded here instead; every step was kept green before moving on.

## User journeys

1. As a teacher, I choose on the home page whether my sheet is a project sheet
   or a lab / performance sheet, so the app does not have to guess.
2. As a teacher, I type a total mark and the marks off for late, for changed
   after the deadline and for no submission, and every student's final mark
   updates at once.
3. As a teacher asking a student questions, I type a bonus in their row and
   press Enter to go to the next student.
4. As a teacher of a lab course, I switch between Mid and Final; each term has
   its own deadline and rules, and Final work pushed after the Mid deadline does
   not make Mid late.
5. As a teacher, I download the report and find the deduction, bonus and final
   mark at the end of each row, "Late by" in words, and the rules on Info.
6. As a teacher, I come back tomorrow and find my kind, term, rules and bonuses
   as I left them.

## Task report

| Task | RED (command → result) | GREEN (command → result) | Guaranteed |
| --- | --- | --- | --- |
| Marking rules, bonus reading | `npx vitest run src/logic/marking.test.ts` → "Cannot find module './marking.ts'" | same → 16 passed | `markFor`, `readRules`, `readBonus`, `formatMark` (journeys 2, 3) |
| "Late by" spelled out | `npx vitest run src/logic/time.test.ts` → 4 failed, "formatDurationLong is not a function" | same → passed | `formatDurationLong` (journey 5) |
| Judging a term by its folder | `npx vitest run src/logic/termFolder.test.ts` → "Cannot find module './termFolder.ts'" | same → 21 passed (later 25) | `judgeTerm`, `termFolder`, `termOfFolder`, `labTasks` (journey 4) |
| Store: kind, rules, term, bonus, saving, folder reads | `npx vitest run src/state/marking.test.ts` → 17 failed ("expected 'project' to be 'lab'", "setRuleInput is not a function", …) | same → 19 passed | journeys 1–4, 6 |
| Report columns and Info | `npx vitest run src/sheet/exportXlsx.test.ts` → 5 failed | same → 40 passed | journey 5 |
| Report rows (marks, lab fields, long late text) | `npx vitest run src/logic/people.test.ts` → 4 failed | same → 23 passed | journey 5 |
| Home page, register screens | `npx vitest run src/components/Marking.test.tsx src/components/UploadPanel.test.tsx` → 22 failed | same → 24 passed | journeys 1–5 on screen |

Two fixture mistakes were found by RED/GREEN and fixed in the tests, not the
code: a tampered save with two headers can only bring back two cells; a 502 is
retried by the API client with back-off, so the failed-folder test uses the
Worker's own 404 for a missing commit.

Tests written after the code, to cover failure paths (they passed at once):
a listing failing mid-search, a push log not read to its end, an unknown commit
at the deadline, a head not reached by the log, the up arrow, and the lab task
cell's "…" and "Empty folder" states.

Expected changes to existing tests: the report's column list and filter range
grew by the three mark columns (appended, nothing moved); the register's
download now writes "9 hours" / "3 hours 19 minutes" instead of "9h" / "3h 19m";
the table has two non-sorting headers; the old grading-box and performance
tests were removed with the screen they tested.

## Test specification

| # | What is guaranteed | Test | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | On time = total; late = total − late; changed = total − changed; no submission / not found / bad link = the no-submission mark | `src/logic/marking.test.ts` | unit | PASS |
| 2 | Checking and Check failed get no mark, so a failed check never costs marks | `marking.test.ts` | unit | PASS |
| 3 | The final mark stays within 0 … total, whatever the bonus | `marking.test.ts`, `Marking.test.tsx` | unit, screen | PASS |
| 4 | A bad value in the rules is named, and the last good rules stay in force | `src/state/marking.test.ts`, `Marking.test.tsx` | store, screen | PASS |
| 5 | Mid is judged by the Mid folder only: Final work after the Mid deadline leaves Mid on time | `termFolder.test.ts`, `src/state/marking.test.ts`, `Marking.test.tsx` | unit, store, screen | PASS |
| 6 | A folder changed after the deadline is dated by the push that left it as it is, found by halving (4 listings for 3 pushes) | `termFolder.test.ts` | unit | PASS |
| 7 | A folder that came after the deadline reads Late, dated by the push that brought it | `termFolder.test.ts` | unit | PASS |
| 8 | No term folder reads No submission with a note; a removed folder is flagged | `termFolder.test.ts` | unit | PASS |
| 9 | A folder listing that cannot be read reads Check failed, and Refresh asks again | `src/state/marking.test.ts` | store | PASS |
| 10 | The chosen card decides the kind; a lab sheet keeps its other columns | `UploadPanel.test.tsx`, `src/state/marking.test.ts` | screen, store | PASS |
| 11 | Each project / term keeps its own deadline and rules; each term its own bonuses | `src/state/marking.test.ts` | store | PASS |
| 12 | A bonus follows the student ID across a re-sorted sheet | `src/state/marking.test.ts` | store | PASS |
| 13 | Saves are read as untrusted: tampered values are dropped; older saves convert | `src/state/marking.test.ts` | store | PASS |
| 14 | Enter / ↓ / ↑ move between bonus boxes; clicking a box does not open the person | `Marking.test.tsx` | screen | PASS |
| 15 | Marks are appended at the end of Results; lab adds Term folder, Lab tasks and its columns first; a carried "=1+1" stays text | `exportXlsx.test.ts`, `Marking.test.tsx` | unit, screen | PASS |
| 16 | "Late by" in the file reads "2 days 4 hours 15 minutes" | `time.test.ts`, `people.test.ts`, `Register.test.tsx` | unit, screen | PASS |
| 17 | Info records the kind, the term and the rules table | `exportXlsx.test.ts` | unit | PASS |
| 18 | Every registered button, the new cards and the Mid / Final switch included, clicks without an error | `qa/test-it.test.tsx` (26 pass, 2 skip as before) | screen | PASS |

## Coverage and checks

`npx vitest run --coverage`: 769 tests, all passing. Statements 96.6%,
branches 90.5%, functions 97.6%, lines 98.4%. New files: `marking.ts`,
`MarkingBox.tsx`, `TermPicker.tsx` 100%; `termFolder.ts` 98.8% lines;
`store.ts` 99.4% lines; `PeopleTable.tsx` 100% lines.

`npm run lint`: clean. `npx tsc -b --force`: 0 errors. `npm run build`: passes.

In a real browser (headless Chrome, the dev server, every `/api/v1` request
answered with made-up data, no GitHub and no token used): the home page and the
lab register at desktop and phone width, the page staying light with the OS in
dark mode, a bonus typed with the keyboard and Enter moving to the next student,
and the Final term with its own empty rules.

## Security review

- Inputs: the rules and bonus boxes accept numbers only (|x| ≤ 100,000), with a
  pattern that cannot backtrack; the upload keeps its 5 MB limit; a save is
  read back type- and range-checked, bonus entries and carried columns capped.
- Data from students' repos (folder names) is shown through React (escaped) and
  written into the file as text, never as a formula; so are carried cells.
- No new endpoint: the folder reads use the existing `/api/v1/tree` with
  `flat=1`, by commit or folder hash taken from GitHub's own answers.
- CSP unchanged (`script-src 'self'`, no inline styles added); no
  `dangerouslySetInnerHTML`; no `console.log`; no secrets in the diff.
- Marks and bonuses stay in the browser's localStorage with the sheet, as names
  and IDs already did; Clear removes them.
- `npm audit`: 0 in runtime dependencies; 4 high in dev tooling, all one
  advisory in `sharp` (image library used by the local dev server through
  wrangler / miniflare), fix available, not applied here.

## Known gaps

See TODO.md, "Marking and lab sheets (2026-10-17), known limits": term folders
must sit at the top of the repo; halving assumes a folder that arrived stays;
no sorting by final mark yet.
