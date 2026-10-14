# TDD Evidence Report — Contribution tab

**Date:** 2026-10-14
**Branch:** `main`, working tree only (nothing committed, see "Checkpoint commits")
**Test runner:** Vitest 5.0.3 (`npm test` = `vitest run`; package manager npm, from `package-lock.json`)
**Lint:** oxlint (`npm run lint`)
**Type-check and build:** `npm run build` (`tsc -b && vite build`)

## Source plan

No plan file. The request was: *"add a feature like project contribution base … it will say the
contribution name and the percentage of the person"*. The journeys below were derived from that
during this run. Choices made without asking, to be confirmed by the owner:

- It is a third tab on a project sheet (`#/c`), not a third kind of sheet: the input is the same
  sheet (id, name, repo link).
- A person's percentage is their share of the commits on the main branch, the same count as the
  results report's "Commits by person" column (`src/logic/commitShares.ts`). Lines changed are not
  counted.
- People are named as GitHub names them (login, or the name in the commit). Sheet rows are not
  matched to committers: the sheet has no GitHub user names, and a wrong match would be worse than
  none.

## User journeys

1. As a teacher, I want to open a Contribution tab and see, for every repo of my sheet, who
   committed to it and each person's share of the commits, so that I can see who did the work.
2. As a teacher with group projects, I want a repo that several people handed in shown once with
   all of them, so that I can compare the members with the people who really committed.
3. As a teacher, I want every row without commits to count listed with its reason, so that nobody
   is silently missing.
4. As a teacher, I want to be told when a repo's commits could not be read, and to try again, so
   that I never read an empty list as "nobody worked".
5. As a teacher, I want the numbers to be those of the results report, so that the screen and the
   file never disagree.

## RED → GREEN → refactor

| Stage | Validation command | Result | What it proves |
|---|---|---|---|
| RED 1 | `npx vitest run src/contribution` | `Error: Cannot find module './rows.ts'`, 0 tests | The unit tests were written first; the missing module is the intended signal. |
| GREEN 1 | `npx vitest run src/contribution` | first run 7/11: four tests used `github.com/team/…`, and `team` is a GitHub site page that `parseRepoLink` rightly rejects. Test data changed to `crew/…`, no production change: 11/11 | `summariseContribution` and `filterContribution` do what the tests say. |
| RED 2 | `npx vitest run src/components/ContributionView src/App.test` | `Failed to resolve import "./ContributionView.tsx"`; `App.test.tsx` 2 failed: no link named "Contribution", no heading "Contribution" at `#/c` | The screen and the route did not exist. |
| GREEN 2 | same command, plus `src/contribution` | 28/28 | Screen, route `#/c` and the third tab work. |
| RED 3 | `npx vitest run src/components/ContributionView` | `expected [ … (13) ] to have a length of 10 but got 13` | A long list of committers was not cut. |
| GREEN 3 | same | 29/29 | Ten people first, the rest summed up, "Show all N people". |
| RED 4 | same | `Unable to find an element with the text: 5 commits by 2 people, including the ones the fork came with` | A fork did not say that its parent's commits are counted. |
| GREEN 4 | same | 31/31 | The fork note. |
| Refactor | `npx vitest run src/components/ContributionView src/App.test src/contribution qa`, `npx tsc -b`, `npx oxlint` | 37/37, clean, clean | "The register is still checking" is decided in one place (the hook). Two branch tests added for `rows.ts`. |
| Full run | `npm run build`, `npx oxlint`, `npx vitest run --coverage` | build ok, lint 0/0, **731/731 in 54 files** | Nothing else broke (705 tests before this feature). |

### Checkpoint commits

None were made. The working tree already held uncommitted work from another tool in files this
feature also touches (`src/App.tsx`, `src/styles.css`, `README.md`), so a commit of "only this
feature" was not possible without also committing that work, and a push to `main` goes online.
The RED and GREEN results above are from the commands as run; the tree was red only for the few
minutes between a test being written and its implementation.

## Files

