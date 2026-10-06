// The similarity report as an Excel workbook. Loaded only when the Download
// button is pressed, because the Excel library is large.
//
// Like the register's export (src/sheet/exportXlsx.ts), every text value is
// written as a plain string cell: a name that starts with "=" stays text.

import * as XLSX from 'xlsx'
import { repoUrl } from '../logic/people.ts'
import { pairDetail, sharedSets } from './compare.ts'
import { tierLabel } from './format.ts'
import { MIN_BYTES } from './rules.ts'
import type { RepoGroup } from './run.ts'
import type { PairRow, PersonLine, Summary } from './summary.ts'
import type { Analysis, RepoFiles, StarterFile } from './types.ts'

export type ReportInput = {
  summary: Summary
  analysis: Analysis
  /** The compared file lists, by repo. Needed to name the matching files. */
  trees: ReadonlyMap<string, RepoFiles>
  info: {
    /** The uploaded file. */
    fileName: string
    sheetName: string
    checkedAt: number
    /** For example "Asia/Dhaka (UTC+6)". */
    zone: string
  }
}

/** Excel refuses a cell longer than this, and the whole file with it. */
const MAX_CELL_CHARS = 32_767
export const MAX_FILES_PER_PAIR = 500
export const MAX_FILE_ROWS = 20_000
export const MAX_STARTER_ROWS = 5_000

const DATE_FORMAT = 'yyyy-mm-dd hh:mm'
const MS_PER_DAY = 86_400_000
/** Days between Excel's day zero (30 Dec 1899) and 1 Jan 1970. */
const EXCEL_EPOCH_OFFSET = 25_569

