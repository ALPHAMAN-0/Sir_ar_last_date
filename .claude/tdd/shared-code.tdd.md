# TDD evidence: shared code on the Similarity tab (2026-10-17)

**Source plan.** None on file. The teacher asked whether the similarity check
could catch copies that were edited, after a student's lab turned out to be an
exact copy with other line endings (which the exact check misses). Offered three
levels, they chose "Shared-code %": ignore spaces, line endings, letter case and
comments, then measure how much code two repos share (MOSS's winnowing). Exact
copies stay the proof; shared code is a pointer and never names a copier.

**Deviation from the workflow.** No checkpoint commits. The work is on `main`,
where a push deploys, and the user had not asked for commits. Every step was
kept green before moving on.

## User journeys

1. As a teacher, I see pairs of repos that share code even where one copy changed
   spaces, line endings, case, comments or some lines.
2. As a teacher, I open a pair and see which files share code and at which lines,
   and can open both files on GitHub at those lines.
3. As a teacher, code that most of the class has (handed out, shown in class) is
   not counted, with the same limit as starter files.
4. As a teacher, I download the report and find the pairs, lines and files on a
   "Shared code" sheet, and what the check means and cannot see on Info.
5. As a teacher, a repo whose code could not be read is named, and Try again reads it.

## Task report

| Task | RED (command → result) | GREEN (command → result) | Guaranteed |
| --- | --- | --- | --- |
| Reading code, fingerprints | `npx vitest run src/similarity/codeText.test.ts` → "Cannot find module './codeText.ts'" | same → 22 passed (26 with line numbers) | `isReadable`, `stripComments`, `codeOf`, `tokens`, `printText`, `fingerprints`, winnowing's K + W - 1 promise (journey 1) |
| Pairs and files | `npx vitest run src/similarity/sharedCode.test.ts` → "Cannot find module './sharedCode.ts'" | same → 15 passed (one expectation loosened: a run that crosses from starter code into one's own also counts its first line) | `analyseCode`, `codePairDetail`, `coveredRanges`, `countLines`, `codeTier` (journeys 1-3) |
| Worker route and contract | `npx vitest run shared/api.test.ts worker/index.test.ts` → 11 failed | same → 58 passed (one test fixed: `'1'.repeat(40)` has no upper case) | `/api/v1/blobs`: canonical query, variables only, binary / too large / missing, 1 MB cap, 404, 502 on any other error, `RL_BLOB` (journeys 1, 5) |
| Report sheet | `npx vitest run src/similarity/report.test.ts` → 5 failed | same → 26 passed (two older tests now count eight sheets) | "Shared code" sheet, Info lines, not finished, no formulas (journey 4) |
| Loader | written before the code, but not run on its own first | `npx vitest run src/similarity/codeLoader.test.ts` → 10 passed | batches, halving a too-large answer, cache by content and language, errors per repo (journeys 1, 5) |

Tests written after the code (they passed, or failed only on test mistakes):
`format.test.ts` (labels, tones, line ranges, GitHub links) and
`components/SharedCode.test.tsx` (7 screen tests: an edited copy found where no
file is identical, the opened pair with links, the limit, failure and Try again,
nothing shared, no Web Worker, the download). Three screen-test mistakes were
fixed in the tests: "1 file" shows for both sides; the table is redrawn after
Try again; at limit 2 Rahim and Salma rightly still share the lines Karim edited.

## Checks beyond the tests

- Full suite 849 passed (769 before), `tsc -b` clean, `oxlint` clean, `npm run build`
  bundles `code.worker`.
- GitHub itself, through `gh api graphql`: the query document answers text, `null`
  for an unknown hash with no error, escapes `<` as `<`, and sets
  `isTruncated` at 511,998 bytes (lodash.js).
- The local Worker with the user's `.dev.vars` (never opened): `/blobs` on
  `ahnaf-17-17/webtech-summer-2025-26` returned both lab 3 texts (one CRLF, one LF)
  and "missing" with a 60 s cache for a made-up hash.
- 22 public WebTech repos of another class, through the page's own loaders and the
  local Worker: 26 `/blobs` calls, 4.5 s, no errors, and the same 173 pairs to the
  line as a count from `git clone`d copies. This checks the transport, not the
  method: both sides use the same fingerprint code.
- Headless Chrome on the dev server: the section, an opened pair and the phone
  width; the table fits at 1280 px, no sideways scroll at 390 px, and the only
  console entry was a 404 of the existing "who had it first" reader for a commit
  that was force-pushed away.
