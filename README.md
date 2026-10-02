# Sir ar Last Date

A submission register for GitHub repos. Upload an Excel sheet of people and repo
links, set a deadline, and see who pushed in time, who did not, and which files
changed on which date.

No login is needed. The sheet is read inside the browser; names and IDs are never
sent to a server.

## The sheet

Three columns, in any order. Header names are matched loosely (`Repo Link`,
`GitHub URL`, `Student ID` all work), and a column picker appears if the guess is wrong.

| id | name | repolink |
|----|------|----------|
| 20-41234-1 | Rahim Uddin | https://github.com/rahim/task-1 |
| 20-41235-1 | Karim Hasan | github.com/karim/task-1 |

`.xlsx`, `.xls` and `.csv` are accepted, up to 1,000 people and 5 MB. Repos must be public.

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
has passed, the wording is softer: "Submitted" and "Nothing yet".

Open a person to see their commits grouped by date, the files each commit
changed, and the deadline drawn across the timeline. Commits that reached GitHub
after the deadline are marked, even when their own date says otherwise.

## Run it on your computer

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
npm test         # unit tests
npm run lint     # oxlint
npm run build    # type-check and build
```

## Put it online (Cloudflare Workers, free plan)

```sh
npx wrangler login                     # once
npx wrangler secret put GITHUB_TOKEN   # paste the token at the prompt
npm run deploy
```

The address is `https://sir-ar-last-date.<your-subdomain>.workers.dev`.

To replace an expired token, run the `secret put` command again. Nothing else
needs to change.

## Limits and protection

Every visitor shares one GitHub token, so:

- Answers are cached at Cloudflare's edge (repo facts for 60 seconds, commits and
  file lists for a week), so repeated checks cost nothing.
- Each visitor is limited to 40 list requests (repo facts, commit lists) and 240 detail
  requests (push logs, file lists) per minute.
- The app stops calling GitHub when fewer than 500 of the token's 5,000 requests
  per hour are left, so the token owner's own tools keep working. The page then
  says when to try again.
- The token never leaves the server. Other websites cannot call the API.

Checking a sheet of 200 people costs about 10 requests, plus one for each person
who pushed after the deadline. Opening a person costs one request per commit whose
files are shown.

## How it is built

```
shared/      request rules and types used by both sides
worker/      the server: talks to GitHub, caches, rate-limits
  routes/    /api/v1/repos, /activity, /commits, /commit, /status
src/
  sheet/     reading the Excel file, finding columns, the export
  logic/     the status rule, push times, sorting, dates
  state/     the store and data loading
  api/       request queue with retries
  components/ the screens
```

React, TypeScript and Vite, with the Cloudflare Vite plugin. The Excel library
(SheetJS) is loaded only when a file is chosen or downloaded.

Not included on purpose: private repos, a login, per-person deadlines, and
storing sheets on the server.
