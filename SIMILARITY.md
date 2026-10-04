# Plagiarism / Similarity Checker — Plan

This is an **iteration plan**, not a one-shot spec. Each section has a
"Status" line you'll update as the design and code evolve. The plan is
kept in one file at this path; you and I edit it in place when something
changes.

---

## Context

The current project (`Sir_ar_last_date`) is a single-page web app +
Cloudflare Worker that tells an instructor whether each student pushed
their GitHub submission before the deadline. You want to extend it with
a **similarity / plagiarism report**: for every pair of repos in the
uploaded sheet, compute a score, show pairs ranked by similarity, and
let the instructor download an `.xlsx` of the results.

After Q&A, the agreed design is:

- **Runs in the browser**, not the Worker. The Worker is unchanged.
  This keeps the project on the Cloudflare free plan (10 ms CPU per
  request) and retains the existing "names never leave the browser"
  property: the sheet stays local; only public file trees at
  `api.github.com` are fetched, and they are fetched **without any
  token**.
- **Match method: file-name overlap** (Jaccard of file-path sets).
  Fast, free, no third-party service, catches verbatim copies and most
  renames. Honest about its limits — documented in the UI.
- **Pairs: every repo vs every other** (N×N). For a class of N students,
  the page compares N(N−1)/2 pairs. With a `Web Worker` for the math,
  this stays responsive for class sizes up to a few hundred.
- **Report: in-browser view + `.xlsx` download.** Consistent with the
  existing Register screen.

The reasons this is the only feasible approach for this project are
documented in the **Trade-offs** section below — please read them before
changing the plan.

---

## Trade-offs (do not forget these)

1. **Free tier math.** The Worker free plan gives ~10 ms CPU per request
   and 5,000 GitHub requests/hour (with a 500-reserve, so **3,500
   usable**). Doing code comparison in the Worker would not fit. The
   browser has no such limit — only the user's patience.
2. **No token, no quota.** `api.github.com/repos/{owner}/{name}/git/trees/{sha}?recursive=1`
   is reachable with no auth. It is rate-limited per IP (~60 requests/hr
   anonymous), so the page should fetch with a small concurrency (e.g.
   4 at a time) and cache results in `sessionStorage` keyed by
   `repo@headOid` so re-runs are free.
3. **Names never leave the browser.** The sheet itself still goes
   nowhere; only the file lists of public repos are read.
4. **File-name overlap is not "did they copy".** Two students
   independently writing `index.html` and `style.css` will get a high
   score. The UI must say this in plain English and not over-promise.
5. **N×N cost.** N=200 is 19,900 pairs. With ~30 file paths each, the
   math is small (microseconds per pair); the bottleneck is the **fetch**
   of the file tree, not the comparison. ~30 KB of code does the
   comparison in a `Web Worker`.

---

## Status

| Field | Value |
| --- | --- |
| Iteration | 6 (Phase 4 done; tests 173/173, lint clean, build clean) |
| Last update | 2026-10-04 |
| Decisions locked | scope=browser-only, math=file-name-overlap, pairs=N×N, report=browser+xlsx |
| Open questions | see **Open questions** at the bottom |

Update this table whenever a section changes.

---

## Goal (user-visible behaviour)

A new tab **"Similarity"** appears in the masthead. With a sheet
uploaded, clicking the tab:

1. Fetches the file tree of every repo in the sheet (one call per repo,
   cached for the session, key = `owner/name@headOid`).
2. Compares every pair of repos, computing Jaccard overlap of file
   paths.
3. Shows a table sorted by similarity descending, with the top pair(s)
   highlighted.
4. Each pair has a "details" expansion: which paths overlap, which are
   unique to A, which to B.
5. A button downloads an `.xlsx` of the same table (rows: pair A×B;
   columns: A_id, A_name, B_id, B_name, overlap_pct, shared_paths,
   only_A_paths, only_B_paths, branch, head_oid).

The similarity tab's UI language matches the Register screen (chips,
stamps, dark mode, the same fonts).

---

## Architecture

```
New files:
  src/similarity/types.ts          — Shared types
  src/similarity/trees.ts          — fetch + cache the repo file tree
  src/similarity/compare.ts        — pure: pairwise Jaccard on path sets
  src/similarity/compare.worker.ts — the Web Worker wrapper
  src/similarity/format.ts         — pair labels, % formatting
  src/similarity/report.ts         — builds the .xlsx workbook
  src/similarity/__tests__/        — colocated tests
  src/components/SimilarityView.tsx — the new screen

Edited files:
  src/App.tsx                      — add a third route '#/s' and a nav link
  src/state/store.ts               — nothing required; reads existing state
  src/styles.css                   — small additions for the new screen
```

