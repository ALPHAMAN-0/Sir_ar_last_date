import * as XLSX from 'xlsx'

export type ExportRow = {
  id: string
  name: string
  repoLink: string
  status: string
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
  sheetName: string
  /** Last on-time millisecond, or null when no deadline is set. */
  deadline: number | null
  checkedAt: number
  zone: string
}

const DATE_FORMAT = 'yyyy-mm-dd hh:mm'
const MS_PER_DAY = 86_400_000
/** Days between Excel's day zero (30 Dec 1899) and 1 Jan 1970. */
const EXCEL_EPOCH_OFFSET = 25_569

// Every text value is written as a plain string cell. Nothing from the sheet or
// from GitHub is ever written as a formula, so a cell that starts with "=" stays text.
const text = (value: string): XLSX.CellObject => ({ t: 's', v: value })
const number = (value: number | null): XLSX.CellObject =>
  value === null ? text('') : { t: 'n', v: value }

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

const COLUMNS: Array<{ title: string; width: number; cell: (row: ExportRow) => XLSX.CellObject }> = [
  { title: 'ID', width: 16, cell: (row) => text(row.id) },
  { title: 'Name', width: 26, cell: (row) => text(row.name) },
  { title: 'Repo link', width: 44, cell: (row) => text(row.repoLink) },
  { title: 'Status', width: 24, cell: (row) => text(row.status) },
  { title: 'Late by', width: 12, cell: (row) => text(row.lateBy) },
  { title: 'Late (minutes)', width: 14, cell: (row) => number(row.lateMinutes) },
  { title: 'Notes', width: 44, cell: (row) => text(row.notes) },
  { title: 'Repo created', width: 18, cell: (row) => excelDate(row.repoCreatedAt) },
  { title: 'Last push', width: 18, cell: (row) => excelDate(row.lastPushAt) },
  { title: 'Last on-time push', width: 18, cell: (row) => excelDate(row.lastOnTimePushAt) },
  { title: 'Last commit date', width: 18, cell: (row) => excelDate(row.lastCommitAt) },
  { title: 'Commits', width: 10, cell: (row) => number(row.commits) },
  { title: 'Branch', width: 12, cell: (row) => text(row.branch) },
]

/** Builds the workbook: a "Results" sheet in the given row order, plus an "Info" sheet. */
export function buildWorkbook(rows: readonly ExportRow[], info: ExportInfo): XLSX.WorkBook {
  const results: XLSX.WorkSheet = {}
  COLUMNS.forEach((column, c) => {
    results[XLSX.utils.encode_cell({ r: 0, c })] = text(column.title)
    rows.forEach((row, r) => {
      results[XLSX.utils.encode_cell({ r: r + 1, c })] = column.cell(row)
    })
  })
  results['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: rows.length, c: COLUMNS.length - 1 },
  })
  results['!cols'] = COLUMNS.map((column) => ({ wch: column.width }))

  const about: XLSX.WorkSheet = {
    A1: text('Source sheet'),
    B1: text(info.sheetName),
    A2: text('Deadline'),
    // The deadline is stored as the last millisecond of its minute (23:59:59.999).
    // Written as is, Excel would round it up and show 00:00 of the next day.
    B2:
      info.deadline === null
        ? text('No deadline set')
        : excelDate(Math.floor(info.deadline / 60_000) * 60_000),
    A3: text('Checked at'),
    B3: excelDate(info.checkedAt),
    A4: text('Time zone of all dates'),
    B4: text(info.zone),
    A5: text('How lateness is judged'),
    B5: text('By the time GitHub received the push on the main branch, not by commit dates.'),
    '!ref': 'A1:B5',
    '!cols': [{ wch: 24 }, { wch: 70 }],
  }

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, results, 'Results')
  XLSX.utils.book_append_sheet(book, about, 'Info')
  return book
}

/** "results-2026-10-05-2359.xlsx" */
export function exportFileName(checkedAt: number): string {
  const date = new Date(checkedAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `results-${stamp}.xlsx`
}

export function downloadWorkbook(book: XLSX.WorkBook, fileName: string): void {
  XLSX.writeFile(book, fileName, { compression: true })
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
