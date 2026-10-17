# Sheets — the full feature reference

This is the long version. It documents every column, every status, every rule,
the API, the build, and the limits, for both **project base** and
**lab / performance base** sheets. The short overview lives in the project
[README](../README.md); marking (the rules table, the bonus, Mid and Final)
in detail lives in [GRADING.md](GRADING.md).

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
- [Lab / Performance base — Mid and Final](#lab--performance-base--mid-and-final)
- [Marking](#marking)
- [Persistence and privacy](#persistence-and-privacy)
- [The Worker (the API)](#the-worker-the-api)
- [Build, test, lint, deploy](#build-test-lint-deploy)
- [Limits and known quirks](#limits-and-known-quirks)

---

## The two sheet types

The home page has **two uploads**, one per kind of sheet. The teacher chooses;
nothing is guessed. A file dropped on (or chosen from) a card is read as that
card's kind.

| Kind | The sheet has | Each repo holds | Judged against |
| --- | --- | --- | --- |
| **Project base** | `id`, `name`, `repolink` | the project | one deadline, the whole repo |
| **Lab / Performance base** | `id`, `name`, `repolink`, and any other columns (earlier marks, a section) | a `Mid` folder and a `Final` folder of lab tasks | one deadline per term, that term's folder only |

Both kinds open the same register, with the Similarity and Contribution tabs,
the rules table and the Bonus and Final mark columns. A lab sheet adds the
Mid / Final switch, a Lab tasks column and its own columns.

**Replace sheet** reads the new file as the same kind. To change kind, press
Clear and use the other card. Each card has its own sample sheet.

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

On a lab sheet the status at the top is the term's (judged by its folder);
the timeline still shows every push to the repo.

### Downloading the report

The "Download .xlsx" button in the masthead writes a workbook with the
following sheets:

| Sheet | Contents |
| --- | --- |
| **Results** | One row per student, in the register's columns, then who committed, padding commits and branches, then the marks: Deduction, Bonus, Final mark. A lab sheet adds Term folder, Lab tasks and its own columns before the marks. "Late by" is spelled out ("2 days 4 hours 15 minutes"). Coloured to match the page. |
| **Summary** | Counts by status, totals, the sheet name, the deadline, the time the report was generated. |
| **Needs attention** | Only the rows whose status needs the teacher's eyes. |
| **Same repo** | One row per group of students that handed in the same GitHub repo. |
| **Info** | The source sheet, the deadline, the time zone, how lateness is judged, the kind of sheet (and term), the rules table the marks were made with, and what each status means. |

File name: `register-YYYY-MM-DD-HHMM.xlsx` in the browser's local zone.

---

## Lab / Performance base — Mid and Final

Each student keeps one repo with a folder per term at its top:

```
repo/
  Mid/      Lab 1/  Lab 2/  Lab 3/
  Final/    Lab 4/  Lab 5/
```

The register's **Mid term / Final term** switch picks the term being marked.
Each term keeps its own deadline, rules table and bonuses; switching back
brings them back. A row is judged by **that term's folder only**, so Final
work pushed after the Mid deadline leaves Mid on time. The folder names that
count, the table of cases and how the pushes are dated are in
[GRADING.md](GRADING.md#a-lab-sheet-mid-and-final).

The sheet's other columns (anything that is not the ID, the name or the
link, up to 12) are carried along: shown in the register after the lab tasks
and written into the file, numbers as numbers. A cell that starts with `=`
stays text; nothing is ever written as a formula.

The page reads each term folder one level at a time, by commit hash
(`/api/v1/tree?flat=1`): the head commit, the commit at the deadline and, only
when the folder changed, a few pushes found by halving. These answers never
change, so the Worker and the page keep them.

---

## Marking

Both kinds have a **Marking rules** box (total mark, marks off for late, marks
off for changed after deadline, mark for no submission), in force as it is
typed, and a **Bonus** box on every row, with Enter moving to the next
student. The final mark is the total, minus the rule for the row's status,
plus the bonus, kept between 0 and the total; a row whose check failed gets
no mark. The full rules, with a worked example, are in
[GRADING.md](GRADING.md).

---

## Persistence and privacy

The page keeps in this browser's localStorage, under one key:

- The sheet's rows (row number, ID, name, the link as typed) and, for a lab
  sheet, its carried columns. The file itself is not kept.
- The kind of sheet and, for a lab sheet, the term being marked.
- The deadline and the rules table of the project, of Mid and of Final.
- Every bonus, by term and student ID.
- The sort order.

What is read back is checked: a value of the wrong type or out of range is
dropped, never used. **Clear** removes all of it.

No name, ID, mark or bonus is sent to a server. The page asks the Worker
only about repos: their facts, their push logs, their files and folders.

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

- **1,000-row cap.** The register reads the first 1,000 people of a
  sheet. Larger sheets are cut; the register says so.
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
- **Term folders sit at the top of the repo.** A `Mid` folder inside
  another folder is not found, and the row reads "No submission" with
  "No folder for this term in the repo".
- **Local time in the file name, UTC in the cell.** The downloaded
  workbook's file name uses the browser's local zone (so two teachers
  in two zones do not collide on the same minute), but the cells
  inside the workbook are UTC. The Info sheet records both.

For marking in full, see [GRADING.md](GRADING.md). For the long-running iteration log on the
similarity checker, see [../SIMILARITY.md](../SIMILARITY.md).
