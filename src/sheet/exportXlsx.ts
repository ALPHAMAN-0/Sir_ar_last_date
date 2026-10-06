// The register's download: a results report as an Excel workbook. Loaded only
// when the Download button is pressed, because the Excel library is large.
//
//   Results          the register as it is on screen: same columns, same order, one row per person
//   Summary          how many people have each status, at a glance
//   Needs attention  late, changed, empty, missing and broken rows, with what to do
//   Same repo        repos that more than one person handed in
//   Info             when and how the file was made, and what each status means

import * as XLSX from 'xlsx'
import { STATUS_TONE } from '../logic/people.ts'
import type { Status } from '../logic/verdict.ts'
import { headerCells, saveFile, writeStyledXlsx, type Paint, type SheetStyle } from './xlsxStyle.ts'

export type ExportRow = {
  /** Row number in the uploaded sheet. */
  rowNumber: number
  id: string
  name: string
  /** The repo as the page shows it (`owner/name`), or what the sheet's cell holds when it is not a link. */
  repoName: string
  /** Only set for a validated `https://github.com/owner/name`: these become clickable. */
  repoUrl: string | null
  /** The label as shown on screen. */
  status: string
  statusKey: Status
  needsReview: boolean
  lateBy: string
  lateMinutes: number | null
  notes: string
  repoCreatedAt: string | null
  lastPushAt: string | null
  lastOnTimePushAt: string | null
  lastCommitAt: string | null
  commits: number | null
  branch: string
}

export type ExportInfo = {
  /** The uploaded file's name. */
  sheetName: string
  /** Last on-time millisecond, or null when no deadline is set. */
  deadline: number | null
  checkedAt: number
  zone: string
  /** People in the uploaded sheet; the download can hold fewer when filtered. */
  totalPeople?: number
  /** What the register was filtered by, e.g. "Status: Late". */
  filter?: string | null
}

export type ResultsReport = { book: XLSX.WorkBook; styles: SheetStyle[] }

/** "27 Jan 2011, 01:01": how the page writes a date. */
const DATE_FORMAT = 'dd mmm yyyy, hh:mm'
const MS_PER_DAY = 86_400_000
/** Days between Excel's day zero (30 Dec 1899) and 1 Jan 1970. */
const EXCEL_EPOCH_OFFSET = 25_569

// Every text value is written as a plain string cell. Nothing from the sheet or
// from GitHub is ever written as a formula, so a cell that starts with "=" stays text.
const text = (value: string): XLSX.CellObject => ({ t: 's', v: value })
const number = (value: number | null): XLSX.CellObject =>
  value === null ? text('') : { t: 'n', v: value }
const share = (value: number): XLSX.CellObject => ({ t: 'n', v: value, z: '0%' })
/** The repo by name, as on the page. Clickable only for an address the app validated itself. */
const repo = (row: ExportRow): XLSX.CellObject =>
  row.repoUrl ? { t: 's', v: row.repoName, l: { Target: row.repoUrl } } : text(row.repoName)

/**
 * A real Excel date (so it sorts and filters as a date) showing the same local
 * wall-clock time the page shows. Excel dates carry no time zone.
 */
export function excelDate(instant: string | number | null): XLSX.CellObject {
  if (instant === null) return text('')
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return text('')
  const localMs = date.getTime() - date.getTimezoneOffset() * 60_000
  return { t: 'n', v: localMs / MS_PER_DAY + EXCEL_EPOCH_OFFSET, z: DATE_FORMAT }
}

/** The deadline is stored as the last millisecond of its minute; Excel would round that up. */
const deadlineCell = (deadline: number | null) =>
  deadline === null ? text('No deadline set') : excelDate(Math.floor(deadline / 60_000) * 60_000)

const tonePaint = (status: Status): Paint | null => {
  const tone = STATUS_TONE[status]
  return tone === 'busy' ? null : tone
}
/** A person's row has the colour of their status. A row still being checked has none. */
const statusPaint = (row: ExportRow): Paint | null => tonePaint(row.statusKey)

type Column<Row> = { title: string; width: number; cell: (row: Row) => XLSX.CellObject }

/**
 * A sheet with a header row, column widths and a filter button on every column.
 * `paint` colours a whole row, blank cells included, so the colour is still in
 * view after scrolling right to the dates.
 */
