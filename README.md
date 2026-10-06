# Sir ar Last Date

A submission register for GitHub repos. Upload an Excel sheet of people and repo
links, set a deadline, and see who pushed in time, who did not, which files
changed on which date, and which repos hold identical files.

No login is needed. The sheet is read inside the browser; names and IDs are never
sent to a server. The page keeps the sheet and the deadline in this browser, so
they are still there after a reload, until **Clear** on the Register removes them.
On a shared computer, press Clear when you are done.

- [What it does](#what-it-does)
- [How it fits together](#how-it-fits-together)
- [The sheet](#the-sheet)
- [How a status is decided](#how-a-status-is-decided)
- [The similarity check](#the-similarity-check)
- [Run it on your computer](#run-it-on-your-computer)
- [Put it online](#put-it-online-cloudflare-workers-free-plan)
- [Limits and protection](#limits-and-protection)
- [The API](#the-api)
- [How it is built](#how-it-is-built)

## What it does

| Screen | What you see |
|--------|--------------|
| **Register** | One row per person: status, how late, repo created, last push, last commit, number of commits. Sort, filter by status, search, and download a results report as `.xlsx`. |
| **Person** | Open a row to see the commits grouped by date, the files each commit changed, and the deadline drawn across the timeline. |
| **Similarity** | Which people handed in the very same repo (a 100% match), which different repos hold files with exactly the same content and how much, and a report as `.xlsx`. |

## How it fits together

Three parts: the page in your browser, a small Worker at Cloudflare, and GitHub.
The Worker exists for one reason: to keep the GitHub token out of the browser.

```mermaid
flowchart TD
  subgraph B["Your browser"]
    SHEET["Excel sheet<br/>read here, never uploaded"] --> PAGE["The page<br/>register, person, similarity"]
    PAGE <--> WW["Web Worker<br/>compares the file lists"]
    PAGE --> XLSX["Excel downloads"]
  end
  subgraph CF["Cloudflare, free plan"]
    ASSETS["Static files<br/>page, fonts, scripts"]
    CACHE["Edge cache"] --> W["Worker, /api/v1<br/>checks, rate limit, token"]
  end
  PAGE -- "is loaded from" --> ASSETS
  PAGE -- "asks with repo names only" --> CACHE
  W -- "asks with the token" --> GH["GitHub API<br/>public repos only"]
```

What happens when a sheet is uploaded and a deadline is set:

```mermaid
sequenceDiagram
  actor T as Teacher
  participant P as Page in the browser
  participant W as Worker
  participant G as GitHub API

  T->>P: Drop the Excel sheet
  Note over P: Read the sheet here,<br/>find the columns,<br/>clean every repo link
  loop 20 repos per request
    P->>W: GET /api/v1/repos
    W->>G: one GraphQL query
    G-->>W: created, last push, head commit
    W-->>P: repo facts, cached 60 s
  end
  Note over P: Judge every row from these facts
  T->>P: Set the deadline
  opt only for repos pushed after the deadline
    P->>W: GET /api/v1/activity
    W->>G: push log of the main branch
    G-->>W: the time of every push
    W-->>P: push events, cached a day
  end
  P-->>T: On time, Changed after deadline, Late
```

## The sheet

Three columns, in any order. Header names are matched loosely (`Repo Link`,
`GitHub URL`, `Student ID` all work), and a column picker appears if the guess is wrong.

| id | name | repolink |
|----|------|----------|
| 22-46001-1 | Rahim Uddin | https://github.com/octocat/Hello-World |
| 22-46002-1 | Nusrat Jahan | https://github.com/octocat/Spoon-Knife |
| 22-46003-1 | Tanvir Ahmed | github.com/octocat/octocat.github.io |

`.xlsx`, `.xls` and `.csv` are accepted, up to 1,000 people and 5 MB. Repos must be public.
`demo-sheet.xlsx` in this folder is a sheet you can try.

## How a status is decided

Lateness is judged by the moment **GitHub received the push** on the repo's main
branch. Commit dates are written on the author's own computer and can be set to
anything, so they are shown only for reference.

| Status | Meaning |
|--------|---------|
| On time | Everything on the main branch reached GitHub before the deadline |
| Changed after deadline | Work was pushed in time, and more was pushed after the deadline |
| Late | Nothing had reached GitHub when the deadline passed |
| No submission | The repo exists but is empty |
| Not found | No public repo at that link (private, deleted or mistyped) |
| Invalid link | The cell does not hold a GitHub repo link |
| Check failed | GitHub could not be reached; press Refresh |

A deadline of 23:59 includes the whole minute, up to 23:59:59. Before the deadline
has passed, the wording is softer: "Submitted" and "Nothing yet". With no deadline
set, a repo with commits reads "Has work".

The rule, as it is written in `src/logic/verdict.ts`:

```mermaid
flowchart TD
  L{"Does the cell hold<br/>a GitHub repo link?"}
  L -- no --> INV["Invalid link"]
  L -- yes --> F{"Did GitHub find the repo?"}
  F -- "no such public repo" --> NF["Not found"]
  F -- "GitHub did not answer" --> CHK["Check failed"]
  F -- yes --> E{"Does it have commits?"}
  E -- no --> NS["No submission"]
  E -- yes --> D{"Is a deadline set?"}
  D -- no --> HW["Has work"]
  D -- yes --> C{"Was the repo created<br/>after the deadline?"}
  C -- yes --> LATE["Late"]
  C -- no --> P{"Was the last push<br/>after the deadline?"}
  P -- no --> OT["On time"]
  P -- yes --> LOG["Read the push log<br/>of the main branch"]
  LOG --> M{"Did the main branch move<br/>after the deadline?"}
  M -- "no, only another branch" --> OT
  M -- yes --> B{"Was anything on GitHub<br/>by the deadline?"}
  B -- no --> LATE
  B -- yes --> S{"Is the branch back at<br/>the commit it had then?"}
  S -- yes --> OT
  S -- no --> CA["Changed after deadline"]
```

Open a person to see their commits grouped by date, the files each commit
changed, and the deadline drawn across the timeline. Commits that reached GitHub
after the deadline are marked, even when their own date says otherwise.

### The results report

**Download .xlsx** on the Register writes the rows on screen, in the order on
screen. When a filter or a search is on, the Summary says so ("3 of 15").

| Sheet | One row per | Holds |
|-------|-------------|-------|
| Summary | status | how many people have it and their share, who needs attention, who shares a repo, the deadline and check time |
| Results | person | status, how late, notes, dates, commits, branch, and a clickable repo link |
| Needs attention | late, changed, empty, missing or broken row | the most urgent first, with what to do about each |
| Same repo | repo handed in by several people | their IDs, names, sheet rows and statuses |
| Info | | how lateness is judged and what each status means |

Each status has its colour (green on time, amber changed, red late or empty, grey
missing), header rows are bold and stay in view while scrolling, and every
column has a filter button. Dates are real Excel dates; names are plain text,
never formulas.

## The similarity check

The Similarity tab answers one question: **which repos hold files with exactly
the same content?**

Git gives every file a hash of its content. Two files with the same hash are the
same byte for byte, in any repo and under any name. So a copy is found even when
the files were renamed or moved to other folders. The page reads only file names,
hashes and sizes; it never downloads the files themselves.

```mermaid
flowchart TD
  A["Repos from the sheet"] --> B{"Same repo handed in<br/>by several people?"}
  B -- yes --> B1["Shown first,<br/>with their names"]
  A --> C["File list of each repo:<br/>path, content hash, size"]
  C --> D{"Too large to list<br/>in one request?"}
  D -- yes --> D1["Read it folder by folder,<br/>skipping node_modules<br/>and the like"]
  D -- no --> E
  D1 --> E["Fixed rules: leave out<br/>what nobody wrote"]
  E --> F["Count how many repos<br/>hold each content"]
  F --> G{"In more repos<br/>than the limit?"}
  G -- yes --> G1["Starter file:<br/>not counted"]
  G -- no --> H["Compare the repos<br/>that share a content<br/>(in a Web Worker)"]
  H --> I["For each pair:<br/>identical files,<br/>share of A, share of B"]
  I --> J["Table on the screen"]
  I --> K["Report as .xlsx"]
```

### What is never compared

Two repos must not look alike only because both ran `npm install`. These are
left out before anything is counted (`src/similarity/rules.ts`):

| Left out | Examples |
|----------|----------|
| Third-party and build folders, on any level | `node_modules`, `vendor`, `venv`, `dist`, `build`, `target`, `bin`, `obj` |
| What tools write | anything starting with a dot (`.gitignore`, `.github/`, `.vscode/`), lock files, `*.config.js`, `tsconfig.json`, `*.min.js` |
| Pictures, fonts and compiled files | `png`, `jpg`, `svg`, `woff2`, `class`, `jar`, `exe`, `sqlite` |
| Almost empty files | anything under 64 bytes |

Documents and archives (`pdf`, `docx`, `zip`) are compared: an identical report
is as telling as identical code.

### Starter files

A content that many repos hold was probably handed out by the teacher or written
by a project generator. It is not counted on either side of a percentage.

"Many" is a fifth of the compared repos, but never fewer than 4 and never more
than 10. You can change the limit on the page; the result updates at once.

When a repo is left with nothing but starter files, the page says so. One or two
such repos are people who added nothing of their own. Many at once can also mean
that one solution went round: open the list of starter files, and if you see
students' own work there, raise the limit.

### Reading a pair

For a pair of repos A and B the page shows how many of A's compared files are
also in B, and the other way round. **Match** is the larger of the two shares, so
a small repo that sits completely inside a bigger one reads 100%.

| Label | When |
|-------|------|
| Same repo | one repo handed in by several people: 100%, listed first |
| Almost all identical | Match of 80% or more |
| Mostly identical | 50% or more |
| Partly identical | 20% or more |
| Small part identical | under 20% |
| Only a small file or two | fewer than 3 identical files **and** under 1 KB in total, whatever the percentage |

Open a pair to see the files: identical ones (with both paths when the copy was
renamed), files with the same name but other content, and what each rule left out.
Open a "Same repo" row to see everyone who handed it in and its files.
"Same commit in both repos" means one repo is a copy of the other's whole history.

### What it cannot see

- **A copy in which every file was changed**, even by one character. The hash of
  a changed file is different. In practice a copied project keeps most files
  untouched, but a short single-file exercise can slip through.
- **A generator used by only a few people.** If three people out of thirty used
  the same project template, its files are not yet "many" and will show as
  identical. The file list of the pair makes this easy to spot.
- **Private repos**, and branches other than the main one.

It is a list of places to look, not a verdict. Read the files before you decide
anything.

### The report

**Download .xlsx** on the Similarity tab writes a workbook with six sheets.

| Sheet | One row per | Holds |
|-------|-------------|-------|
| Pairs | repo handed in by several people (first, at 100%), then pair of repos with identical files | result, match, both people and repo links, counts and shares |
| Matching files | identical file | pair number, path in A, path in B, size |
| Same repo | repo handed in by several people | their IDs, names and sheet rows |
| People | row of your sheet | compared or not and why, files compared, closest match with its repo and percentage |
| Starter files | content left out as starter file | name, number of repos, size |
| Info | | when and how the report was made, and what it cannot see |

Every row of the uploaded sheet appears on the People sheet, so nobody is
silently missing. Percentages are real numbers (they sort and filter), repo
links are clickable, results are coloured, header rows stay in view, and every
column has a filter button. Names and paths are written as plain text, never as
formulas.

## Run it on your computer

Needs Node 22.22 or newer (`.nvmrc` says 22).

```sh
npm install
cp .dev.vars.example .dev.vars   # then put your GitHub token in it
npm run dev                      # http://localhost:5173
```

The token must be a **fine-grained** GitHub token with **Public repositories**
access and **no permissions**. Create one at
<https://github.com/settings/personal-access-tokens/new>. It can read nothing private.
`.dev.vars` is ignored by git; never commit a token.

```sh
npm test           # unit and screen tests
npm run coverage   # the same, with a coverage report in coverage/
npm run lint       # oxlint
npm run build      # type-check and build
```

GitHub Actions runs lint, tests and build on every push to `main` and every pull
request (`.github/workflows/ci.yml`). It does not deploy.

## Put it online (Cloudflare Workers, free plan)

```sh
npx wrangler login                     # once
npx wrangler secret put GITHUB_TOKEN   # paste the token at the prompt
npm run deploy
```

The address is `https://sir-ar-last-date.<your-subdomain>.workers.dev`.

To replace an expired token, run the `secret put` command again. Nothing else
needs to change. After changing code, run `npm run deploy` again.

## Limits and protection

Every visitor shares one GitHub token, so each request passes several gates
before it may cost anything:

```mermaid
flowchart TD
  Q["Request queue in the page<br/>6 at a time, no duplicates,<br/>waits when told to"]
  Q --> EC{"Does the edge cache<br/>have the answer?"}
  EC -- yes --> A["Answered without<br/>running the Worker"]
  EC -- no --> V{"GET, from this page,<br/>spelled the one right way?"}
  V -- no --> R1["400, 403 or 405"]
  V -- yes --> RL{"Is the visitor under<br/>the rate limit?"}
  RL -- no --> R2["429: wait 30 s"]
  RL -- yes --> QG{"Are more than 500<br/>of the hourly GitHub<br/>requests left?"}
  QG -- no --> R3["503, with the time<br/>the hour resets"]
  QG -- yes --> GH["GitHub, with the token"]
  GH --> S["Slimmed answer with<br/>its own cache time"]
```

- Answers are cached at Cloudflare's edge: repo facts for 60 seconds; commits,
  changed files and file lists for a week, because a commit id never points at
  other content. Repeated checks cost nothing.
- Each visitor is limited per minute to 40 list requests (repo facts, commit
  lists), 240 detail requests (push logs, changed files) and 120 file lists.
  When a limit is reached the page waits and carries on by itself.
- The app stops calling GitHub when fewer than 500 of the token's 5,000 requests
  per hour are left, so the token owner's own tools keep working. The page then
  says when to try again.
- The token never leaves the server. Other websites cannot call the API.

What things cost in GitHub requests:

| Action | Cost |
|--------|------|
| Checking a sheet of 200 people | about 10, plus one for each person who pushed after the deadline |
| Opening a person | one per commit whose files are shown |
| Similarity, first time | one per repo; a repo too large to list at once costs a few more (never more than 41) |
| Similarity, again | nothing, until someone pushes |

## The API

All routes are `GET` under `/api/v1`, answer JSON, and accept one exact spelling
of each query (`shared/api.ts` builds and checks it on both sides).

| Route | Query | Asks GitHub for | Visitor limit | Cached |
|-------|-------|-----------------|---------------|--------|
| `/repos` | `r=owner/name`, up to 20, sorted | facts of up to 20 repos in one GraphQL query | 40 / min | 60 s |
| `/activity` | `repo`, `v`, optional `ref`, `dir`, `after` | the push log | 240 / min | a day once settled |
| `/commits` | `repo`, `ref`, optional `after` | 100 commits behind a head commit | 40 / min | a week |
| `/commit` | `repo`, `sha`, optional `page` | the files one commit changed | 240 / min | a week |
| `/tree` | `repo`, `sha`, optional `flat=1` | the files of a repo at one commit: path, hash, size | 120 / min | a week |
| `/status` | none | how much of the hourly limit is left | 240 / min | 30 s |

Errors come as `{ "error": { "code", "message" } }`, with `retryAfter` or
`resetAt` when waiting helps.

## How it is built

```
shared/        request rules and types used by both sides
worker/        the server: talks to GitHub, caches, rate-limits
  routes/      /repos, /activity, /commits, /commit, /tree, /status
src/
  sheet/       reading the Excel file, finding columns, the results report, report colours
  logic/       the status rule, push times, sorting, dates
  similarity/  rules, file lists, the comparison, the report
  state/       the store and data loading
  api/         request queue with retries
  components/  the screens
```

The similarity code, file by file:

| File | Job |
|------|-----|
| `rules.ts` | which files are never compared |
| `trees.ts` | loads the file list of each repo, folder by folder when it is too large |
| `run.ts` | groups the sheet's rows by repo; keeps the reason for every row left out |
| `compare.ts` | starter files, identical files per pair, labels |
| `compare.worker.ts` | runs `compare.ts` off the main thread |
| `summary.ts` | what the screen and the report both show |
| `report.ts` | the `.xlsx` workbook |

React, TypeScript and Vite, with the Cloudflare Vite plugin. The Excel library
(SheetJS) is loaded only when a file is chosen or downloaded.

Every rule that decides something is a pure function with unit tests next to it
(`*.test.ts`), and every screen has tests that click through it in a simulated
browser (`*.test.tsx`, jsdom and Testing Library): 372 tests in 32 files. The
tests replace `fetch` with a fake API (`src/test/fakeApi.ts` for the page), so
they never call GitHub.

Not included on purpose: private repos, a login, per-person deadlines, and
storing sheets on the server.
