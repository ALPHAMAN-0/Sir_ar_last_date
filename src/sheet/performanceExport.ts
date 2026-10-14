// The performance register's download: a workbook with the original marks,
// the final mark after deduction, and a sheet recording the grading rules.
// Loaded only when the Download button is pressed, because the Excel library
// is large.
//
//   Results   one row per person, with the original mark columns and the
//             final mark + deduction at the end
//   Summary   how many people have each status, at a glance
//   Info      the source sheet, the grading rules, and what each status means

import * as XLSX from 'xlsx'
import type { Grading, PerformanceStatus } from '../logic/grading.ts'
import { headerCells, saveFile, writeStyledXlsx, type Paint, type SheetStyle } from './xlsxStyle.ts'

export type PerformanceMark = {
  header: string
  raw: string
  value: number | null
}

export type PerformanceExportRow = {
  rowNumber: number
  id: string
  name: string
  marks: PerformanceMark[]
  status: PerformanceStatus
  finalMark: number | null
  deductionLines: string[]
}

export type PerformanceExportInfo = {
  sheetName: string
  deadline: number | null
  checkedAt: number
  grading: Grading
}

export type PerformanceReport = { book: XLSX.WorkBook; styles: SheetStyle[] }

const MS_PER_DAY = 86_400_000
const EXCEL_EPOCH_OFFSET = 25_569
const DATE_FORMAT = 'dd mmm yyyy, hh:mm'

const text = (value: string): XLSX.CellObject => ({ t: 's', v: value })
const number = (value: number | null): XLSX.CellObject =>
  value === null ? text('') : { t: 'n', v: value }
const formatNumber = (value: number | null): string => {
  if (value === null) return ''
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
}

const excelDate = (instant: number | null, format = DATE_FORMAT): XLSX.CellObject => {
  if (instant === null) return text('No deadline set')
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return text('No deadline set')
  const localMs = date.getTime() - date.getTimezoneOffset() * 60_000
  return { t: 'n', v: localMs / MS_PER_DAY + EXCEL_EPOCH_OFFSET, z: format }
}

const statusToRowTone: Record<PerformanceStatus, Paint | null> = {
  on_time: 'good',
  submitted: 'good',
  changed_after: 'warn',
  late: 'bad',
  no_submission: 'bad',
  not_found: 'muted',
  invalid_link: 'muted',
  check_failed: 'muted',
  checking: null,
  not_applicable: null,
}

type Column<Row> = { title: string; width: number; cell: (row: Row) => XLSX.CellObject }

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

const statusText = (status: PerformanceStatus): string => {
  switch (status) {
    case 'on_time':
      return 'On time'
    case 'submitted':
      return 'Submitted'
    case 'changed_after':
      return 'Changed after deadline'
    case 'late':
      return 'Late'
    case 'no_submission':
      return 'No submission'
    case 'not_found':
      return 'Not found'
    case 'invalid_link':
      return 'Invalid link'
    case 'check_failed':
      return 'Check failed'
    case 'checking':
      return 'Checking'
    case 'not_applicable':
      return 'Not graded'
  }
}

/** Builds the per-row columns, with one column per mark plus the summary columns at the end. */
function resultsColumns(markHeaders: readonly string[]): ReadonlyArray<Column<PerformanceExportRow>> {
  const markCols: Column<PerformanceExportRow>[] = markHeaders.map((header) => ({
    title: header,
    width: Math.max(12, header.length + 2),
    cell: (row) => {
      const mark = row.marks.find((m) => m.header === header)
      return mark ? text(`${formatNumber(mark.value)}${mark.raw !== formatNumber(mark.value) ? ` (${mark.raw})` : ''}`) : text('')
    },
  }))
  return [
    { title: 'Row', width: 6, cell: (row) => number(row.rowNumber) },
    { title: 'ID', width: 16, cell: (row) => text(row.id) },
    { title: 'Name', width: 26, cell: (row) => text(row.name) },
    ...markCols,
    { title: 'Status', width: 24, cell: (row) => text(statusText(row.status)) },
    { title: 'Final mark', width: 12, cell: (row) => number(row.finalMark) },
    { title: 'Deduction', width: 40, cell: (row) => text(row.deductionLines.join('; ')) },
  ]
}

const SUMMARY_ORDER: readonly PerformanceStatus[] = [
  'on_time',
  'submitted',
  'changed_after',
  'late',
  'no_submission',
  'not_found',
  'invalid_link',
  'check_failed',
  'checking',
  'not_applicable',
]