`App.tsx` already routes between `UploadPanel`, `Register`, and
`PersonView` based on `window.location.hash` (see
`src/state/hooks.ts → useRoute`). The similarity tab plugs in next to
them.

### Data flow

```
SimilarityView (mount)
  └─ for each unique repo in state.repos where state === 'ok'
        trees.fetch(repo, headOid)
          ├─ GET https://api.github.com/repos/{owner}/{name}/git/trees/{headOid}?recursive=1
          │     (NOT through the Worker — direct, no token)
          ├─ keep paths only (drop type/size/sha/url)
          └─ sessionStorage.setItem(`sirar:tree:${repo}@${headOid}`, paths)
        on error: mark the repo as "could not list files"
  └─ postMessage(paths) to the worker
  └─ worker compares every pair, posts back a list of
        {aKey, bKey, score, shared, onlyA, onlyB}
  └─ render the table sorted by score desc
```

The Worker route is not touched. GitHub's `git/trees?recursive=1` is
publicly readable (returns file names only, no content); for fully
anonymous access, this is fine. We use it because one call returns
the whole tree without pagination up to ~100k entries, and the page
already knows the head oid from `RepoMeta`.

> Note: we will NOT route this through the Worker's `/api/v1/*` URLs.
> Those URLs go through the Worker's token and count against the shared
> 5,000/hr budget. Direct browser fetches to `api.github.com` will be
> **anonymous and rate-limited to 60/hr per IP** unless the user is
> signed into GitHub. This is an acceptable trade-off because:
> - It keeps the Worker's quota reserve intact.
> - The trees call returns ~1–3 KB per repo, so even 60/hr is enough
>   for a class once the response is cached in `sessionStorage`.
> - For larger classes, the page will tell the user "Sign in to GitHub
>   to speed this up". GitHub's browser requests to `api.github.com`
>   carry the user's cookie if they are signed in, raising the limit to
>   5,000/hr.

---

## Math (the part that is interesting)

### Jaccard similarity on file-path sets

For repos A and B:

```
paths(A) = set of unique file paths in repo A
paths(B) = set of unique file paths in repo B

overlap  = |A ∩ B|
union    = |A ∪ B|
jaccard  = overlap / union   ∈ [0, 1]
```

Reported as a whole percent, with the raw overlap and union shown
on click.

### Why Jaccard and not raw count

Two empty repos would score 0/0 (which is undefined); two identical
repos score 1.0; two repos sharing half their paths each get 0.5.
Raw count would favour large repos. Jaccard is symmetric and bounded,
so it sorts cleanly.

### Tiers in the UI

| Score | Label | Tone |
| --- | --- | --- |
| ≥ 80% | "Very similar" | bad |
| 50–79% | "Similar" | warn |
| 20–49% | "Some overlap" | muted |
| < 20% | "Different" | info |

These are **not** verdicts on plagiarism; they are sorting labels. The
UI text must say so plainly.

---

## Components in detail

### `src/similarity/types.ts`

```ts
export type FileTree = {
  repo: string         // "owner/name"
  branch: string       // defaultBranch
  headOid: string
  fetchedAt: string    // ISO
  paths: string[]      // unique paths, sorted
}

export type Pair = {
  aKey: string         // owner/name
  bKey: string
  aBranch: string
  bBranch: string
  aHeadOid: string
  bHeadOid: string
  overlap: number      // |A ∩ B|
  union: number        // |A ∪ B|
  score: number        // jaccard, 0..1
  shared: string[]     // paths in A ∩ B
  onlyA: string[]
  onlyB: string[]
}

export type CompareProgress = {
  done: number
  total: number
  current?: string
}
```

### `src/similarity/trees.ts`

- `fetchTree(repo, headOid)`: hits
  `https://api.github.com/repos/{owner}/{name}/git/trees/{headOid}?recursive=1`.
  Anonymous by default (no token). Uses the same `fetch()` the rest of
  the page uses, with `signal: AbortSignal.timeout(8000)`.
- Caches into `sessionStorage` keyed by
  `sirar:tree:${repo}@${headOid}`. Cache TTL: 1 hour.