const text = (value: string): XLSX.CellObject => ({
  t: 's',
  v: value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS - 1)}…` : value,
})
const number = (value: number | null): XLSX.CellObject =>
  value === null ? text('') : { t: 'n', v: value }
/** A share in [0, 1], shown by Excel as a percentage and still sortable as a number. */
const share = (value: number | null): XLSX.CellObject =>
  value === null ? text('') : { t: 'n', v: value, z: '0%' }
/** A clickable link. Only ever built from a validated `owner/name`. */
const repoLink = (repo: string | null): XLSX.CellObject => {
  if (!repo) return text('')
  const url = repoUrl(repo)
  return { t: 's', v: url, l: { Target: url } }
}

/** A real Excel date showing the same local wall-clock time the page shows. */
function excelDate(instant: number): XLSX.CellObject {
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return text('')
  const localMs = date.getTime() - date.getTimezoneOffset() * 60_000
  return { t: 'n', v: localMs / MS_PER_DAY + EXCEL_EPOCH_OFFSET, z: DATE_FORMAT }
}

type Column<Row> = { title: string; width: number; cell: (row: Row) => XLSX.CellObject }

/** A sheet with a header row, column widths and a filter button on every column. */
function table<Row>(columns: ReadonlyArray<Column<Row>>, rows: readonly Row[]): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {}
  columns.forEach((column, c) => {
    sheet[XLSX.utils.encode_cell({ r: 0, c })] = text(column.title)
    rows.forEach((row, r) => {
      sheet[XLSX.utils.encode_cell({ r: r + 1, c })] = column.cell(row)
    })
  })
  const ref = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: columns.length - 1 } })
  sheet['!ref'] = ref
  sheet['!cols'] = columns.map((column) => ({ wch: column.width }))
  sheet['!autofilter'] = { ref }
  return sheet
}

const ids = (group: RepoGroup) => group.people.map((person) => person.id).filter(Boolean).join('; ')
const names = (group: RepoGroup) =>
  group.people.map((person) => person.name || `Row ${person.rowNumber}`).join('; ')

function pairNote({ summary, a, b }: PairRow): string {
  const notes: string[] = []
  if (summary.sameCommit) notes.push('Both repos are at the very same commit')
  if (a.isFork) notes.push('A is a fork')
  if (b.isFork) notes.push('B is a fork')
  return notes.join('; ')
}

const PAIR_COLUMNS: ReadonlyArray<Column<PairRow>> = [
  { title: 'Pair', width: 6, cell: (row) => number(row.number) },
  { title: 'Result', width: 22, cell: (row) => text(tierLabel(row.summary.tier)) },
  { title: 'Match', width: 8, cell: (row) => share(row.summary.score) },
  { title: 'A ID', width: 14, cell: (row) => text(ids(row.a)) },
  { title: 'A name', width: 24, cell: (row) => text(names(row.a)) },
  { title: 'A repo', width: 44, cell: (row) => repoLink(row.a.repo) },
  { title: 'B ID', width: 14, cell: (row) => text(ids(row.b)) },
  { title: 'B name', width: 24, cell: (row) => text(names(row.b)) },
  { title: 'B repo', width: 44, cell: (row) => repoLink(row.b.repo) },
  { title: 'Identical files', width: 14, cell: (row) => number(row.summary.identical) },
  { title: 'Share of A', width: 11, cell: (row) => share(row.summary.aShare) },
  { title: 'A files compared', width: 16, cell: (row) => number(row.summary.aOwn) },
  { title: 'Share of B', width: 11, cell: (row) => share(row.summary.bShare) },
  { title: 'B files compared', width: 16, cell: (row) => number(row.summary.bOwn) },
  { title: 'Same name, other content', width: 24, cell: (row) => number(row.summary.sameName) },
  { title: 'Note', width: 44, cell: (row) => text(pairNote(row)) },
]

type FileRow = {
  pair: number
  a: string
  b: string
  kind: string
  aPath: string
  bPath: string
  size: number | null
}

const FILE_COLUMNS: ReadonlyArray<Column<FileRow>> = [
  { title: 'Pair', width: 6, cell: (row) => number(row.pair) },
  { title: 'A name', width: 24, cell: (row) => text(row.a) },
  { title: 'B name', width: 24, cell: (row) => text(row.b) },
  { title: 'What', width: 26, cell: (row) => text(row.kind) },
  { title: 'Path in A', width: 52, cell: (row) => text(row.aPath) },
  { title: 'Path in B', width: 52, cell: (row) => text(row.bPath) },
  { title: 'Size (bytes)', width: 12, cell: (row) => number(row.size) },
]

/** The files behind each pair, strongest pair first, until the sheet is long enough. */
function fileRows(input: ReportInput): FileRow[] {
  const shared = sharedSets(input.analysis)
  const rows: FileRow[] = []
  for (const pair of input.summary.pairs) {
    if (rows.length >= MAX_FILE_ROWS) break
    const a = input.trees.get(pair.a.repo)
    const b = input.trees.get(pair.b.repo)
    if (!a || !b) continue
    const detail = pairDetail(a, b, shared)
    const base = { pair: pair.number, a: names(pair.a), b: names(pair.b) }
    const all: FileRow[] = [
      ...detail.identical.map((file) => ({
        ...base,
        kind: 'Identical content',
        aPath: file.aPath,
        bPath: file.bPath,
        size: file.size,
      })),
      ...detail.sameName.map((file) => ({
        ...base,
        kind: 'Same name, other content',
        aPath: file.path,
        bPath: file.path,
        size: null,
      })),
    ]
    rows.push(...all.slice(0, MAX_FILES_PER_PAIR))
    if (all.length > MAX_FILES_PER_PAIR) {
      rows.push({
        ...base,
        kind: 'Not listed',
        aPath: `${(all.length - MAX_FILES_PER_PAIR).toLocaleString('en')} more files`,
        bPath: '',
        size: null,
      })
    }
  }
  return rows
}

const SAME_REPO_COLUMNS: ReadonlyArray<Column<RepoGroup>> = [
  { title: 'Repo', width: 44, cell: (group) => repoLink(group.repo) },
  { title: 'People', width: 8, cell: (group) => number(group.people.length) },
  { title: 'IDs', width: 40, cell: (group) => text(ids(group)) },
  { title: 'Names', width: 60, cell: (group) => text(names(group)) },
  {
    title: 'Sheet rows',
    width: 16,
    cell: (group) => text(group.people.map((person) => person.rowNumber).join(', ')),
  },
]

const PEOPLE_COLUMNS: ReadonlyArray<Column<PersonLine>> = [
  { title: 'Row', width: 6, cell: (line) => number(line.person.rowNumber) },
  { title: 'ID', width: 14, cell: (line) => text(line.person.id) },
  { title: 'Name', width: 24, cell: (line) => text(line.person.name) },
  { title: 'Repo', width: 44, cell: (line) => (line.repo ? repoLink(line.repo) : text(line.rawLink)) },
  { title: 'Compared', width: 10, cell: (line) => text(line.compared ? 'Yes' : 'No') },
  { title: 'Files compared', width: 14, cell: (line) => number(line.compared ? (line.stats?.own ?? null) : null) },
  { title: 'Starter files', width: 13, cell: (line) => number(line.stats?.starter ?? null) },
  { title: 'Other files left out', width: 18, cell: (line) => number(line.skipped) },
  { title: 'Closest match', width: 30, cell: (line) => text(line.closest?.label ?? '') },
  { title: 'Closest match %', width: 15, cell: (line) => share(line.closest?.score ?? null) },
  { title: 'Closest result', width: 22, cell: (line) => text(line.closest ? tierLabel(line.closest.tier) : '') },
  { title: 'Pairs mostly identical or more', width: 28, cell: (line) => number(line.compared ? line.strongPairs : null) },
  { title: 'Note', width: 60, cell: (line) => text(line.note) },
]

const STARTER_COLUMNS: ReadonlyArray<Column<StarterFile>> = [
  { title: 'File', width: 60, cell: (file) => text(file.path) },
  { title: 'Found in repos', width: 14, cell: (file) => number(file.repos) },
  { title: 'Size (bytes)', width: 12, cell: (file) => number(file.size) },
]

function infoSheet(input: ReportInput, listedFiles: number): XLSX.WorkSheet {
  const { summary, analysis, info } = input
  const strongPairs = summary.pairs.filter(
    (pair) => pair.summary.tier === 'almost_all' || pair.summary.tier === 'most',
  ).length
  const lines: Array<[string, XLSX.CellObject]> = [
    ['Source file', text(info.fileName)],
    ['Sheet', text(info.sheetName)],
    ['Checked at', excelDate(info.checkedAt)],
    ['Time zone of all dates', text(info.zone)],
    ['People in the sheet', number(summary.people.length)],
    ['People compared', number(summary.people.filter((line) => line.compared).length)],
    ['People not compared', number(summary.people.filter((line) => !line.compared).length)],
    ['Repos compared', number(summary.compared)],
    ['Repos handed in by more than one person', number(summary.sameRepo.length)],
    ['Pairs that could be formed', number(analysis.totalPairs)],
    ['Pairs with identical files', number(summary.pairs.length)],
    ['Pairs mostly identical or more', number(strongPairs)],
    ['Matching files listed', number(listedFiles)],
    ['Starter-file limit', number(analysis.commonLimit)],
    ['Starter files left out', number(analysis.starter.length)],
    [
      'What "identical" means',
      text('Two files are identical when their content is the same, byte for byte. The file name does not matter.'),
    ],
    [
      'What a percentage means',
      text('The share of one repo’s compared files that are also in the other repo. "Match" is the larger of the two shares.'),
    ],
    [
      'What a starter file is',
      text(
        `A content found in more than ${analysis.commonLimit} repos. It was probably handed out or written by a project generator, so it is not counted on either side.`,
      ),
    ],
    [
      'What is never compared',
      text(
        `Third-party and build folders (node_modules, vendor, dist, build and the like), tool settings and lock files, pictures, fonts and compiled files, and files under ${MIN_BYTES} bytes.`,
      ),
    ],
    [
      'What this cannot see',
      text('A copy in which every file was changed, even by one character. It is a list of places to look, not a verdict: read the files before you decide anything.'),
    ],
  ]
  const sheet: XLSX.WorkSheet = {}
  lines.forEach(([label, value], r) => {
    sheet[XLSX.utils.encode_cell({ r, c: 0 })] = text(label)
    sheet[XLSX.utils.encode_cell({ r, c: 1 })] = value
  })
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lines.length - 1, c: 1 } })
  sheet['!cols'] = [{ wch: 38 }, { wch: 110 }]
  return sheet
}

/**
 * Builds the workbook:
 *   Pairs           one row per pair of repos with identical files, strongest first
 *   Matching files  which files those are
 *   Same repo       repos that more than one person handed in
 *   People          one row per sheet row: compared or not, and the closest match
 *   Starter files   contents left out because many repos have them
 *   Info            how the report was made and what it cannot see
 */
export function buildReportWorkbook(input: ReportInput): XLSX.WorkBook {
  const files = fileRows(input)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, table(PAIR_COLUMNS, input.summary.pairs), 'Pairs')
  XLSX.utils.book_append_sheet(book, table(FILE_COLUMNS, files), 'Matching files')
  XLSX.utils.book_append_sheet(book, table(SAME_REPO_COLUMNS, input.summary.sameRepo), 'Same repo')
  XLSX.utils.book_append_sheet(book, table(PEOPLE_COLUMNS, input.summary.people), 'People')
  XLSX.utils.book_append_sheet(
    book,
    table(STARTER_COLUMNS, input.analysis.starter.slice(0, MAX_STARTER_ROWS)),
    'Starter files',
  )
  XLSX.utils.book_append_sheet(book, infoSheet(input, files.length), 'Info')
  return book
}

/** "similarity-2026-10-05-2359.xlsx": the check time in the local zone. */
export function reportFileName(checkedAt: number): string {
  const date = new Date(checkedAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `similarity-${stamp}.xlsx`
}

/** Saves the workbook as a file. `writer` is replaced in tests, which have no browser. */
export function downloadReport(input: ReportInput, writer: typeof XLSX.writeFile = XLSX.writeFile): void {
  writer(buildReportWorkbook(input), reportFileName(input.info.checkedAt), { compression: true })
}
