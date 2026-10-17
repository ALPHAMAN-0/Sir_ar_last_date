# Sir_ar_last_date — work status

Updated 2026-10-17. The app is built and online at
https://sir-ar-last-date.sir-last-date.workers.dev, including the similarity
rewrite (deployed 2026-10-06, version 4f73fa07).

## Done
- [x] Server (`worker/`): GitHub client with quota reserve and back-off, six routes,
      request validation, cache headers, per-visitor rate limits.
- [x] Sheet reader, column detection and column picker.
- [x] The status rule (On time / Changed after deadline / Late / No submission / Not found).
- [x] Push time for every commit, and the timeline with the deadline line.
- [x] Screens: upload, register table (sort, filter, search), person timeline with
      changed files, phone layout, dark mode.
- [x] Excel export in the on-screen order.
- [x] Security headers (`public/_headers`), strict Content-Security-Policy.
- [x] Similarity tab: identical files by content, starter files, people who handed in
      the same repo, and a six-sheet `.xlsx` report (see README).
- [x] Deployed to Cloudflare Workers on 2026-10-05 (before the similarity rewrite).
- [x] Similarity checked end to end on a local Worker against real GitHub: the demo
      sheet, 16 real repos (one with 6,232 files) and 55 forks of one repo, on the dev
      server and on the production build. No console errors, no CSP violations.
- [x] Similarity rewrite committed.
- [x] Tests for the store (`src/state/store.test.ts`): loading in batches, splitting a
      failing batch, dropping late answers, push-log paging, refresh, saving in the browser.
- [x] Screen tests (`src/components/*.test.tsx`, jsdom + Testing Library).
- [x] CI on GitHub Actions: lint, tests and build on every push and pull request.
- [x] `npm run coverage`; coverage output is no longer committed.
- [x] README with diagrams.
- [x] Deployed 2026-10-06 and checked live: security headers present, edge cache
      answers a repeat (`cf-cache-status: HIT`), `/api/v1/tree` works, an uncached
      request from another site gets 403, and the token is in no response and no
      built file.
- [x] Similarity, "who had it first" (2026-10-07): for each pair, which repo had the
      shared files on GitHub first, from the push log and the files at each pushed
      commit; a repo is named only when that is clear, otherwise "Cannot tell". New
      column, evidence in the opened pair, and a seventh sheet in the report (see README).
      Checked in a headless browser with a faked API and with this repo's real push log.
- [x] Results report (2026-10-07): the Notes columns are gone, and a First push date
      stands between Repo created and Last push. It is read when Download is pressed,
      the same way the person screen reads it (see README, "The results report").
- [x] Results report (2026-10-08): a **Commits by person** column after Branch, who
      committed on the main branch with their commits and share, merges included and
      shown. Read when Download is pressed, after the first pushes, from the same commit
      lists the person screen uses (see README, "The results report").
- [x] Padding commits (2026-10-08): the Worker says per file whether the text changed
      beyond whitespace (judged from the diff, which still never leaves the Worker);
      "Check commits" on the Register reads the files of every commit on screen (newest
      200 per repo) and the report tells real, tiny, only-whitespace and empty commits
      apart per person, with a "Padding commits" number column; the person screen tags
      each commit and sums them up per person (see README, "The results report").
- [x] Results report (2026-10-08): **Branches** and **Branch names** columns at the end:
      how many branches each repo has and their names, the main branch first. They come
      with the repo facts (the `/repos` query now lists the first 100 branches), so the
      download asks GitHub nothing more (see README, "The results report").
- [x] Contribution tab (2026-10-14, in the working tree, not committed): a third tab,
      `#/c`, with every repo of a project sheet once, who committed to it, their commits
      and their share, counted as the report's "Commits by person" column counts them.
      24 new tests; the evidence is in `.claude/tdd/contribution-tab.tdd.md`.
- [x] Marking and two uploads (2026-10-17, in the working tree, not committed): an
      always-light warm paper + sage look; the home page's two uploads (Project base,
      Lab / Performance base); a rules table per project and per term (total, late,
      changed after, no submission) in force as typed; a Bonus box per student with
      Enter to the next; Mid / Final judged by their own folders; marks at the end of
      the Results sheet and "Late by" spelled out. Evidence in
      `.claude/tdd/marking.tdd.md`; see docs/GRADING.md.
