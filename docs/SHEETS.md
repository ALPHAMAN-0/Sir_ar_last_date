# Sheets — the full feature reference

This is the long version. It documents every column, every status, every rule,
the API, the build, and the limits, for both **project base** and
**performance base** sheets. The short overview lives in the project
[README](../README.md); the deduction rules in detail live in
[GRADING.md](GRADING.md).

The similarity module has its own design log in
[../SIMILARITY.md](../SIMILARITY.md). It is iterated on, not a one-shot
spec.

---

## Contents

- [The two sheet types](#the-two-sheet-types)
- [Project base — the register](#project-base--the-register)
  - [Columns](#columns)
  - [Statuses](#statuses)
  - [The Person page](#the-person-page)
  - [Downloading the report](#downloading-the-report)
- [Performance base — grades](#performance-base--grades)
  - [Columns](#columns-1)
  - [The grading box](#the-grading-box)
  - [Statuses on a performance sheet](#statuses-on-a-performance-sheet)
  - [Downloading the report](#downloading-the-report-1)
- [Auto-detection and the escape hatch](#auto-detection-and-the-escape-hatch)
- [Persistence and privacy](#persistence-and-privacy)
- [The Worker (the API)](#the-worker-the-api)
- [Build, test, lint, deploy](#build-test-lint-deploy)
- [Limits and known quirks](#limits-and-known-quirks)

---

## The two sheet types

A teacher uploads **one** sheet at a time. The page auto-detects which kind
it is, and routes to the right screen:

| Kind | Has | The page shows | Reports |
| --- | --- | --- | --- |
| **Project base** | `id`, `name`, `repolink` | The register: who pushed in time, who did not, which files, which repos | Results, Summary, Needs attention, Same repo, Info |
| **Performance base** | `id`, `name`, one or more numeric mark columns | The performance register: original marks, status, final mark, deduction breakdown | Results, Summary, Info |

Detection rules: if the sheet has a recognisable GitHub link column, it is
treated as a project base. If it has no link column but at least one
numeric mark column, it is treated as a performance base. The auto-detect
is usually right; if it is not, the upload panel shows a "Switch sheet
type" button. See [Auto-detection](#auto-detection-and-the-escape-hatch).

Only one sheet kind is in memory at a time. Uploading a new sheet
replaces the current one; the kind is preserved on reload, the rules are
preserved on reload.

---

## Project base — the register

### Columns

The app reads the first non-empty row as the header. Three columns are
required:

| Header hint (case-insensitive) | Used as |
| --- | --- |
| `id`, `ID`, `roll`, `roll no`, `student id` | The student's ID. |
| `name`, `student`, `student name` | The student's name. |
| `repolink`, `repo`, `github`, `github link`, `link` | The GitHub repo URL or `owner/name`. |

The header hints are case-insensitive and tolerant of spaces and
underscores. If the picker cannot guess a column, it shows a dropdown
and the teacher picks one. The chosen mapping is saved in localStorage
for the next file with the same name.

Extra columns are ignored. A sheet may be a `.xlsx` or a `.csv`. Files
larger than 5 MB are read but the teacher is warned.

### Statuses

For every student, the app works out a **status** by comparing the
repo's last push to the deadline. The status drives the colour and
the chip on each row.

| Status | When | Colour |
| --- | --- | --- |
| `on_time` | The repo's last push is at or before the deadline. The repo is not empty. | Green |
| `has_work` | The repo has commits, the deadline has not passed yet, and the last push is before now. | Green (softer) |
| `late` | The last push is after the deadline. | Red |
| `changed_after` | A commit exists at or before the deadline **and** another after it. | Red (softer) |
| `no_submission` | The repo is empty, or the branch was created after the deadline. | Grey |
| `not_found` | The link is well-formed but the repo is private, deleted, or mistyped. | Grey |
| `invalid_link` | The cell is not a GitHub link the app can read. | Grey |
| `check_failed` | The Worker could not be reached. The status is held in "checking" until it is. | Yellow |

The same colour, the same label, the same date appear in the downloaded
workbook. The page also draws a small **Same repo** line when two
students handed in the same GitHub repo.

### The Person page

Clicking a row opens a per-student page with:

- The student's id, name, and the repo link as it was typed and as
  GitHub spells it.
- The full commit history at the time of the deadline (one entry per
  commit, newest first, with the day headings and the deadline line
  drawn across the timeline).
- The first push of the repo, the last push, the total number of
  commits, the default branch, and a list of every branch seen.
- Notes that explain the status in words ("Link could not be read",
  "Same repo as another row", "Repo was renamed or moved", etc.).

The Person page is only relevant for project base. For a performance
sheet, the row links to the same view but it just says "this is a
performance sheet" because there is no repo to open.

### Downloading the report

The "Download .xlsx" button in the masthead writes a workbook with the
following sheets:

| Sheet | Contents |
| --- | --- |
| **Results** | One row per student: row number, id, name, repo URL, repo name, status, first push, last push, commits, branch, notes. Coloured to match the page. |
| **Summary** | Counts by status, totals, the sheet name, the deadline, the time the report was generated. |
| **Needs attention** | Only the rows whose status needs the teacher's eyes. |
| **Same repo** | One row per group of students that handed in the same GitHub repo. |
| **Info** | The source sheet, the deadline (in UTC and in the browser's zone), the rules used, the Worker URL. |

File name: `register-YYYY-MM-DD-HHMM.xlsx` in the browser's local zone.

---

## Performance base — grades

### Columns

The same header rules apply. Two columns are required (`id`, `name`); the
rest are **mark columns**. The app decides a column is a mark column
when at least three cells in it parse as finite numbers and the header
is not one of `id`, `name`, `link`, `repolink`, `repo`, `github`,
`branch`, `branches`, `notes`, `comment`, `comments`, or empty.

A mark column is shown under its own header, in the order the sheet has
them. Its cells are written back to the report as they were typed (so a
`"30"` is exported as `"30"`, not as `30`).

The sheet is capped at **1,000 rows**. Larger sheets are truncated and
the upload panel says so.

### The grading box

Three inputs live above the table, like the existing deadline box:

| Field | Default | What it does |
| --- | --- | --- |
| **Total mark** | empty | The ceiling the final mark is clamped to. Leave empty to clamp only at 0. |
| **Marks off for late** | `0` | Subtracted from each late row. |
| **Marks off for changed after deadline** | `0` | Subtracted from each row that pushed both before and after the deadline. |

Pressing **Apply** saves the rules to localStorage. The table and the
download update immediately. A small state line under the box says the
current rules in plain English.

If the teacher types a negative or non-numeric value, the box rejects
the change, restores the previous rule, and shows a one-line error.

### Statuses on a performance sheet

If the sheet also has a `repolink` column, the status is the same as
for a project base (see above), and the deductions apply. If the sheet
has no link column, every row's status is `not_applicable`, the Status
column reads **Not graded**, and the Final mark equals the original
mark with no deduction.

The four deduction cases are detailed in [GRADING.md](GRADING.md). A
short version:

- `on_time` / `has_work` / `not_applicable` — no deduction.
- `late` — `−offForLate`.
- `changed_after` — `−offForChanged`.
- `no_submission` / `not_found` / `invalid_link` / `check_failed` —
  final mark is `0`, the original is shown next to it.

The `final` mark is clamped to `[0, totalMark]`. A `null` mark (an
empty cell) stays `null` through the function; the report exports it
as an empty cell.

### Downloading the report

The "Download .xlsx" button writes:

| Sheet | Contents |
| --- | --- |
| **Results** | One row per student: row number, id, name, every mark column (as typed), the total of the marks, the status, the final mark, the deduction lines (joined into one cell). |
| **Summary** | Counts by status, the sheet name, the rules, the time the report was generated. |
| **Info** | The source sheet, the rules, the deadline, the Worker's URL. |

File name: `performance-YYYY-MM-DD-HHMM.xlsx` in the browser's local
zone.

---

## Auto-detection and the escape hatch

The detector lives in [`src/sheet/kind.ts`](../src/sheet/kind.ts).
It is a pure function called from
[`detectMapping`](../src/sheet/columns.ts) right after the header
row is read.

The rules, in order:

1. **Has a link column.** The sheet has a column whose header matches
   one of the link hints **and** at least one cell in that column
   parses as a GitHub URL → **project**.
2. **No link column, has a mark column.** At least one column is not
   `id`/`name`/`link` and has three or more cells that parse as
   finite numbers → **performance**.
3. **Neither.** The app falls back to **project**, and the
   `ColumnPicker` shows a yellow note that the mapping may be wrong.

When the auto-detect is wrong — a performance sheet happens to have
a link in a notes column, say — the upload panel shows a small
"Switch sheet type" link. Clicking it re-runs the detector with the
opposite kind, preserves the column choices, and routes to the new
screen.

The kind is persisted to localStorage next to the sheet, the mapping,
and the deadline, so reloading the page keeps the right screen open.

---

## Persistence and privacy

The page stores **only** what fits in localStorage:

- The chosen `kind` and the column mapping.
- The last deadline, the last grading rules.
- The status of each row (`checking` / `done` / `failed`).
- A few UI preferences (active tab, sort order, filter text).

The sheet itself is **not** stored. Re-uploading the same sheet from
the same name restores the mapping and the deadline, but the file
itself has to be picked again.

No name, id, repo link, or mark is sent to a server by the page.
The Worker, when it has a token, makes the GitHub calls for the
teacher; the responses come back to the browser. The Worker is on
the same origin as the page; CORS is not in the way.

---

## The Worker (the API)

The Worker is a thin shim around `api.github.com`. It exists for two
reasons:

1. **The token never reaches the browser.** A fine-grained GitHub PAT
   is read from the Worker's environment, not the page.
2. **Rate-limit headroom.** The Worker has a 5,000 / hour budget
   shared with one teacher; the page always uses it last.

The four routes, all under `/api/v1/`:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/v1/repo` | GET | One repo's metadata, plus the head oid, the default branch, the branches list, `parent` and `templateRepository`. |
| `/api/v1/log` | GET | The push log of one repo, oldest first, capped at 2 pages. |
| `/api/v1/tree` | GET | A recursive file listing at a commit, with `{ path, sha, size }` per file, capped at 1 MB. |
| `/api/v1/first` | GET | A push log + a file listing at every pushed commit, oldest first, until every shared file has been seen. |

The token must be a **fine-grained** GitHub PAT with
**Public repositories** access and **no permissions**. Create one at
<https://github.com/settings/personal-access-tokens/new>. Set it as a
Worker secret with `wrangler secret put GITHUB_TOKEN`; for local
development, put it in `.dev.vars` (see the project README). The
Worker refuses any token that has scopes attached, and refuses any
non-`api.github.com` host on the outbound side.

The Worker also returns 4xx / 5xx with a small JSON body so the page
can say "could not be reached" without parsing prose. The
`check_failed` status is held for any error other than `401` (token
wrong) and `404` (repo not found).

---

## Build, test, lint, deploy

The four commands from the project README, with what they do:

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server at <http://localhost:5173>. The Worker is reached through the Vite plugin's `/api/v1/*` proxy. |
| `npm test` | Vitest, one pass. Includes the unit, integration, and component (jsdom) tests. |
| `npm run coverage` | The same, with a coverage report in `coverage/`. The threshold is **80 % lines / 80 % statements**; the project runs slightly above. |
| `npm run lint` | oxlint, the same rules the CI uses. |
| `npm run build` | `tsc -b && vite build`. The output goes to `dist/`; the Worker is bundled separately by the Cloudflare Vite plugin. |
| `npm run deploy` | `npm run build && wrangler deploy`. Only runs after lint, test, and build are green on `main`. |

GitHub Actions runs lint, tests and build on every push to `main` and
every pull request (`.github/workflows/ci.yml`). After a push to
`main` it also deploys the app, but **only** when all three passed.

Node **22.22 or newer** is required (see `.nvmrc`). The package
manager is npm; the lockfile is `package-lock.json`.

---

## Limits and known quirks

- **1,000-row cap.** The performance register caps the sheet at
  1,000 rows. Larger sheets are truncated; the upload panel says so.
- **Same-origin only.** The Worker must live on the same origin as
  the page, or the page will fall back to anonymous GitHub calls
  and lose the rate-limit headroom.
- **The token has no scopes.** A token with `repo` or any other scope
  attached is rejected. Use the fine-grained form, "Public
  repositories" only.
- **No CORS, no server storage.** The page never sends the sheet
  anywhere. If you reload, the sheet itself has to be picked again;
  the column mapping and the deadline are kept.
- **N×N similarity.** For N repos, the page compares N(N−1)/2 pairs.
  With 200 repos and ~30 paths each, the math is in the
  milliseconds; the bottleneck is fetching the trees, which the
  Worker caches and the page caches again in `sessionStorage`.
- **The `Who had it first` column is conservative.** It says
  "Cannot tell" whenever the evidence does not prove a direction
  (see [../SIMILARITY.md](../SIMILARITY.md) for the design log). A
  wrong accusation is the failure to avoid.
- **Two cells per row, not one.** The Results sheet exports every
  original mark in its own column, then adds a `Final mark` and a
  `Deduction` column. The Deduction cell is a single cell with the
  lines joined by `; `, so it is sortable in Excel without parsing
  the lines.
- **Local time in the file name, UTC in the cell.** The downloaded
  workbook's file name uses the browser's local zone (so two teachers
  in two zones do not collide on the same minute), but the cells
  inside the workbook are UTC. The Info sheet records both.

For the deduction rules in full, see
[GRADING.md](GRADING.md). For the long-running iteration log on the
similarity checker, see [../SIMILARITY.md](../SIMILARITY.md).
