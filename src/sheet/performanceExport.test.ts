import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { defaultGrading, type Grading } from '../logic/grading.ts'
import {
  buildPerformanceWorkbook,
  exportFileName,
  writePerformanceWorkbook,
  type PerformanceExportRow,
} from './performanceExport.ts'

const grading: Grading = { totalMark: 100, offForLate: 20, offForChanged: 10 }

const sample = (overrides: Partial<PerformanceExportRow> = {}): PerformanceExportRow => ({
  rowNumber: 2,
  id: '22-46001-1',
  name: 'Rahim Uddin',
  marks: [
    { header: 'Midterm', raw: '30', value: 30 },
    { header: 'Final', raw: '50', value: 50 },
  ],
  status: 'on_time',
  finalMark: 80,
  deductionLines: [],
  ...overrides,
})

describe('buildPerformanceWorkbook', () => {
  it('writes 4 sheets: Results, Summary, Info (and an empty Needs attention)', () => {
    const { book } = buildPerformanceWorkbook([sample()], {
      sheetName: 'class.xlsx',
      deadline: null,
      checkedAt: Date.parse('2026-10-13T10:00:00Z'),
      grading,
    })
    expect(book.SheetNames).toEqual(['Results', 'Summary', 'Info'])
  })

  it('Results sheet has one header row, then one row per person, in input order', () => {
    const rows = [sample({ rowNumber: 2, id: '22-46001-1', name: 'Rahim' }), sample({ rowNumber: 3, id: '22-46002-1', name: 'Karim' })]
    const { book } = buildPerformanceWorkbook(rows, {
      sheetName: 'class.xlsx',
      deadline: null,
      checkedAt: Date.parse('2026-10-13T10:00:00Z'),
      grading,
    })
    const sheet = book.Sheets['Results']
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 })
    expect(data[0]).toContain('Row')
    expect(data[0]).toContain('ID')
    expect(data[0]).toContain('Name')
    expect(data[0]).toContain('Final mark')
    expect(data[0]).toContain('Deduction')
    expect(data[1]).toContain(2)
    expect(data[1]).toContain('22-46001-1')
    expect(data[1]).toContain('Rahim')
    expect(data[2]).toContain(3)
    expect(data[2]).toContain('22-46002-1')
  })

  it('Info sheet records the grading rules and the source sheet', () => {
    const { book } = buildPerformanceWorkbook([sample()], {
      sheetName: 'midterm.xlsx',
      deadline: null,
      checkedAt: Date.parse('2026-10-13T10:00:00Z'),
      grading,
    })
    const sheet = book.Sheets['Info']
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 }) as unknown as string[][]
    const flat = data.map((r) => r.join(' | ')).join('\n')
    expect(flat).toContain('Source sheet')
    expect(flat).toContain('midterm.xlsx')
    expect(flat).toContain('Total mark')
    expect(flat).toContain('100')
    expect(flat).toContain('20')
    expect(flat).toContain('10')
  })

  it('writes the final mark and the deduction lines in the dedicated columns', () => {
    const { book } = buildPerformanceWorkbook(
      [
        sample({ id: 'A', finalMark: 80, deductionLines: [] }),
        sample({ rowNumber: 3, id: 'B', status: 'late', finalMark: 60, deductionLines: ['Late: −20'] }),
        sample({ rowNumber: 4, id: 'C', status: 'changed_after', finalMark: 70, deductionLines: ['Changed after deadline: −10'] }),
      ],
      {
        sheetName: 'class.xlsx',
        deadline: null,
        checkedAt: Date.parse('2026-10-13T10:00:00Z'),
        grading,
      },
    )
    const sheet = book.Sheets['Results']
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 }) as unknown as unknown[][]
    expect(data[1]).toContain(80)
    expect(data[2]).toContain(60)
    expect(data[3]).toContain(70)
    // The deduction column gets joined as a single cell.
    const flat = data.map((r) => r.join(' | ')).join('\n')
    expect(flat).toContain('Late: −20')
    expect(flat).toContain('Changed after deadline: −10')
  })

  it('handles an empty list of rows without crashing', () => {
    const { book } = buildPerformanceWorkbook([], {
      sheetName: 'class.xlsx',
      deadline: null,
      checkedAt: Date.parse('2026-10-13T10:00:00Z'),
      grading: defaultGrading(),
    })
    expect(book.SheetNames).toContain('Results')
    expect(book.SheetNames).toContain('Info')
  })

  it('round-trips: writeWorkbook output is a non-empty Uint8Array', () => {
    const report = buildPerformanceWorkbook([sample()], {
      sheetName: 'class.xlsx',
      deadline: null,
      checkedAt: Date.parse('2026-10-13T10:00:00Z'),
      grading,
    })
    const bytes = writePerformanceWorkbook(report)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })
})

describe('exportFileName', () => {
  it('builds a name like performance-2026-10-13-1000.xlsx', () => {
    const stamp = Date.parse('2026-10-13T10:00:00Z')
    expect(exportFileName(stamp)).toMatch(/^performance-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx$/)
  })
})