- Concurrency: 4 at a time (configurable). Skips repos that already
  have a tree in cache.
- Skips repos whose `state !== 'ok'`. Marks them as "could not list"
  in the UI.
- Returns a `Map<repo, paths>` and a `Map<repo, error>`.

### `src/similarity/compare.ts`

Pure, no I/O. `compareAll(trees: Map<repo, paths[]>): Pair[]`. For N
trees, generates N(N−1)/2 pairs. For each pair, builds two `Set<string>`s
from the sorted paths, intersects, unions, computes the score. With
N=200 and ~30 paths each, the total work is on the order of a few
milliseconds — but we put it in a `Web Worker` so the UI never blocks
even on larger inputs.

The function is structured to be tested without the worker:
`compareAll(map)` returns the full pair list and is unit-tested directly.

### `src/similarity/compare.worker.ts`

A small Web Worker that:
1. Receives `{ trees: Record<repo, paths[]> }`.
2. Calls `compareAll(trees)`.
3. Posts back `{ pairs: Pair[] }`.

The page spawns the worker once per run, posts the data, and listens for
the result.

### `src/similarity/format.ts`

- `percent(score: number): string` — formats 0..1 as "NN%" with no
  decimals above 10%, otherwise one decimal.
- `pairLabel(aKey, bKey, aName, bName): string` — short label for the
  table row.

### `src/similarity/report.ts`

Mirrors `src/sheet/exportXlsx.ts` in style:
- `ExportRow` typed with one row per pair, the columns listed in the
  Goal section.
- All text cells, no formulas (matches existing safety rule).
- An "Info" sheet: sheet name, deadline, when the comparison ran, total
  pairs, how many trees could not be fetched.
- `downloadWorkbook(book, fileName)` re-uses XLSX.

### `src/components/SimilarityView.tsx`

Layout:

```
<nav> Back to register | Tab name </nav>
<header>
  <h1>Similarity report</h1>
  <p>How similar the code looks by file names. Not a verdict on copying.</p>
</header>
<progress> comparing 12 of 28 trees / 378 pairs </progress>
<table>
  <thead> A_name | B_name | overlap | only in A | only in B </thead>
  <tbody>
    <row>
      <cell>Salma</cell><cell>Tania</cell>
      <cell>87% Very similar</cell>
      <cell click-to-expand> list of shared paths </cell>
    </row>
  </tbody>
</table>
<button>Download .xlsx</button>
```

State machine for the view: `idle | fetching | comparing | ready | error`.

If the user clicks the tab with no sheet uploaded, redirect to `#/`.

### Edits to existing files

- `src/App.tsx`: add `#/s` route and a "Similarity" nav link.
- `src/styles.css`: small additions; reuse existing tokens.
- `src/state/store.ts`: nothing required; the view reads existing state.

---

## Tests

New tests:
- `src/similarity/compare.test.ts`: pure tests for `compareAll`
  - empty inputs
  - identical inputs (score 1)
  - disjoint (score 0)
  - half-overlap (score 0.5)
  - large N (perf: < 50 ms for N=100 in Node)
- `src/similarity/trees.test.ts`: stub `fetch` and check that
  `sessionStorage` is written and re-read.

Existing tests must still pass:
- `npm test`
- `npm run lint`
- `npm run build`

---

## Phases

The plan is broken into phases. Each phase is independently shippable.
After each phase, update the **Status** section and the **Open
questions** section at the bottom.

### Phase 1 — Pure math + tests (no UI, no fetch)
- Add `src/similarity/types.ts`, `src/similarity/compare.ts`,
  `src/similarity/compare.test.ts`.
- Goal: lock down Jaccard semantics; no async, no fetch.

### Phase 2 — Tree fetcher + cache
- Add `src/similarity/trees.ts`, `src/similarity/trees.test.ts`.
- Goal: with stubbed fetch, get one tree back per repo and cache it.
- No UI yet.

### Phase 3 — Web Worker + page-side orchestration
- Add `src/similarity/compare.worker.ts`.
- In `src/similarity/trees.ts`, expose a hook that returns the pairs
  for the current sheet.
- Goal: given a sheet + repos, return a `Pair[]` without changing
  existing components.

### Phase 4 — SimilarityView + routing
- Add `src/components/SimilarityView.tsx` and wire `#/s` in `App.tsx`.
- Goal: tab works in-browser, showing the table.

### Phase 5 — .xlsx download
- Add `src/similarity/report.ts`.
- Goal: the "Download .xlsx" button works.

