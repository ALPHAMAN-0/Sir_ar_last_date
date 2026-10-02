// Everything about the sheet that does not need the Excel library: the shapes,
// guessing which column is which, and turning the grid into people rows.
// Kept separate so the page can start without downloading the Excel library.

import { parseRepoLink, type LinkResult } from './parseRepoLink.ts'

export const MAX_ROWS = 1000
export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_COLUMNS = 40
export const HEADER_SCAN_ROWS = 15

export type Cell = { text: string; link: string | null }

export type SheetData = {
  sheetName: string
  /** Rectangular grid of the first worksheet. */
  grid: Cell[][]
  /** Excel row number of grid[0]. */
  firstRowNumber: number
  /** Zero-based sheet column of grid[r][0] (0 = column A). */
  firstColumnIndex: number
  /** The sheet has more rows than the app reads. */
  truncated: boolean
}

/** Which grid column holds what. `headerRow` is the grid index of the header, if there is one. */
export type ColumnMapping = {
  id: number | null
  name: number | null
  link: number | null
  headerRow: number | null
}

export type SheetRow = {
  rowId: string
  /** Row number as shown in Excel. */
  rowNumber: number
  id: string
  name: string
  rawLink: string
  link: LinkResult
}

export type SheetProblem = 'too_big' | 'unreadable' | 'empty'

export class SheetError extends Error {
  readonly problem: SheetProblem

  constructor(problem: SheetProblem) {
    super(problem)
    this.problem = problem
  }
}

export const EMPTY: Cell = { text: '', link: null }

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

// Most specific first: "repolink" must win over a column that is just "link".
const LINK_HEADERS = [
  'repolink', 'repositorylink', 'githubrepolink', 'githublink', 'githubrepo', 'githuburl',
  'repourl', 'repositoryurl', 'repository', 'repo', 'github', 'gitlink', 'giturl', 'link',
  'url', 'git',
]
const ID_HEADERS = [
  'id', 'studentid', 'stdid', 'sid', 'idno', 'roll', 'rollno', 'rollnumber', 'serial',
  'serialno', 'sl', 'slno', 'no', 'employeeid', 'empid',
]
const NAME_HEADERS = [
  'name', 'studentname', 'fullname', 'student', 'employeename', 'employee', 'membername',
  'member', 'teamname', 'team',
]

function findHeader(row: Cell[], names: string[], taken: Array<number | null>): number | null {
  const cells = row.map((cell) => normalize(cell.text))
  for (const name of names) {
    const index = cells.indexOf(name)
    if (index !== -1 && !taken.includes(index)) return index
  }
  return null
}

const cellIsRepoLink = (cell: Cell) =>
  parseRepoLink(cell.text).ok || (cell.link !== null && parseRepoLink(cell.link).ok)

/**
 * Guesses the columns. Headers are matched loosely ("Repo Link", "repolink",
 * "GitHub URL"); when there is no usable header, the link column is the one
 * that actually contains the most repo links.
 */
export function detectMapping(grid: Cell[][]): ColumnMapping {
  let headerRow: number | null = null
  let link: number | null = null

  for (let r = 0; r < Math.min(grid.length, HEADER_SCAN_ROWS); r++) {
    const found = findHeader(grid[r], LINK_HEADERS, [])
    if (found !== null) {
      headerRow = r
      link = found
      break
    }
  }

  if (link === null) {
    const width = grid[0]?.length ?? 0
    let best = 0
    for (let c = 0; c < width; c++) {
      const count = grid.reduce((sum, row) => sum + (cellIsRepoLink(row[c]) ? 1 : 0), 0)
      if (count > best) {
        best = count
        link = c
      }
    }
    // A first row without any link, above rows with links, is a header.
    const first = grid[0]
    if (link !== null && first && !first.some(cellIsRepoLink) && first.some((cell) => cell.text)) {
      headerRow = 0
    }
  }

  let id: number | null = null
  let name: number | null = null
  if (headerRow !== null) {
    id = findHeader(grid[headerRow], ID_HEADERS, [link])
    name = findHeader(grid[headerRow], NAME_HEADERS, [link, id])
  }

  // Fall back to position: the remaining columns that hold any data, left to right.
  const start = (headerRow ?? -1) + 1
  const width = grid[0]?.length ?? 0
  const spare: number[] = []
  for (let c = 0; c < width; c++) {
    if (c === link || c === id || c === name) continue
    if (grid.slice(start).some((row) => row[c].text)) spare.push(c)
  }
  if (id === null && name === null) {
    if (spare.length === 1) name = spare[0]
    else if (spare.length > 1) [id, name] = spare
  } else if (name === null && spare.length > 0) {
    name = spare[0]
  }
  return { id, name, link, headerRow }
}

/** Turns the grid into people rows, skipping the header and blank rows. */
export function buildRows(data: SheetData, mapping: ColumnMapping): SheetRow[] {
  const rows: SheetRow[] = []
  const pick = (row: Cell[], column: number | null) =>
    column === null ? EMPTY : (row[column] ?? EMPTY)

  for (let r = (mapping.headerRow ?? -1) + 1; r < data.grid.length; r++) {
    const row = data.grid[r]
    const id = pick(row, mapping.id).text
    const name = pick(row, mapping.name).text
    const cell = pick(row, mapping.link)

    // Prefer what is visible when it is a real link, else the hyperlink behind the text.
    let rawLink = cell.text
    let link = parseRepoLink(cell.text)
    if (!link.ok && cell.link !== null) {
      const behind = parseRepoLink(cell.link)
      if (behind.ok || !cell.text) {
        rawLink = cell.link
        link = behind
      }
    }
    if (!id && !name && !rawLink) continue

    const rowNumber = data.firstRowNumber + r
    rows.push({ rowId: `r${rowNumber}`, rowNumber, id, name, rawLink, link })
    if (rows.length >= MAX_ROWS) break
  }
  return rows
}

/** "A", "B", ... "Z", "AA": the letter Excel shows for a column. */
function columnLetter(index: number): string {
  let letters = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters
  }
  return letters
}

/** Column letters and header texts, for the "which column is which" picker. */
export function describeColumns(data: SheetData, mapping: ColumnMapping): string[] {
  const header = mapping.headerRow !== null ? data.grid[mapping.headerRow] : undefined
  const width = data.grid[0]?.length ?? 0
  return Array.from({ length: width }, (_, c) => {
    const letter = columnLetter(data.firstColumnIndex + c)
    const title = header?.[c]?.text
    return title ? `${letter}: ${title}` : `Column ${letter}`
  })
}