function table<Row>(
  columns: ReadonlyArray<Column<Row>>,
  rows: readonly Row[],
  paint?: (row: Row) => Paint | null,
): { sheet: XLSX.WorkSheet; style: SheetStyle } {
  const sheet: XLSX.WorkSheet = {}
  const cells = headerCells(columns.length)
  const paints = rows.map((row) => paint?.(row) ?? null)
  columns.forEach((column, c) => {
    sheet[XLSX.utils.encode_cell({ r: 0, c })] = text(column.title)
    rows.forEach((row, r) => {
      const address = XLSX.utils.encode_cell({ r: r + 1, c })
      sheet[address] = column.cell(row)
      const tone = paints[r]
      if (tone) cells.set(address, tone)
    })
  })
  const ref = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: columns.length - 1 } })
  sheet['!ref'] = ref
  sheet['!cols'] = columns.map((column) => ({ wch: column.width }))
  sheet['!autofilter'] = { ref }
  return { sheet, style: { freezeHeader: true, cells } }
}

// The register's own columns in the register's own order, so the file reads like
// the screen. On screen the notes sit under the status; here they get the column
// next to it, so the Status filter still lists each status once.
const RESULT_COLUMNS: ReadonlyArray<Column<ExportRow>> = [
  { title: 'Row', width: 6, cell: (row) => number(row.rowNumber) },
  { title: 'ID', width: 16, cell: (row) => text(row.id) },
  { title: 'Name', width: 26, cell: (row) => text(row.name) },
  { title: 'Repo', width: 34, cell: repo },
  { title: 'Status', width: 24, cell: (row) => text(row.status) },
  { title: 'Notes', width: 44, cell: (row) => text(row.notes) },
  { title: 'Late by', width: 12, cell: (row) => text(row.lateBy) },
  { title: 'Repo created', width: 21, cell: (row) => excelDate(row.repoCreatedAt) },
  { title: 'Last push', width: 21, cell: (row) => excelDate(row.lastPushAt) },
  { title: 'Last commit', width: 21, cell: (row) => excelDate(row.lastCommitAt) },
  { title: 'Commits', width: 10, cell: (row) => number(row.commits) },
  // What the screen does not show: for sorting by lateness, and for marking the on-time version.
  { title: 'Late (minutes)', width: 14, cell: (row) => number(row.lateMinutes) },
  { title: 'Last on-time push', width: 21, cell: (row) => excelDate(row.lastOnTimePushAt) },
  { title: 'Branch', width: 12, cell: (row) => text(row.branch) },
]

/** Statuses that ask the teacher to do something, most urgent first. */
const ATTENTION: readonly Status[] = [
  'late',
  'changed_after',
  'no_submission',
  'not_found',
  'invalid_link',
  'check_failed',
  'checking',
]

export function whatToDo(row: ExportRow): string {
  const after = row.lateBy ? ` ${row.lateBy} after it` : ''
  switch (row.statusKey) {
    case 'late':
      return `Nothing had reached GitHub by the deadline.${row.lateBy ? ` The first push came${after}.` : ''}`
    case 'changed_after':
      return `Work was in on time, then changed${after || ' after the deadline'}. Open this person on the page to see which files changed.`
    case 'no_submission':
      return 'The repo is empty: nothing was handed in.'
    case 'not_found':
      return 'No public repo at this link: it is private, deleted or mistyped. Ask for the right link.'
    case 'invalid_link':
      return 'The cell does not hold a GitHub repo link. Ask for the link.'
    case 'check_failed':
      return 'GitHub could not be reached for this row. Press Refresh on the page, then download again.'
    case 'checking':
      return 'Still being checked when this file was made. Download again in a moment.'
    default:
      return row.needsReview ? 'Worth a look yourself: see the notes.' : ''
  }
}

const ATTENTION_COLUMNS: ReadonlyArray<Column<ExportRow>> = [
  { title: 'Row', width: 6, cell: (row) => number(row.rowNumber) },
  { title: 'ID', width: 16, cell: (row) => text(row.id) },
  { title: 'Name', width: 26, cell: (row) => text(row.name) },
  { title: 'Repo', width: 34, cell: repo },
  { title: 'Status', width: 24, cell: (row) => text(row.status) },
  { title: 'Late by', width: 12, cell: (row) => text(row.lateBy) },
  { title: 'What to do', width: 70, cell: (row) => text(whatToDo(row)) },
  { title: 'Notes', width: 44, cell: (row) => text(row.notes) },
]

export function needsAttention(rows: readonly ExportRow[]): ExportRow[] {
  const rank = (row: ExportRow) => {
    const index = ATTENTION.indexOf(row.statusKey)
    return index === -1 ? ATTENTION.length : index
  }
  return rows
    .filter((row) => ATTENTION.includes(row.statusKey) || row.needsReview)
    .sort((x, y) => rank(x) - rank(y) || x.rowNumber - y.rowNumber)
}

type SameRepo = { url: string; rows: ExportRow[] }