- [x] Checked against real GitHub on the local Worker with a real token (2026-10-14),
      on 4 well-known repos and 14 public forks of one starter repo: the repo facts
      (name, main branch, head commit, created, last push, fork, parent) equal
      `git ls-remote` and GitHub's REST API for all 18; all 87 files equal
      `git ls-tree` in path, hash and size; the pairs equal a recount from scratch;
      `parent` and `template` equal the REST API's fields; "who had it first" read
      "A first" for a repo and its fork and "Same source" for two forks of one repo,
      and named nobody else. The statuses for a deadline in the middle of that class
      were right by the push log, except for the fork case listed below.

## Not done
- [ ] Go online from GitHub Actions only when the tests pass (2026-10-07). The
      `deploy` job works: both secrets are on GitHub since 2026-10-08, and the push of
      `c8304be` went online through it. One step is left: disconnect the repo under
      the Worker's **Settings > Builds** at Cloudflare. On that same push Cloudflare's
      own build still ran too, and it deploys without waiting for the tests: commit
      `94c21d7` went online on 2026-10-06 with 4 failing tests.
- [ ] The per-visitor rate limiter did not trigger on the live site: 107 different
      `/repos` requests from one address in under a minute (limit 40) all got 200.
      Cloudflare calls the limiter "permissive, eventually consistent", but 2.7x is
      a lot. Find out why. Until then the quota reserve (stop at 500 left) is the
      only brake, so one visitor could use up the hour for everyone.
- [ ] Test the register against real GitHub with a deadline (expected: AboutMe reads
      "Changed after deadline" for a deadline of 2026-09-25 13:00 Dhaka time; a private
      repo reads "Not found").
- [ ] Choose a license if the repo is or becomes public.

## Edge cases found 2026-10-14, not fixed
Each one was reproduced by running the code in throwaway tests outside the repo. The
groups from "Who had it first" to "Status" are in the committed code (`c8304be`), so
they are online. With a clean sheet (a link header the app knows, one plain link per
cell) the sheet group does not show: that is the case checked against real GitHub above.

### "Who had it first" names a repo it should not
- A third repo that holds one of the files turns "Each had some first" into "A first".
  A led on one file, B on the other; B's lead is dropped because of the third repo, A's
  stays, and B reads "likely copied from A". It also happens when the third repo's push
  log could not be read. `first.ts`, `rank` and `judgePair`.
- Less data gives the stronger answer. When the later repo's push log cannot be loaded
  (an error, the hourly limit, a push in the last ten minutes) or reading stops part way,
  its earlier versions of the files are not seen and it is named, where the full history
  reads "Cannot tell". The row is then "ready": opening it asks for nothing more.
  `first.ts` `arrivalOf`, `conflictOf`; `firstRun.ts`.
- The same content at two paths (a `backup/` copy): earlier versions are looked for at one
  of the paths only, and which one depends on the order of the sheet. One order reads
  "Cannot tell", the other names a repo. `first.ts` `sharedBlobs`, `arrivalOf`.
- The earlier-versions check looks only at the files the first repo led on; a repo of the
  sheet that had the files first but changed them since is not looked at; two pushes in
  the same second mix up the commit-date check; exactly one hour apart is named (the
  README says more than an hour). A fork of the other repo is named without any check,
  and a commit without a GitHub login does not count as its author's: both on purpose.
- Found right: A and B are never swapped between the comparison, the screen and the report.

### Similarity
- A group larger than the starter limit that hands in one solution gives no pair, and no
  warning when each of them has one file of their own: 5 of 20, 7 of 30, 11 of 60. The
  only trace is the "Starter files that are not counted" list.
- After "Try again" loads one more repo, "count every file" is no longer in force and the
  box shows a limit that is not the one used. `SimilarityView.tsx`, `chosenLimit`.
- One file kept in many folders counts once per folder: 1 content in 12 folders reads
  "50% Mostly identical", and that label is what turns the wording to "likely copied".
- Small: the suggested limit is a fifth of the repos loaded, not of those compared; one
  student on two rows reads "handed in by more than one person"; 79.5% is printed as
  "80% Mostly identical"; lock files and compiled files outside the fixed lists
  (`deno.lock`, `a.out`) are compared.
- Found right: `analyse` equals a from-scratch recount on 9,000 random classes.

