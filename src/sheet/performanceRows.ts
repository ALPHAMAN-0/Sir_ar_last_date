// Turns a performance-base sheet's grid into one entry per student, each
// carrying the mark columns the detector found. Pure: no Excel, no DOM, no state.

import { MAX_ROWS } from './columns.ts'
import type { Cell, SheetData } from './columns.ts'

/** One column the teacher put in the sheet that holds a mark. */
export type PerformanceMark = {
  /** Zero-based column index in the grid. */
  column: number
  /** Header text of the column, or "Column X" if the sheet has no header row. */
  header: string
  /** Original cell text, preserved as the user wrote it. */
  raw: string
  /** Parsed number, or null when the cell does not parse as a finite number. */
  value: number | null
}

export type PerformanceRow = {
  rowId: string
  /** Row number as shown in Excel. */
  rowNumber: number
  id: string
  name: string
  marks: PerformanceMark[]
}

/** The mapping shape we accept on input — what `detectMapping` + `markColumnIndices` produce. */
export type PerformanceMapping = {
  id: number | null
  name: number | null
  link: number | null
  headerRow: number | null
  marks: number[]
}

const pickText = (row: Cell[], column: number | null): string =>
  column === null ? '' : (row[column]?.text ?? '').trim()

const parseMark = (text: string): number | null => {
  if (text === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

const columnLetter = (index: number): string => {
  let letters = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters
  }
  return letters
}

const headerFor = (grid: Cell[][], headerRow: number | null, column: number): string => {
  const cell = headerRow === null ? null : grid[headerRow]?.[column]
  const text = cell?.text?.trim() ?? ''
  return text === '' ? `Column ${columnLetter(column)}` : text
}

/**
 * Builds one performance row per data row, skipping rows that are entirely
 * empty. Capped at `MAX_ROWS` (1000) to match the project-base limit.
 *
 * Rows with non-numeric mark cells (e.g. "absent") keep their raw text and
 * get a `null` value, so the table and the download can show "absent" verbatim.
 */
export function buildPerformanceRows(data: SheetData, mapping: PerformanceMapping): PerformanceRow[] {
  if (mapping.marks.length === 0) return []
  const rows: PerformanceRow[] = []
  const start = (mapping.headerRow ?? -1) + 1
  for (let r = start; r < data.grid.length; r++) {
    const row = data.grid[r]
    const id = pickText(row, mapping.id)
    const name = pickText(row, mapping.name)
    const marks: PerformanceMark[] = mapping.marks.map((column) => {
      const text = pickText(row, column)
      return {
        column,
        header: headerFor(data.grid, mapping.headerRow, column),
        raw: text,
        value: parseMark(text),
      }
    })
    // A row counts as empty when every field is blank: no id, no name, no raw mark text.
    const hasAnything =
      id !== '' || name !== '' || marks.some((m) => m.raw !== '')
    if (!hasAnything) continue
    const rowNumber = data.firstRowNumber + r
    rows.push({
      rowId: `r${rowNumber}`,
      rowNumber,
      id,
      name,
      marks,
    })
    if (rows.length >= MAX_ROWS) break
  }
  return rows
}