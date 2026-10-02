// Reads an uploaded file with the Excel library. This module is loaded only
// when a file is actually chosen, because the library is large.

import * as XLSX from 'xlsx'
import {
  EMPTY,
  HEADER_SCAN_ROWS,
  MAX_COLUMNS,
  MAX_ROWS,
  SheetError,
  type Cell,
  type SheetData,
} from './columns.ts'

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  const shown = typeof cell.w === 'string' ? cell.w.trim() : ''
  if (cell.t === 'n' && typeof cell.v === 'number') {
    // Keep leading zeros when Excel shows them ("00123"), but never show a
    // long ID as "2.01E+10".
    if (/^\d+$/.test(shown)) return shown
    return Number.isInteger(cell.v) ? String(cell.v) : shown || String(cell.v)
  }
  return (shown || String(cell.v)).trim()
}

function cellLink(cell: XLSX.CellObject | undefined): string | null {
  if (!cell) return null
  const target = cell.l?.Target
  if (typeof target === 'string' && target.trim()) return target.trim()
  // =HYPERLINK("https://...", "label")
  if (typeof cell.f === 'string') {
    const match = /^\s*HYPERLINK\(\s*"([^"]+)"/i.exec(cell.f)
    if (match) return match[1].trim()
  }
  return null
}

/** Reads the first worksheet of an .xlsx, .xls or .csv file into a plain grid. */
export function readSheet(data: ArrayBuffer | Uint8Array): SheetData {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(data, {
      type: 'array',
      sheetRows: MAX_ROWS + HEADER_SCAN_ROWS + 1,
      cellFormula: true,
      cellHTML: false,
    })
  } catch {
    throw new SheetError('unreadable')
  }
  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
  const ref = sheet?.['!ref']
  if (!sheet || !sheetName || !ref) throw new SheetError('empty')

  const range = XLSX.utils.decode_range(ref)
  const lastCol = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1)
  const grid: Cell[][] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: Cell[] = []
    for (let c = range.s.c; c <= lastCol; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
      const text = cellText(cell)
      const link = cellLink(cell)
      row.push(text || link ? { text, link } : EMPTY)
    }
    grid.push(row)
  }

  // A merged block stores its value only in the top-left cell.
  for (const merge of sheet['!merges'] ?? []) {
    const source = grid[merge.s.r - range.s.r]?.[merge.s.c - range.s.c]
    if (!source || source === EMPTY) continue
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        const row = grid[r - range.s.r]
        if (row && c - range.s.c < row.length) row[c - range.s.c] = source
      }
    }
  }

  const fullRef = sheet['!fullref']
  const truncated =
    typeof fullRef === 'string' && XLSX.utils.decode_range(fullRef).e.r > range.e.r
  if (!grid.some((row) => row.some((cell) => cell !== EMPTY))) throw new SheetError('empty')
  return {
    sheetName,
    grid,
    firstRowNumber: range.s.r + 1,
    firstColumnIndex: range.s.c,
    truncated,
  }
}
