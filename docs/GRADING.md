# Grading — the auto-deduction rules

This page is the spec for the **performance base** mark deduction. The
short overview is in the project
[README](../README.md); the long feature reference is in
[SHEETS.md](SHEETS.md).

The rules are local: the totals live only in this browser, in
localStorage. They are never sent to a server. Reloading the page
keeps them. Switching to a project base sheet keeps them too — the
rules are tied to the teacher, not to the file.

---

## The three inputs

Above the performance table there is a small box with three fields and
an **Apply** button:

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| **Total mark** | number, or empty | empty | The ceiling the final mark is clamped to. Leave empty to clamp only at 0. |
| **Marks off for late** | number, ≥ 0 | `0` | Subtracted from each late row. |
| **Marks off for changed after deadline** | number, ≥ 0 | `0` | Subtracted from each row that pushed both before and after the deadline. |

Pressing **Apply** saves the rules and the table recomputes
immediately. A small state line under the box says the current rules
in plain English, e.g.:

> Total: 100 · Late: −20 · Changed after: −10

The three numbers are independent. A teacher who only cares about one
of them can leave the others at `0`.

### What the box rejects

The box keeps the previous value and shows a one-line error when:

- The value is empty in a way the app cannot read (a stray space, a
  letter, a `–` instead of `-`).
- The value is negative.
- The value is not a finite number (`Infinity`, `NaN`).

The error sits under the offending field; the rest of the box keeps
its value. The Apply button is the only way to commit a change; the
teacher can also press **Enter** while focus is in any of the three
inputs.

---

## The four deduction cases

The deduction is a pure function in
[`src/logic/grading.ts`](../src/logic/grading.ts). It is total: it
covers every status the register can return, and it never throws.

The signature, in plain English:

```
applyDeductions(mark, status, rules) → { final, lines }
```

- `mark` is the original mark, a number or `null`.
- `status` is the row's status (see [SHEETS.md](SHEETS.md#statuses-on-a-performance-sheet)).
- `rules` is `{ totalMark, offForLate, offForChanged }`.

The function returns:

- `final` — the new mark, or `null` when the input was `null`.
- `lines` — a list of human-readable explanations, joined into one
  cell in the workbook.

### The four cases

| Status | `final` | `lines` |
| --- | --- | --- |
| `on_time` / `has_work` / `not_applicable` | `mark` (unchanged) | `[]` |
| `late` | `mark − offForLate`, clamped to `[0, totalMark]` | `['Late: −N']` |
| `changed_after` | `mark − offForChanged`, clamped to `[0, totalMark]` | `['Changed after deadline: −N']` |
| `no_submission` / `not_found` / `invalid_link` / `check_failed` | `0` (clamped) | `['No work: 0']` |

`not_applicable` is the status of a performance sheet that has no
`repolink` column: there is no repo to check, so there is no
deduction. The original mark is exported as the final mark.

### Clamping

`final` is clamped to `[0, totalMark ?? Infinity]`. A negative mark
becomes `0`; a mark above the total is reduced to the total. With
`totalMark` empty (the default), the upper bound is **open** — there
is no upper clamp.

The clamp applies per row, after the deduction. It does not apply to
the **lines**: the line `Late: −20` always reads `−20`, even if the
resulting mark was already at `0`.

### `null` and non-numeric

- A `null` mark (an empty cell in the sheet) stays `null`. The lines
  are `[]`. The workbook exports an empty cell.
- A non-numeric mark in the sheet is also `null`; the page reads the
  cell with `Number()` and discards anything that does not parse.
- `Infinity` and `NaN` are rejected by the grading box itself, so
  they never reach the function.

### Why the lines are an array, not a string

Two deductions in the future — a row that is both late **and** changed
after the deadline — would yield `['Late: −20', 'Changed after
deadline: −10']`. The workbook joins them with `; `, so the cell
reads `Late: −20; Changed after deadline: −10`. The array keeps the
parts sortable in Excel without parsing the joined string.

---

## Three worked examples

The teacher has typed:

> Total: **100** · Late: **−20** · Changed after: **−10**

### Example 1 — a late row

A student pushed their repo one hour after the deadline. The sheet
had a midterm mark of **80**. The function sees `status === 'late'`
and `mark === 80`.

```
final = clamp(80 − 20, 0, 100) = 60
lines = ['Late: −20']
```

The Results sheet row reads:

| Row | ID | Midterm | Status | Final mark | Deduction |
| --- | --- | --- | --- | --- | --- |
| 2 | 22-46001-1 | 80 | Late | 60 | Late: −20 |

### Example 2 — a changed-after row

Another student pushed their first commit on Monday, then pushed a
fix on Wednesday — after the deadline. The sheet had a midterm mark
of **95**. The function sees `status === 'changed_after'`.

```
final = clamp(95 − 10, 0, 100) = 85
lines = ['Changed after deadline: −10']
```

| Row | ID | Midterm | Status | Final mark | Deduction |
| --- | --- | --- | --- | --- | --- |
| 3 | 22-46002-1 | 95 | Changed after | 85 | Changed after deadline: −10 |

### Example 3 — a row with no link column (a pure-marks sheet)

The teacher uploaded a sheet with `id | name | midterm | final` and
**no** `repolink` column. Every row's status is `not_applicable`.

A student has `midterm: 70, final: 20`. The function sees
`status === 'not_applicable'`.

```
final = 70 + 20 = 90   (the mark is the total of the cells; deductions do not apply)
lines = []
```

The Results sheet exports the original cells in their own columns
(Midterm, Final), then **Total** = 90, then Status = "Not graded",
then Final mark = 90, then Deduction = *(empty)*.

If the sheet had a link column, the same row would have had a real
status, and the deductions would have applied. The link column is the
switch between "pure marks" and "marks + repo check".

---

## What the page does on Reload

On reload, the page reads the saved rules from localStorage and
re-uses them. A teacher who set `Total: 100, Late: −20, Changed: −10`
once sees the same rules the next time they open the page, regardless
of the sheet. Switching between sheets keeps the rules too. Switching
to a project base sheet keeps the rules; they just do not show until
a performance sheet is uploaded.

The rules are not exported to the workbook as a single line — they go
on the **Info** sheet in three labelled rows (`Total mark`, `Off for
late`, `Off for changed`). A future teacher opening the same workbook
sees which rules the file was generated under, even if the page has
since been re-configured.

---

## What the function does **not** do

- It does not invent a total mark from the sheet's columns. The
  `Total` column in the report is the **sum of the cells the sheet
  shipped with**; the `Total mark` rule is the upper clamp on the
  `Final mark`. The two are not the same number, and that is on
  purpose: a teacher who wants the sum to be the cap types the cap
  in once.
- It does not add deductions. `Late: −20` and `Changed after: −10`
  are independent rules; a row that is both would lose `−30` in
  future iterations, not `−20`. The current implementation handles
  the four single-status cases only.
- It does not look at the original mark when deciding the deduction.
  A late row with `mark === 0` still has `Late: −20` in the lines;
  the row's `final` is `0` because of the clamp, but the teacher
  sees that the rule applied.
- It does not persist the per-row deduction. The `lines` are
  recomputed from the row's status and the rules on every render.

For the in-code reference, see
[`src/logic/grading.ts`](../src/logic/grading.ts) and its test file
[`src/logic/grading.test.ts`](../src/logic/grading.test.ts). Every
status, every clamp boundary, and the `null` path are unit-tested.