function summarySheet(rows: readonly PerformanceExportRow[], info: PerformanceExportInfo): { sheet: XLSX.WorkSheet; style: SheetStyle } {
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

  put(0, text('Performance report'), 'header')
  r++
  line('Source sheet', text(info.sheetName))
  line('Checked at', excelDate(info.checkedAt))
  r++

  put(0, text('Status'), 'header')
  put(1, text('People'), 'header')
  r++
  for (const status of SUMMARY_ORDER) {
    const matching = rows.filter((row) => row.status === status)
    if (matching.length === 0) continue
    put(0, text(statusText(status)), statusToRowTone[status])
    put(1, number(matching.length))
    r++
  }
  put(0, text('Total'), 'header')
  put(1, number(rows.length), 'header')
  r += 2

  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r - 1, c: 1 } })
  sheet['!cols'] = [{ wch: 32 }, { wch: 24 }]
  return { sheet, style: { cells } }
}

const STATUS_MEANING: ReadonlyArray<[PerformanceStatus, string]> = [
  ['on_time', 'Everything on the main branch reached GitHub before the deadline.'],
  ['changed_after', 'Work was pushed in time, and more was pushed after the deadline.'],
  ['late', 'Nothing had reached GitHub when the deadline passed.'],
  ['no_submission', 'The repo exists but is empty.'],
  ['not_found', 'No public repo at this link: private, deleted or mistyped.'],
  ['invalid_link', 'The cell does not hold a GitHub repo link.'],
  ['check_failed', 'GitHub could not be reached; press Refresh on the page.'],
  ['not_applicable', 'This sheet has no GitHub link column, so the row was not graded.'],
  ['submitted', 'No deadline is set, and the repo has commits.'],
]

function infoSheet(info: PerformanceExportInfo): XLSX.WorkSheet {
  const lines: Array<[string, XLSX.CellObject]> = [
    ['Source sheet', text(info.sheetName)],
    ['Checked at', excelDate(info.checkedAt)],
    ['Total mark', text(info.grading.totalMark === null ? 'No upper bound' : String(info.grading.totalMark))],
    [
      'Marks off for late',
      text(info.grading.offForLate === 0 ? 'No deduction' : `−${formatNumber(info.grading.offForLate)}`),
    ],
    [
      'Marks off for changed after deadline',
      text(info.grading.offForChanged === 0 ? 'No deduction' : `−${formatNumber(info.grading.offForChanged)}`),
    ],
    [
      'How final marks are computed',
      text(
        'Final mark = sum of numeric mark columns, minus the deduction for the row\'s status ' +
          '(late or changed after deadline). Rows with no work are set to 0. The final mark is ' +
          'clamped at the Total mark and never goes below 0.',
      ),
    ],
    ...STATUS_MEANING.map(([status, meaning]): [string, XLSX.CellObject] => [
      `Status: ${statusText(status)}`,
      text(meaning),
    ]),
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

/** Builds the workbook and the styles that go with it. Rows keep the order they are given in. */
export function buildPerformanceWorkbook(
  rows: readonly PerformanceExportRow[],
  info: PerformanceExportInfo,
): PerformanceReport {
  const markHeaders = rows[0]?.marks.map((m) => m.header) ?? []
  const results = table(resultsColumns(markHeaders), rows, (row) => statusToRowTone[row.status])
  const summary = summarySheet(rows, info)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, results.sheet, 'Results')
  XLSX.utils.book_append_sheet(book, summary.sheet, 'Summary')
  XLSX.utils.book_append_sheet(book, infoSheet(info), 'Info')
  return { book, styles: [results.style, summary.style, { cells: new Map() }] }
}

/** "performance-2026-10-13-1000.xlsx" */
export function exportFileName(checkedAt: number): string {
  const date = new Date(checkedAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `performance-${stamp}.xlsx`
}

/** The finished file: the workbook with its colours, bold headers and frozen header rows. */
export function writePerformanceWorkbook(report: PerformanceReport): Uint8Array {
  return writeStyledXlsx(report.book, report.styles)
}

/** Saves the report. `save` is replaced in tests, which have no browser. */
export function downloadWorkbook(report: PerformanceReport, fileName: string, save = saveFile): void {
  save(writePerformanceWorkbook(report), fileName)
}