/** Repos that more than one row points at, the largest group first. */
export function sameRepoGroups(rows: readonly ExportRow[]): SameRepo[] {
  const byRepo = new Map<string, ExportRow[]>()
  for (const row of rows) {
    if (!row.repoUrl) continue
    const group = byRepo.get(row.repoUrl)
    if (group) group.push(row)
    else byRepo.set(row.repoUrl, [row])
  }
  return [...byRepo]
    .filter(([, group]) => group.length > 1)
    .map(([url, group]) => ({ url, rows: [...group].sort((x, y) => x.rowNumber - y.rowNumber) }))
    .sort((x, y) => y.rows.length - x.rows.length || x.url.localeCompare(y.url))
}

const SAME_REPO_COLUMNS: ReadonlyArray<Column<SameRepo>> = [
  { title: 'Repo', width: 44, cell: (group) => ({ t: 's', v: group.url, l: { Target: group.url } }) },
  { title: 'People', width: 8, cell: (group) => number(group.rows.length) },
  { title: 'IDs', width: 40, cell: (group) => text(group.rows.map((row) => row.id).filter(Boolean).join('; ')) },
  {
    title: 'Names',
    width: 60,
    cell: (group) => text(group.rows.map((row) => row.name || `Row ${row.rowNumber}`).join('; ')),
  },
  { title: 'Sheet rows', width: 16, cell: (group) => text(group.rows.map((row) => row.rowNumber).join(', ')) },
  {
    title: 'Statuses',
    width: 30,
    cell: (group) => text([...new Set(group.rows.map((row) => row.status))].join('; ')),
  },
]

/** The order of the summary: done first, then what went wrong. */
const SUMMARY_ORDER: readonly Status[] = [
  'on_time',
  'submitted',
  'changed_after',
  'late',
  'no_submission',
  'not_found',
  'invalid_link',
  'check_failed',
  'checking',
]

/** Statuses that cannot happen in this mode are left out; rare ones only when they occur. */
function summaryStatuses(rows: readonly ExportRow[], deadline: number | null): Status[] {
  const present = new Set(rows.map((row) => row.statusKey))
  const always: readonly Status[] =
    deadline === null ? ['submitted', 'no_submission'] : ['on_time', 'changed_after', 'late', 'no_submission']
  return SUMMARY_ORDER.filter((status) => always.includes(status) || present.has(status))
}

function summarySheet(rows: readonly ExportRow[], info: ExportInfo): { sheet: XLSX.WorkSheet; style: SheetStyle } {
  const sheet: XLSX.WorkSheet = {}
  const cells = new Map<string, Paint>()
  let r = 0
  const put = (c: number, cell: XLSX.CellObject, paint?: Paint | null) => {
    const address = XLSX.utils.encode_cell({ r, c })
    sheet[address] = cell
    if (paint) cells.set(address, paint)
  }
  const line = (label: string, value: XLSX.CellObject) => {
    put(0, text(label))
    put(1, value)
    r++
  }

  put(0, text('Submission report'), 'header')
  r++
  line('Source sheet', text(info.sheetName))
  line('Deadline', deadlineCell(info.deadline))
  line('Checked at', excelDate(info.checkedAt))
  line('Time zone of all dates', text(info.zone))
  const total = info.totalPeople ?? rows.length
  line(
    'People in this file',
    text(rows.length === total ? String(total) : `${rows.length} of ${total}${info.filter ? ` (${info.filter})` : ''}`),
  )
  r++

  put(0, text('Status'), 'header')
  put(1, text('People'), 'header')
  put(2, text('Share'), 'header')
  r++
  for (const status of summaryStatuses(rows, info.deadline)) {
    const matching = rows.filter((row) => row.statusKey === status)
    // The label exactly as the rows carry it ("Submitted" before the deadline passes).
    const label = matching[0]?.status ?? STATUS_NAME[status]
    put(0, text(label), tonePaint(status))
    put(1, number(matching.length))
    put(2, share(rows.length === 0 ? 0 : matching.length / rows.length))
    r++
  }
  put(0, text('Total'), 'header')
  put(1, number(rows.length), 'header')
  put(2, share(rows.length === 0 ? 0 : 1), 'header')
  r += 2

  const attention = needsAttention(rows).length
  const groups = sameRepoGroups(rows)
  const sharing = groups.reduce((sum, group) => sum + group.rows.length, 0)
  put(0, text('Need attention'), attention > 0 ? 'warn' : 'good')
  put(1, number(attention))
  put(2, text(attention > 0 ? 'See the "Needs attention" sheet' : 'Nobody'))
  r++
  put(0, text('Handed in the same repo as someone else'), sharing > 0 ? 'bad' : 'good')
  put(1, number(sharing))
  put(
    2,
    text(
      sharing > 0
        ? `${groups.length} ${groups.length === 1 ? 'repo' : 'repos'}, see the "Same repo" sheet`
        : 'Nobody',
    ),
  )
  r++

  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r - 1, c: 2 } })
  // Narrow enough for the whole summary to print on one portrait page.
  sheet['!cols'] = [{ wch: 38 }, { wch: 21 }, { wch: 32 }]
  return { sheet, style: { cells } }
}

