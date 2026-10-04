// Phase 5 — .xlsx download of the similarity report.
// Mirrors src/sheet/exportXlsx.test.ts in style: a real round-trip through
// SheetJS, formula-injection attempts must end up as text, dates as Excel
// serial numbers.

import { afterEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  buildReportWorkbook,
  downloadReport,
  reportFileName,
  type ReportInfo,
  type ReportPair,
} from './report.ts'

declare const process: { env: Record<string, string | undefined> }
const originalZone = process.env.TZ
afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

const pair = (over: Partial<ReportPair> = {}): ReportPair => ({
  aKey: 'rahim/task-1',
  aId: '20-41234-1',
  aName: 'Rahim Uddin',
  aBranch: 'main',
  aHeadOid: 'a'.repeat(40),
  bKey: 'karim/task-1',
  bId: '20-41235-1',
  bName: 'Karim Hasan',
  bBranch: 'main',
  bHeadOid: 'b'.repeat(40),
  overlap: 5,
  union: 12,
  score: 5 / 12,
  shared: ['README.md', 'index.html', 'style.css', 'src/main.js', 'src/util.js'],
  onlyA: ['secret.md'],
  onlyB: ['images/logo.png'],
  ...over,
})

const info: ReportInfo = {
  sheetName: 'Students',
  checkedAt: Date.parse('2026-10-05T17:59:00Z'),
  totalTrees: 20,
  failedTrees: 1,
  totalPairs: 190,
  zone: 'Asia/Dhaka (UTC+6)',
}

/** Writes the workbook to bytes and reads it back, as Excel would. */
function roundTrip(pairs: ReportPair[], details = info) {
  const bytes = XLSX.write(buildReportWorkbook(pairs, details), { type: 'array', bookType: 'xlsx' })
  const book = XLSX.read(bytes, { type: 'array', cellFormula: true })
  return { book, results: book.Sheets.Results, about: book.Sheets.Info }
}

describe('buildReportWorkbook', () => {
  it('keeps the given pair order and writes the header row', () => {
    const { book, results } = roundTrip([
      pair({ aId: 'B' }),
      pair({ aId: 'A' }),
      pair({ aId: 'C' }),
    ])
    expect(book.SheetNames).toEqual(['Results', 'Info'])
    expect(results.A1.v).toBe('A ID')
    expect(results.B1.v).toBe('A name')
    expect(results.E1.v).toBe('B ID')
    expect([results.A2.v, results.A3.v, results.A4.v]).toEqual(['B', 'A', 'C'])
  })

  it('writes overlap percentage as a number and overlap/union as numbers', () => {
    const { results } = roundTrip([pair({ score: 0.5, overlap: 4, union: 8 })])
    // The "Overlap %" column should be a numeric Excel serial / number,
    // not a string with a percent sign.
    expect(results.H2).toMatchObject({ t: 'n', v: 50 })
    expect(results.I2).toMatchObject({ t: 'n', v: 4 })
    expect(results.J2).toMatchObject({ t: 'n', v: 8 })
  })

  it('joins path lists with newlines and writes them as plain text', () => {
    const { results } = roundTrip([pair()])
    // Shared/paths, A only, B only → K/L/M
    expect(results.K2.t).toBe('s')
    expect(results.K2.v).toBe('README.md\nindex.html\nstyle.css\nsrc/main.js\nsrc/util.js')
    expect(results.L2.v).toBe('secret.md')
    expect(results.M2.v).toBe('images/logo.png')
  })

  it('never writes a formula, even when an id or name starts with "="', () => {
    const { results } = roundTrip([
      pair({
        aId: '=SUM(A1)',
        aName: '+cmd|" /C calc"!A0',
        bName: '@HYPERLINK("https://evil.example","click")',
        onlyA: ['=1+1'],
      }),
    ])
    for (const address of ['A2', 'B2', 'E2', 'F2', 'L2']) {
      expect(results[address].t, address).toBe('s')
      expect(results[address].f, address).toBeUndefined()
    }
    expect(results.A2.v).toBe('=SUM(A1)')
    expect(results.L2.v).toBe('=1+1')
  })

  it('leaves unknown values blank and writes shared count as a number', () => {
    const { results } = roundTrip([
      pair({ aId: '', aName: '', bId: '', bName: '', overlap: 0, union: 0, score: 0 }),
    ])
    expect(results.A2.v).toBe('')
    expect(results.B2.v).toBe('')
    expect(results.E2.v).toBe('')
    expect(results.F2.v).toBe('')
    expect(results.H2).toMatchObject({ t: 'n', v: 0 })
    expect(results.I2).toMatchObject({ t: 'n', v: 0 })
  })

  it('records the source sheet, checked-at time and zone on the Info sheet', () => {
    process.env.TZ = 'Asia/Dhaka'
    const { about } = roundTrip([pair()])
    expect(about.A1.v).toBe('Source sheet')
    expect(about.B1.v).toBe('Students')
    expect(XLSX.SSF.format('yyyy-mm-dd hh:mm', about.B3.v)).toBe('2026-10-05 23:59')
    expect(about.B5.v).toBe('Asia/Dhaka (UTC+6)')
    expect(about.B6.v).toBe(20) // totalTrees
    expect(about.B7.v).toBe(1) // failedTrees
    expect(about.B8.v).toBe(190) // totalPairs
  })

  it('describes how similarity was computed in plain English', () => {
    const { about } = roundTrip([pair()])
    expect(about.A9.v).toBe('Method')
    expect(about.B9.v).toMatch(/Jaccard/i)
    expect(about.B9.v).toMatch(/file names/i)
  })
})

describe('reportFileName', () => {
  it('names the file after the check time in local zone', () => {
    process.env.TZ = 'Asia/Dhaka'
    expect(reportFileName(Date.parse('2026-10-05T17:59:00Z'))).toBe(
      'similarity-2026-10-05-2359.xlsx',
    )
  })

  it('produces a four-digit time even when minutes are zero', () => {
    process.env.TZ = 'Asia/Dhaka'
    expect(reportFileName(Date.parse('2026-10-05T18:00:00Z'))).toBe(
      'similarity-2026-10-06-0000.xlsx',
    )
  })
})

describe('downloadReport', () => {
  it('writes the workbook to disk with the right name and compression', () => {
    let captured: { name: string; compression: boolean | undefined } | null = null
    const writer = ((_book: unknown, name: string, options?: { compression?: boolean }) => {
      captured = { name, compression: options?.compression }
      return undefined as unknown as void
    }) as typeof XLSX.writeFile
    process.env.TZ = 'Asia/Dhaka'
    downloadReport([pair()], { ...info, checkedAt: Date.parse('2026-10-05T17:59:00Z') }, writer)
    expect(captured).toEqual({ name: 'similarity-2026-10-05-2359.xlsx', compression: true })
  })
})