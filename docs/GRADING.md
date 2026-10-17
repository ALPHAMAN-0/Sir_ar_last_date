# Marking — the rules table and the bonus

This page is the spec for marking, on both kinds of sheet. The short overview
is in the project [README](../README.md); the long feature reference is in
[SHEETS.md](SHEETS.md). The code is
[`src/logic/marking.ts`](../src/logic/marking.ts) (the rules) and
[`src/logic/termFolder.ts`](../src/logic/termFolder.ts) (how a lab sheet's
term is judged).

Everything here lives in this browser only (localStorage, next to the sheet).
No rule, bonus or mark is ever sent to a server.

---

## The rules table

Above the register sits **Marking rules**: four boxes, applied to every
student by the status of their row. There is no Apply button: the marks are
worked out as you type, because working them out asks GitHub for nothing.

| Box | Blank means | What it does |
| --- | --- | --- |
| **Total mark** | not set yet | Full marks. Until it is typed, no final mark is shown or written. |
| **Marks off for late** | 0 | Taken off a **Late** row. One flat amount, however late. |
| **Marks off for changed after deadline** | 0 | Taken off a **Changed after deadline** row. |
| **Mark for no submission** | 0 | The mark of a row with nothing to mark (see below). |

A value the box cannot use (a letter, a negative number, a total of 0, a
number over 100,000) is named in a red line under the box, the box is marked,
and the marks keep the last rules that worked. Half marks (`0.5`) are fine.

A project sheet has one rules table. A lab sheet has one **per term**: Mid
and Final each keep their own deadline and rules (see below).

## The bonus

Each row of the register has a **Bonus** box: the marks you give while you
ask the student questions. It is in force as you type it.

- **Enter** or **↓** goes to the next student's box, **↑** to the one above,
  so a whole class can be marked from the keyboard.
- A minus sign takes marks off (`-1` for a wrong answer).
- A blank box is no bonus. Text that is not a number is marked red and not
  used; the last good bonus stays.
- A bonus belongs to the student **ID** (or to the sheet row when the row has
  no ID), so replacing the sheet with a re-sorted or updated copy keeps each
  bonus with its student. On a lab sheet each term has its own bonuses.

## The final mark

| Status | Starts at |
| --- | --- |
| On time, Has work (no deadline set) | the total |
| Late | total − marks off for late |
| Changed after deadline | total − marks off for changed after deadline |
| No submission, Not found, Invalid link | the mark for no submission |
| Checking, Check failed | **no mark** (blank) |

Then the bonus is added, and the result is kept between **0** and the
**total**: never below 0, never above the total, whatever the bonus.

A row still being checked, or one GitHub could not answer, gets no mark at
all: a failure of the check must never cost a student marks. Press Refresh,
then download again.

Under each final mark the page says what the rules did ("Late −2",
"No submission: 0"). The rule is shown even when the clamp hides it (a late
row with a total of 2 and 5 off for late reads 0, "Late −5").

### Worked example

Total **10** · Late **−2** · Changed after **−1** · No submission **0**

| Student | Status | Bonus | Final mark |
| --- | --- | --- | --- |
| Rahim | On time | 2 | 10 (12, kept at the total) |
| Karim | Late | 1 | 9 (10 − 2 + 1) |
| Nila | Changed after deadline | | 9 (10 − 1) |
| Tanvir | No submission | | 0 |
| Arif | Check failed | 1 | blank |

---

## A lab sheet: Mid and Final

A lab sheet's repos hold one folder per term, at the top of the repo:

```
repo/
  Mid/      Lab 1/  Lab 2/  Lab 3/
  Final/    Lab 4/  Lab 5/
```

The register has a **Mid term / Final term** switch. Each term has its own
deadline, rules table and bonuses, and every row is judged by **that term's
folder only**: pushing Final work after the Mid deadline does not make Mid
late or changed.

**Which folder is the term's.** A top-level folder whose name starts with the
term: `Mid`, `mid`, `Mid Term`, `mid-term`, `Midterm`, `mid_labs`, `Midsem`
for Mid; `Final`, `Final Term`, `finalterm`, `Finals`, `final_labs` for
Final. Not `middle`, not `finalize`, not a file. When two folders fit, the
plainest name (`Mid`, `Midterm`) wins, then A to Z.

**How a term is judged.** The whole repo is judged first, against the term's
deadline, exactly as on a project sheet. Then git's fingerprint of the term
folder (its tree hash, which changes whenever anything inside it changes) is
compared:

| Folder at the deadline | Folder now | Status |
| --- | --- | --- |
| there | the same | **On time**, with the note "Pushed after the deadline, but not to this term's folder" when other folders changed |
| there | changed | **Changed after deadline**, late by the push that left the folder as it is now |
| not there | there | **Late**, late by the push that first brought the folder |
| not there | not there | **No submission**, "No folder for this term in the repo" |
| there | gone | **Changed after deadline**, flagged for a look: "The term's folder was removed after the deadline" |

The pushes in between are found by halving: about log₂ of the pushes after
the deadline are looked at, two or three folder listings for a typical repo.
Each listing is one folder level, asked for by commit hash, so the Worker
caches it for good. This assumes a folder that arrived stays, and a folder
that reached its final state stays in it; a folder that changed and changed
back is dated by its last arrival in that state.

**Lab tasks.** The register and the file list the term folder's sub-folders
(`Lab 1, Lab 2, Lab 3`), or its files when it has no sub-folders. Hidden
names (`.gitkeep`) are left out.

**The sheet's other columns** (earlier marks, a section) are carried along
as they are: shown after the lab tasks, and written into the file, numbers as
numbers. At most 12 are carried.

---

## In the downloaded file

The marks go at the **end** of the Results sheet, so no earlier column moves:

| Column | Project | Lab |
| --- | --- | --- |
| Term folder | | the folder's name, or "No Mid term folder" |
| Lab tasks | | `3: Lab 1, Lab 2, Lab 3` |
| *(the sheet's other columns)* | | as they are |
| **Deduction** | what the rules did, e.g. `Late −2` | same |
| **Bonus** | a number | same |
| **Final mark** | a number, blank when none can be given | same |

**Late by** is spelled out in the file: `2 days 4 hours 15 minutes`.

The **Info** sheet records the kind of sheet (and the term), how a term is
judged, and the rules table the file was made with: Total mark, Marks off
for late, Marks off for changed after deadline, Mark for no submission, and
how the final mark is worked out. A file opened months later still says
which rules made its marks.