### Phase 6 — Polish
- Empty / error states.
- "Sign in to GitHub to speed this up" hint when slow.
- Mobile layout.
- Dark mode (reuse existing tokens).

### Future phases (not in this iteration)
- Token-aware tree fetch (would need a Worker route that calls
  `GET /repos/{owner}/{name}/git/trees/{sha}?recursive=1` with the
  token; adds quota cost).
- Content-level matching (sha256 of files), per the next
  "Open question".

---

## Open questions (to revisit after each phase)

1. **Content-level matching?** For now we only compare paths. Should
   we add an opt-in "also compare file SHAs" pass? (Each repo's tree
   already returns SHAs; comparing SHAs across overlapping paths
   catches exact copies of unchanged files.)
2. **What threshold should the "Suspicious" chip use?** Current default
   is ≥80%. The instructor may want to tune it.
3. **Should we show the actual paths in the comparison, or just the
   count?** Showing paths is more useful but exposes repo structure.
4. **Branches: only default branch, or every branch?** Default-only
   keeps it cheap. Multi-branch would require N more tree calls per
   repo.

---

## Iteration log

Update this on every change to the plan.

- **2026-10-04, iteration 0**: initial plan. Decisions: browser-only,
  file-name Jaccard, N×N, browser + xlsx. Identified free-tier and
  5,000/hr trade-offs.
- **2026-10-04, iteration 1**: starting Phase 1 (pure Jaccard math +
  tests). No UI, no fetch. User confirmed math=pairs=report decisions
  are locked.
- **2026-10-04, iteration 2**: Phase 1 done. Added
  `src/similarity/{types,compare,compare.test}.ts`. 17 new tests pass
  (comparePair, compareAll, jaccard, pairCount, tier); 150/150 total.
  Lint and build clean. Notable type fix: `TreeMap` relaxed from
  `ReadonlyMap` to `Map` so callers can construct it without casts;
  `compareAll` never mutates the input (it builds its own `Set`s).
- **2026-10-04, iteration 3**: starting Phase 2 (tree fetcher +
  sessionStorage cache).
- **2026-10-04, iteration 4**: Phase 2 done. Added
  `src/similarity/{trees,trees.test}.ts`. 12 new tests pass (cache
  hit/miss, dedup, TTL, truncated-tree-as-error, 403/404/network/malformed
  mapping, fetchAll dedup + concurrency + progress + per-repo errors,
  clearCache scoping); 162/162 total. Lint and build clean. Two
  bugs caught by tests and fixed: (a) `normalize()` did not dedup
  duplicated paths in the same response; (b) `readCache`/`writeCache`
  read from the global `sessionStorage` instead of the `options.storage`
  injected in tests, so the cache layer was a no-op in tests and in any
  non-browser host. Both fixed by signature (`storage: Storage | null`
  threaded through every call).
- **2026-10-04, iteration 5**: Phase 3 done. Added
  `src/similarity/{compare.worker.ts, run.ts, run.test.ts}`. The
  Worker is a tiny wrapper around `compareAll`; Vite will bundle it
  when imported via `new Worker(new URL('./compare.worker.ts',
  import.meta.url), { type: 'module' })`. `run.ts` provides the
  page-side glue (`comparableRepos`, `treeInputs`, `runComparison`)
  with an injectable `compare` so tests can stub the math. 6 new
  tests pass; 168/168 total. Lint and build clean.
- **2026-10-04, iteration 6**: Phase 4 done. Added
  `src/similarity/{format.ts, format.test.ts}` for percent/tier
  display helpers, and `src/components/SimilarityView.tsx` for the
  UI. Wired a new `#/s` route into `App.tsx` and added "Register" /
  "Similarity" tabs in the masthead. `useRoute()` now returns a
  discriminated `Route` instead of `{ rowId }`. The view uses a
  `useSimilarityRun` hook that drives a `RunOutcome` state machine
  (`idle | fetching | comparing | ready | error`) and posts to the
  Web Worker via `new Worker(new URL(...), { type: 'module' })` so
  Vite emits `compare.worker-*.js` as a separate chunk (verified in
  the build output: 0.75 kB). Refactor needed: oxlint flagged
  `set-state-in-effect` on the original synchronous resets; moved
  the state into a single `RunOutcome` discriminated union so all
  setState calls happen inside the async callback. 5 new tests pass;
  173/173 total. Lint and build clean.