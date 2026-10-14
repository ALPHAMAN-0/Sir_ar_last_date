import { describe, expect, it } from 'vitest'
import type { Cell, SheetData } from './columns.ts'
import { buildPerformanceRows, type PerformanceRow } from './performanceRows.ts'

const cell = (text: string, link: string | null = null): Cell => ({ text, link })
const row = (...cells: Array<string | Cell>): Cell[] => cells.map((c) => (typeof c === 'string' ? cell(c) : c))

const dataFromGrid = (grid: Cell[][]): SheetData => ({
  sheetName: 'Sheet1',
  grid,
  firstRowNumber: 1,
  firstColumnIndex: 0,
  truncated: false,
})

describe('buildPerformanceRows', () => {
  it('turns a grid into one performance row per data row, with marks in the right columns', () => {
    const grid = [
      row('id', 'name', 'midterm', 'final'),
      row('22-46001-1', 'Rahim', '30', '50'),
      row('22-46002-1', 'Karim', '28', '48'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0, marks: [2, 3] }
    const rows = buildPerformanceRows(dataFromGrid(grid), mapping)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual<PerformanceRow>({
      rowId: 'r2',
      rowNumber: 2,
      id: '22-46001-1',
      name: 'Rahim',
      marks: [
        { column: 2, header: 'midterm', raw: '30', value: 30 },
        { column: 3, header: 'final', raw: '50', value: 50 },
      ],
    })
  })

  it('skips a row that is entirely empty', () => {
    const grid = [
      row('id', 'name', 'midterm'),
      row('22-46001-1', 'Rahim', '80'),
      row('', '', ''),
      row('22-46002-1', 'Karim', '70'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0, marks: [2] }
    const rows = buildPerformanceRows(dataFromGrid(grid), mapping)
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 4])
  })

  it('keeps the raw text and stores null for non-numeric mark cells', () => {
    const grid = [
      row('id', 'name', 'midterm', 'final'),
      row('22-46001-1', 'Rahim', 'absent', '50'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0, marks: [2, 3] }
    const rows = buildPerformanceRows(dataFromGrid(grid), mapping)
    expect(rows[0].marks[0]).toEqual({ column: 2, header: 'midterm', raw: 'absent', value: null })
    expect(rows[0].marks[1]).toEqual({ column: 3, header: 'final', raw: '50', value: 50 })
  })

  it('handles a sheet with no header row (marks in their column positions)', () => {
    const grid = [
      row('22-46001-1', 'Rahim', '80'),
      row('22-46002-1', 'Karim', '70'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: null, marks: [2] }
    const rows = buildPerformanceRows(dataFromGrid(grid), mapping)
    expect(rows[0].marks[0]).toEqual({ column: 2, header: 'Column C', raw: '80', value: 80 })
  })

  it('caps the result at MAX_ROWS (1000) entries', () => {
    const header = row('id', 'name', 'mid')
    const body: Cell[][] = []
    for (let i = 0; i < 1500; i++) {
      body.push(row(`id-${i}`, `name-${i}`, String(i % 100)))
    }
    const grid = [header, ...body]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0, marks: [2] }
    const rows = buildPerformanceRows(dataFromGrid(grid), mapping)
    expect(rows).toHaveLength(1000)
  })

  it('returns the row number as it appears in the sheet (1-based, firstColumnIndex offset)', () => {
    const grid = [
      row('id', 'name', 'mid'),
      row('22-46001-1', 'Rahim', '80'),
    ]
    const data: SheetData = {
      sheetName: 'Sheet1',
      grid,
      firstRowNumber: 10,
      firstColumnIndex: 2,
      truncated: false,
    }
    const mapping = { id: 0, name: 1, link: null, headerRow: 0, marks: [2] }
    const rows = buildPerformanceRows(data, mapping)
    expect(rows[0].rowNumber).toBe(11)
    expect(rows[0].rowId).toBe('r11')
  })

  it('returns an empty array when there are no mark columns', () => {
    const grid = [
      row('id', 'name'),
      row('22-46001-1', 'Rahim'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0, marks: [] }
    const rows = buildPerformanceRows(dataFromGrid(grid), mapping)
    expect(rows).toEqual([])
  })

  it('uses the header text for the mark column name', () => {
    const grid = [
      row('id', 'name', 'Midterm (out of 30)', 'Final (out of 50)'),
      row('22-46001-1', 'Rahim', '30', '50'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0, marks: [2, 3] }
    const rows = buildPerformanceRows(dataFromGrid(grid), mapping)
    expect(rows[0].marks.map((m) => m.header)).toEqual(['Midterm (out of 30)', 'Final (out of 50)'])
  })
})