### A sheet row gets the wrong repo, or goes missing
- A student's row is taken for the header row, and that student and everyone above are
  not on the register. It takes a link header the app does not know by name ("Project
  Link", "GitHub Repository Link", "Submission Link") and a student's cell whose text is
  a link word (a hyperlink labelled "GitHub", "Link", "Repo"); or a sheet without a header
  row whose first student has no link. `columns.ts` `detectMapping`. The column picker
  cannot move the header row.
- A link cell with anything else in it. A full stop at the end, or a line break and more
  text, give another repo name (`task-1.`, `task-1main`): "Not found". "Repo: https://…",
  a link in brackets, two links in one cell: "Invalid link". `parseRepoLink.ts`.
- Text of the form x/y ("Fall/2025", "18/20") counts as a repo link, so with an unknown
  link header the guess can land on that column and everybody reads "Not found".
- A UTF-8 `.csv` without a byte-order mark is read as Latin-1: Bengali and accented names
  are garbled, and a link beside a no-break space is invalid. `parseSheet.ts`.
- More than 1,000 people: a `.csv` never says that the sheet was cut, an `.xlsx` with
  1,001 to 1,015 people does not either. Columns past the 40th are not offered.
- One repo under its old and its new name is not marked "Same repo as another row" on the
  register (`judgeRows` counts by the sheet's link). The Similarity tab and the report's
  Same repo sheet do put the two together. Seen with `zeit/ms` and `vercel/ms`.
- Small: a Google Forms sheet shows the timestamp as ID and the e-mail as name until the
  columns are picked; a hidden first tab is the one that is read; in a `.csv` an ID that
  looks like a date or a number is rewritten.
- Not seen, only possible: a repo that GitHub answers in part (an error under one of its
  fields) is passed on by the Worker as healthy and reads "No submission". `routes/repos.ts`.

### Status
- A failed "any branch" look is stored as an empty list. Opening the person or pressing
  Download then clears the failure, and the row turns from "Check failed" to "Late". It
  takes a main branch made or renamed after the deadline and one failed request.
  `store.ts` `loadProbe`, `readActivity`; `verdict.ts`.
- A fork whose owner first pushed after the deadline reads "Changed after deadline", not
  "Late": the commits the fork came with count as work in time. 4 of the 14 real forks in
  the check above. `verdict.ts`, "The log begins after the branch already had commits".
  This is the "fork-aware logic" under Later.
- The person screen says "GitHub received it on …" from the main branch's log alone. A
  commit pushed in time to another branch and merged after the deadline is described as
  received late. `Timeline.tsx`, `pushAttribution.ts`.
- Refresh while a push log longer than one page is being read drops the pages read but
  keeps the cursor: the newest pushes are lost and "Changed after deadline" becomes "On
  time" until the page is reloaded. `store.ts` `readActivity`, `refresh`.
- The deadline is saved as the typed text and read again in the browser's time zone at the
  next start: after a change of zone it is another moment.
- A main branch made after the deadline from a commit that was in time reads "Changed after
  deadline" once the repo has more than 100 earlier pushes (the look reads one page). A
  main branch switched without a push keeps the old branch's log across Refresh.
- A Refresh that the hourly limit refuses turns every row into "Check failed".
- Padding: a commit that only moves code, a Python indentation fix and a file move count as
  "only whitespace". This is the README's rule taken by the letter.

### Contribution tab and "Commits by person"
- A committer is whoever the commit names. Like the date, the author of a commit is
  written on the author's own computer. GitHub records who pushed; that is not shown.
- One person under two identities (a linked e-mail and an unlinked one) is two lines.
- In a fork the parent's authors are in the list. The tab says so; it does not subtract.

### Performance base (the work of 2026-10-13), replaced 2026-10-17
The auto-detected performance screen is gone: the home page now has two uploads
(Project base, Lab / Performance base) and the teacher chooses. Its edge cases above
no longer apply: a lab sheet is read with its repo links and keeps its other columns
(saved, so they survive a reload); a failed check gives no mark instead of 0; the
"Switch sheet type" text in `docs/SHEETS.md` was rewritten. The `sirar:v1` key is
still not cleared.

### Marking and lab sheets (2026-10-17), known limits
- A term folder must be at the top of the repo; `CSE101/Mid` is not found.
- The push that changed a term folder is found by halving, which assumes a folder
  that arrived stays and one that reached its final state stays in it. A folder
  changed and changed back is dated by its last arrival in that state.
- "Late by" on a lab row counts to the push that brought or last changed the folder;
  the Person page's timeline still shows every push to the repo.
- A bonus follows the student ID; two rows with one ID share a bonus.
- No sorting by final mark yet.

### Later, by choice
- Similarity: a "starter repo" field, comparing the commit at the deadline, a
  direction between two forks of one starter repo, and reading on past 40 pushes
  for a repo that grew slowly (see "Open questions" in SIMILARITY.md). A
  token-level comparison for edited copies was considered on 2026-10-07 and
  decided against.
- By-date screen across all people, inline diff viewer, fork-aware logic,
  per-row deadlines, access code, private repos.
