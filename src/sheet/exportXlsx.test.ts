import { afterEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  buildWorkbook,
  excelDate,
  exportFileName,
  type ExportInfo,
  type ExportRow,
} from './exportXlsx.ts'

declare const process: { env: Record<string, string | undefined> }
const originalZone = process.env.TZ
afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  id: '20-41234-1',
  name: 'Rahim Uddin',
  repoLink: 'https://github.com/rahim/task-1',
  status: 'On time',
  lateBy: '',
  lateMinutes: null,
  notes: '',
  repoCreatedAt: '2026-10-01T04:00:00Z',
  lastPushAt: '2026-10-05T15:10:00Z',
  lastOnTimePushAt: null,
  lastCommitAt: '2026-10-05T15:09:00Z',
  commits: 12,
  branch: 'main',
  ...over,
})

const info: ExportInfo = {
  sheetName: 'Students',
  deadline: null,
  checkedAt: Date.parse('2026-10-06T04:00:00Z'),
  zone: 'Asia/Dhaka (UTC+6)',
}

/** Writes the workbook to bytes and reads it back, as Excel would. */
function roundTrip(rows: ExportRow[], details = info) {
  const bytes = XLSX.write(buildWorkbook(rows, details), { type: 'array', bookType: 'xlsx' })
  const book = XLSX.read(bytes, { type: 'array', cellFormula: true })
  return { book, results: book.Sheets.Results, about: book.Sheets.Info }
}

describe('buildWorkbook', () => {
  it('keeps the given row order and writes the header row', () => {
    const { book, results } = roundTrip([row({ id: 'B' }), row({ id: 'A' }), row({ id: 'C' })])
    expect(book.SheetNames).toEqual(['Results', 'Info'])
    expect(results.A1.v).toBe('ID')
    expect(results.D1.v).toBe('Status')
    expect([results.A2.v, results.A3.v, results.A4.v]).toEqual(['B', 'A', 'C'])
  })

  it('writes dates as real Excel dates in local wall-clock time', () => {
    process.env.TZ = 'Asia/Dhaka'
    const { results } = roundTrip([row()])
    // 15:10 UTC is 21:10 in Dhaka.
    expect(results.I2.t).toBe('n')
    expect(XLSX.SSF.format('yyyy-mm-dd hh:mm', results.I2.v)).toBe('2026-10-05 21:10')
    expect(results.L2).toMatchObject({ t: 'n', v: 12 })
  })

  it('never writes a formula, even when a cell starts with "="', () => {
    const { results } = roundTrip([
      row({ name: '=HYPERLINK("https://evil.example","click")', notes: '+1+1', id: '@SUM(A1)' }),
    ])
    for (const address of ['A2', 'B2', 'G2']) {
      expect(results[address].t, address).toBe('s')
      expect(results[address].f, address).toBeUndefined()
    }
    expect(results.B2.v).toBe('=HYPERLINK("https://evil.example","click")')
  })

  it('leaves unknown values blank and writes late minutes as a number', () => {
    const { results } = roundTrip([
      row({ status: 'Late', lateBy: '3h 20m', lateMinutes: 200, lastOnTimePushAt: null, commits: null }),
    ])
    expect(results.E2.v).toBe('3h 20m')
    expect(results.F2).toMatchObject({ t: 'n', v: 200 })
    expect(results.J2?.v ?? '').toBe('')
    expect(results.L2?.v ?? '').toBe('')
  })

  it('records the deadline, check time and zone on the Info sheet', () => {
    process.env.TZ = 'Asia/Dhaka'
    const deadline = Date.parse('2026-10-05T17:59:59.999Z')
    const { about } = roundTrip([row()], { ...info, deadline })
    expect(XLSX.SSF.format('yyyy-mm-dd hh:mm', about.B2.v)).toBe('2026-10-05 23:59')
    expect(about.B4.v).toBe('Asia/Dhaka (UTC+6)')
    expect(roundTrip([row()]).about.B2.v).toBe('No deadline set')
  })
})

describe('helpers', () => {
  it('returns a blank cell for missing or broken dates', () => {
    expect(excelDate(null)).toEqual({ t: 's', v: '' })
    expect(excelDate('not a date')).toEqual({ t: 's', v: '' })
  })

  it('names the file after the check time', () => {
    process.env.TZ = 'Asia/Dhaka'
    expect(exportFileName(Date.parse('2026-10-05T17:59:00Z'))).toBe('results-2026-10-05-2359.xlsx')
  })
})