| File | Change |
|---|---|
| `src/contribution/rows.ts` (new) | Pure: groups the sheet's rows by repo, joins them with the commit shares, keeps every row without commits with its reason; the search filter. |
| `src/components/ContributionView.tsx` (new) | The screen. Reads through the existing `loadCommitShares`, repo by repo. |
| `src/state/hooks.ts` | Route `#/c`. |
| `src/App.tsx` | Third tab, and the route. |
| `src/logic/commitShares.ts` | `percentOf` exported (one word), so the screen writes a share as the report does. |
| `src/styles.css` | `.contribution__*` rules, appended. |
| `qa/buttons.json`, `qa/buttons.d.ts` | The tab and its back link, for the click harness. |
| `README.md` | One bullet. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Every committer of a repo is named with commits, merges and share | `rows.test.ts > names every committer of a repo with their commits and their share` | unit | PASS |
| 2 | A share is written as the report writes it (`67%`, `<1%`), and the shares add up to 1 | `> writes a share the way the results report does` | unit | PASS |
| 3 | A repo handed in by several people is one entry, members in sheet order | `> shows a repo handed in by several people once, with all of them in sheet order` | unit | PASS |
| 4 | The old and the new link of a renamed repo are one repo | `> puts the old and the new name of a renamed repo together` | unit | PASS |
| 5 | With both links read, the answer that could be read wins | `> takes the answer that could be read when a renamed repo was asked for under both links` | unit | PASS |
| 6 | Invalid link, not found, check failed, empty repo and never-pushed fork are kept with their reason | `> keeps every row without commits to count, with the reason` | unit | PASS |
| 7 | Rows the register is still checking are counted as waiting, not as missing | `> counts the rows the register is still checking` | unit | PASS |
| 8 | `loading` until read, `failed` when unreadable | `> says loading until the commits were read, and failed when they could not be` | unit | PASS |
| 9 | A history longer than 1,000 commits says so | `> says when only the newest commits of a long history were counted` | unit | PASS |
| 10 | Padding commits per person after a check; `null`, not 0, without one | `> gives each person their padding commits once the commits were checked` | unit | PASS |
| 11 | An empty commit list is "counted, nothing in it" | `> shows a repo whose commits hold nobody to name as counted, with nothing in it` | unit | PASS |
| 12 | Search by member, ID, repo or committer; empty search gives everything | `filterContribution > …` (2 tests) | unit | PASS |
| 13 | The screen shows each repo's committers, commits and percentages, the repo link, and the summary line | `ContributionView.test.tsx > shows every repo with its committers, their commits and their share` | screen (jsdom, fake API) | PASS |
| 14 | A shared repo appears once with "Handed in by 2 people" | `> shows a repo handed in by several people once, with all of them` | screen | PASS |
| 15 | One commit-list request per repo, however many rows name it | `> reads each repo's commits once, however many people handed it in` | screen | PASS |
| 16 | Rows that cannot be counted are listed with the link and the reason | `> lists the rows it cannot count, with the reason` | screen | PASS |
| 17 | An unreadable repo is announced; "Try again" asks only for that repo | `> says when the commits of a repo could not be read, and reads them again on Try again` | screen | PASS |
| 18 | The search box narrows the list; "Show every repo" resets it | `> narrows the list with the search box, and says when nothing matches` | screen | PASS |
| 19 | A sheet with no usable repo says so and asks GitHub nothing | `> says when no row of the sheet leads to a repo with commits` | screen | PASS |
| 20 | A repo with no commit to count says so | `> says so for a repo whose history holds no commit to count` | screen | PASS |
| 21 | Ten people first; the rest summed up; "Show all" | `> shows the ten people with the most commits first, and the rest on request` | screen | PASS |
| 22 | A fork says its parent's commits are counted | `> says that a fork is counted with the commits it came with` | screen | PASS |
| 23 | A truncated history says so on screen | `> says when only the newest commits of a long history were counted` | screen | PASS |
| 24 | The Padding column appears only for a repo that was checked | `> adds the padding commits of each person once the commits were checked` | screen | PASS |
| 25 | The tab is in the masthead and `#/c` opens the screen | `App.test.tsx > shows the register at #/, with both tabs`, `> opens the contribution tab at #/c` | screen | PASS |
| 26 | Clicking the tab and its back link logs no error | `qa/test-it.test.tsx` (`header.tab.contribution`, `contribution.back`): 24 buttons, 22 pass, 2 skip, 0 fail | click harness | PASS |

## Checked outside the test suite

Run from throwaway scripts kept outside the repo, against the local Worker (`npx vite`, the
owner's token in `.dev.vars`) and real public repos:

- The contribution summary for a real class of 18 repos (4 well-known repos and 14 public forks of
  `octocat/Spoon-Knife`): the commit total and the merge count of every repo equal
  `git rev-list --count HEAD` and `git rev-list --merges --count HEAD` of a fresh clone
  (for example `vercel/ms`: 190 commits, 25 merges). 19 requests, 3 seconds.
- `octocat/Hello-World` and `vercel/ms` recounted from GitHub's REST commit list, independently of
  the Worker's GraphQL route: same people, same counts, same percentages (190 commits, 42 people,
  the ten first identical, the other 32 with 35 commits).
- The screen in headless Chrome at 1280 px and 390 px, dark and light: no console error or
  warning. On a phone the bar is shorter so that names fit.

## Coverage

`npx vitest run --coverage`

```
All files                            92.97 % stmts | 86.99 % branch | 92.86 % funcs | 94.80 % lines
src/contribution/rows.ts               100 % stmts |   100 % branch |   100 % funcs |   100 % lines
src/components/ContributionView.tsx  97.10 % stmts | 93.33 % branch |   100 % funcs |   100 % lines
```

## Known gaps

1. A committer is whoever the commit names. Like a commit date, the author of a commit is written
   on the author's own computer; GitHub records who *pushed*, and that is not shown here.
2. One person with two identities (commits under a linked email and under an unlinked one) is two
   lines, as in the results report.
3. In a fork, the parent's authors are in the list. The screen says so; it does not subtract them.
4. Reading a large class is bound by the Worker's 40 commit-list requests a minute per visitor.
   The page waits and carries on; a repo that still fails gets "Try again".
5. No test waits on a slow register: "Waiting for the register…" is covered at the unit level only.