/** The wording used on the page, for statuses no row of the file has. */
const STATUS_NAME: Record<Status, string> = {
  on_time: 'On time',
  submitted: 'Has work',
  changed_after: 'Changed after deadline',
  late: 'Late',
  no_submission: 'No submission',
  not_found: 'Not found',
  invalid_link: 'Invalid link',
  check_failed: 'Check failed',
  checking: 'Checking',
}

const MEANING: ReadonlyArray<[string, string]> = [
  ['On time', 'Everything on the main branch reached GitHub before the deadline.'],
  ['Changed after deadline', 'Work was pushed in time, and more was pushed after the deadline.'],
  ['Late', 'Nothing had reached GitHub when the deadline passed.'],
  ['No submission', 'The repo exists but is empty.'],
  ['Not found', 'No public repo at that link: private, deleted or mistyped.'],
  ['Invalid link', 'The cell does not hold a GitHub repo link.'],
  ['Check failed', 'GitHub could not be reached; press Refresh on the page.'],
  ['Has work', 'No deadline is set, and the repo has commits.'],
  ['Submitted, Nothing yet', 'The softer wording used while the deadline has not passed.'],
]

function infoSheet(info: ExportInfo): XLSX.WorkSheet {
  const lines: Array<[string, XLSX.CellObject]> = [
    ['Source sheet', text(info.sheetName)],
    ['Deadline', deadlineCell(info.deadline)],
    ['Checked at', excelDate(info.checkedAt)],
    ['Time zone of all dates', text(info.zone)],
    ['How lateness is judged', text('By the time GitHub received the push on the main branch, not by commit dates.')],
    ...MEANING.map(([label, meaning]): [string, XLSX.CellObject] => [`Status: ${label}`, text(meaning)]),
  ]
  const sheet: XLSX.WorkSheet = {}
  lines.forEach(([label, value], r) => {
    sheet[XLSX.utils.encode_cell({ r, c: 0 })] = text(label)
    sheet[XLSX.utils.encode_cell({ r, c: 1 })] = value
  })
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lines.length - 1, c: 1 } })
  sheet['!cols'] = [{ wch: 32 }, { wch: 80 }]
  return sheet
}

/** Builds the workbook and the colours that go with it. Rows keep the order they are given in. */
export function buildWorkbook(rows: readonly ExportRow[], info: ExportInfo): ResultsReport {
  const summary = summarySheet(rows, info)
  const results = table(RESULT_COLUMNS, rows, statusPaint)
  const attentionRows = needsAttention(rows)
  const attention = table(ATTENTION_COLUMNS, attentionRows, statusPaint)
  if (attentionRows.length === 0) attention.sheet.A2 = text('Nobody needs attention.')
  const groups = sameRepoGroups(rows)
  const same = table(SAME_REPO_COLUMNS, groups)
  if (groups.length === 0) same.sheet.A2 = text('Every repo was handed in by one person only.')

  // The results come first: a file opens on its first sheet.
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, results.sheet, 'Results')
  XLSX.utils.book_append_sheet(book, summary.sheet, 'Summary')
  XLSX.utils.book_append_sheet(book, attention.sheet, 'Needs attention')
  XLSX.utils.book_append_sheet(book, same.sheet, 'Same repo')
  XLSX.utils.book_append_sheet(book, infoSheet(info), 'Info')
  return { book, styles: [results.style, summary.style, attention.style, same.style, { cells: new Map() }] }
}

/** "results-2026-10-05-2359.xlsx" */
export function exportFileName(checkedAt: number): string {
  const date = new Date(checkedAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `results-${stamp}.xlsx`
}

/** The finished file: the workbook with its colours, bold headers and frozen header rows. */
export function writeWorkbook(report: ResultsReport): Uint8Array {
  return writeStyledXlsx(report.book, report.styles)
}

/** Saves the report. `save` is replaced in tests, which have no browser. */
export function downloadWorkbook(report: ResultsReport, fileName: string, save = saveFile): void {
  save(writeWorkbook(report), fileName)
}

/** A small example of the expected sheet, for people who have none yet. */
export function downloadSample(): void {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['id', 'name', 'repolink'],
    ['20-41234-1', 'Rahim Uddin', 'https://github.com/octocat/Hello-World'],
    ['20-41235-1', 'Karim Hasan', 'https://github.com/octocat/Spoon-Knife'],
    ['20-41236-1', 'Salma Akter', 'https://github.com/github/gitignore'],
  ])
  sheet['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 46 }]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Students')
  XLSX.writeFile(book, 'sample-sheet.xlsx')
}
