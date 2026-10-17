# Final Destination

A submission register and gradebook that runs in your browser. Upload an Excel
sheet, set a deadline, and the page tells you who pushed in time, who did not,
which files changed, and which repos hold identical files or share code. It marks the class
too: one rules table for everyone, and a bonus box per student for the marks
you give while asking questions.

- **No login.** The sheet is read in this browser. Names, IDs and marks are
  never sent to a server.
- **Two uploads on the home page** — you choose which kind of sheet it is.
  - **Project base**: `id`, `name` and `repolink`. One repo per student,
    one deadline, the whole repo checked.
  - **Lab / Performance base**: the same three columns, plus any of your own
    (earlier marks, a section), which are kept. Each repo holds a `Mid` and
    a `Final` folder of lab tasks; each term has its own deadline and is
    judged by its own folder only, and the lab tasks in it are listed.
- **Marking.** Type a **total mark**, the **marks off for late**, the
  **marks off for changed after deadline** and the **mark for no
  submission**; every student's final mark updates as you type. Each row has
  a **Bonus** box (Enter goes to the next student; a minus sign takes marks
  off). The final mark never goes below 0 or above the total, and a failed
  check never costs marks.
- **Deadline in one place.** Type it once; the register sorts, the person
  page draws it across the timeline, and the file's Info sheet records it.
- **Similarity tab.** Repos that hold identical files, and who had them on
  GitHub first. Below that, **shared code**: repos that share code even
  where a copy was edited (spaces, line endings, case, comments or some
  lines changed), with links to the shared lines on both sides. Places to
  look, not a verdict.
- **Contribution tab.** Who committed to each repo and
  how large each person's share of the commits is, counted the same way as
  the report's "Commits by person" column. A repo handed in by several people
  is shown once, with all of them.
- **Reports as `.xlsx`.** Results, Summary, Needs attention, Same repo,
  Info. The same colours as the page, the same dates as the page. The
  deduction, bonus and final mark are added at the end of Results, "Late by"
  is spelled out ("2 days 4 hours 15 minutes"), and Info records the rules.

For the long version — every column, every status, every rule, the build,
the API, the limits — see [docs/SHEETS.md](docs/SHEETS.md). For marking and
how Mid and Final are judged, see [docs/GRADING.md](docs/GRADING.md).

## Run it on your computer

Needs Node 22.22 or newer (`.nvmrc` says 22).

```sh
npm install
cp .dev.vars.example .dev.vars   # then put your GitHub token in it
npm run dev                      # http://localhost:5173
```

The token must be a **fine-grained** GitHub token with **Public repositories**
access and **no permissions**. Create one at
<https://github.com/settings/personal-access-tokens/new>. It can read nothing
private. `.dev.vars` is ignored by git; never commit a token.

```sh
npm test           # unit and screen tests
npm run coverage   # the same, with a coverage report in coverage/
npm run lint       # oxlint
npm run build      # type-check and build
```

GitHub Actions runs lint, tests and build on every push to `main` and every
pull request (`.github/workflows/ci.yml`). After a push to `main` it also
puts the app online, but only when all three passed (see
[docs/SHEETS.md](docs/SHEETS.md#put-it-online-cloudflare-workers-free-plan)).

## What to read next

- [docs/SHEETS.md](docs/SHEETS.md) — the full feature reference: the project
  register, the performance register, the similarity check, the API, the
  limits, the build.
- [docs/GRADING.md](docs/GRADING.md) — the rules table, the bonus, the final
  mark, and how a lab sheet's Mid and Final folders are judged.

## License

This project keeps to the same license as the existing repository.
