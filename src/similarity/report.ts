// Phase 5 of the similarity plan: build a workbook the instructor can
// email to colleagues. Mirrors src/sheet/exportXlsx.ts in style so the
// two reports read the same.
//
// The single source of an .xlsx-cell value is the small `text()` and
// `number()` helpers below — every value, including the pair row's
// student id and name, is written through them. That is how we stop
// Excel from interpreting a string that begins with "=" as a formula.

import * as XLSX from 'xlsx'

export type ReportPair = {
  aKey: string
  aId: string
  aName: string
  aBranch: string
  aHeadOid: string
  bKey: string
  bId: string
  bName: string
  bBranch: string
  bHeadOid: string
  /** |A ∩ B|. */
  overlap: number
  /** |A ∪ B|. */
  union: number
  /** Jaccard overlap / union, in [0, 1]. */
  score: number
  /** Paths in both repos, sorted. Joined with newlines in the file. */
  shared: string[]
  /** Paths only in A, sorted. */
  onlyA: string[]
  /** Paths only in B, sorted. */
  onlyB: string[]
}

export type ReportInfo = {
  sheetName: string
  /** Run-as-of timestamp in ms. Written as local Excel date. */
  checkedAt: number
  /** Total trees the comparison considered (including failures). */
  totalTrees: number
  /** Trees whose file list could not be fetched from GitHub. */
  failedTrees: number
  /** Total pairs compared, including zero-overlap. */
  totalPairs: number
  /** Human-readable zone label, e.g. "Asia/Dhaka (UTC+6)". */
  zone: string
}

const DATE_FORMAT = 'yyyy-mm-dd hh:mm'
const MS_PER_DAY = 86_400_000
/** Days between Excel's day zero (30 Dec 1899) and 1 Jan 1970. */
const EXCEL_EPOCH_OFFSET = 25_569

/** Plain string cell. A value starting with "=" stays text. */
const text = (value: string): XLSX.CellObject => ({ t: 's', v: value })

/** Numeric cell. Empty when value is null. */
const number = (value: number | null): XLSX.CellObject =>
  value === null ? text('') : { t: 'n', v: value }

/** A real Excel date showing the same local wall-clock time the page shows. */
function excelDate(instant: number | null): XLSX.CellObject {
  if (instant === null) return text('')
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return text('')
  const localMs = date.getTime() - date.getTimezoneOffset() * 60_000
  return { t: 'n', v: localMs / MS_PER_DAY + EXCEL_EPOCH_OFFSET, z: DATE_FORMAT }
}

const PATHS = '\n'

type Column = { title: string; width: number; cell: (row: ReportPair) => XLSX.CellObject }

const COLUMNS: readonly Column[] = [
  { title: 'A ID', width: 14, cell: (row) => text(row.aId) },
  { title: 'A name', width: 22, cell: (row) => text(row.aName) },
  { title: 'A branch', width: 14, cell: (row) => text(row.aBranch) },
  { title: 'A head oid', width: 44, cell: (row) => text(row.aHeadOid) },
  { title: 'B ID', width: 14, cell: (row) => text(row.bId) },
  { title: 'B name', width: 22, cell: (row) => text(row.bName) },
  { title: 'B branch', width: 14, cell: (row) => text(row.bBranch) },
  { title: 'Overlap %', width: 12, cell: (row) => number(Math.round(row.score * 100)) },
  { title: 'Overlap', width: 10, cell: (row) => number(row.overlap) },
  { title: 'Union', width: 10, cell: (row) => number(row.union) },
  { title: 'Shared paths', width: 50, cell: (row) => text(row.shared.join(PATHS)) },
  { title: 'Only in A', width: 50, cell: (row) => text(row.onlyA.join(PATHS)) },
  { title: 'Only in B', width: 50, cell: (row) => text(row.onlyB.join(PATHS)) },
] as const

/**
 * Builds the workbook: a "Results" sheet with one row per pair, plus an
 * "Info" sheet that records how the report was produced. The pair rows
 * are written in the order they arrive — the caller decides whether to
 * sort by score.
 */
export function buildReportWorkbook(pairs: readonly ReportPair[], info: ReportInfo): XLSX.WorkBook {
  const results: XLSX.WorkSheet = {}
  COLUMNS.forEach((column, c) => {
    results[XLSX.utils.encode_cell({ r: 0, c })] = text(column.title)
    pairs.forEach((row, r) => {
      results[XLSX.utils.encode_cell({ r: r + 1, c })] = column.cell(row)
    })
  })
  results['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: pairs.length, c: COLUMNS.length - 1 },
  })
  results['!cols'] = COLUMNS.map((column) => ({ wch: column.width }))

  const about: XLSX.WorkSheet = {
    A1: text('Source sheet'),
    B1: text(info.sheetName),
    A2: text('Pairs in this file'),
    B2: number(pairs.length),
    A3: text('Checked at'),
    B3: excelDate(info.checkedAt),
    A4: text('Pairs compared in total'),
    B4: number(info.totalPairs),
    A5: text('Time zone of all dates'),
    B5: text(info.zone),
    A6: text('Trees requested'),
    B6: number(info.totalTrees),
    A7: text('Trees that could not be listed'),
    B7: number(info.failedTrees),
    A8: text('Pairs compared in total'),
    B8: number(info.totalPairs),
    A9: text('Method'),
    B9: text(
      'Jaccard overlap of the repos’ file names. Higher means more paths in common; it is not a verdict on copying.',
    ),
    '!ref': 'A1:B9',
    '!cols': [{ wch: 26 }, { wch: 70 }],
  }

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, results, 'Results')
  XLSX.utils.book_append_sheet(book, about, 'Info')
  return book
}

/** "similarity-2026-10-05-2359.xlsx" — checked-at time in the local zone. */
export function reportFileName(checkedAt: number): string {
  const date = new Date(checkedAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `similarity-${stamp}.xlsx`
}

/** Writes the workbook to disk as a real `.xlsx`. Same shape as the register export. */
export function downloadReport(
  pairs: readonly ReportPair[],
  info: ReportInfo,
  writer: typeof XLSX.writeFile = XLSX.writeFile,
): void {
  writer(buildReportWorkbook(pairs, info), reportFileName(info.checkedAt), { compression: true })
}