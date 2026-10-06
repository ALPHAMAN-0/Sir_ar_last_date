import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import {
  buildWorkbook,
  downloadWorkbook,
  excelDate,
  exportFileName,
  needsAttention,
  sameRepoGroups,
  whatToDo,
  writeWorkbook,
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
  rowNumber: 2,
  id: '20-41234-1',
  name: 'Rahim Uddin',
  repoLink: 'https://github.com/rahim/task-1',
  repoUrl: 'https://github.com/rahim/task-1',
  status: 'On time',
  statusKey: 'on_time',
  needsReview: false,
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
  deadline: Date.parse('2026-10-05T17:59:59.999Z'),
  checkedAt: Date.parse('2026-10-06T04:00:00Z'),
  zone: 'Asia/Dhaka (UTC+6)',
}

/** A class with one of everything. Everyone has a repo of their own, except A2 and A3. */
const own = (id: string) => ({ repoUrl: `https://github.com/x/${id}`, repoLink: `https://github.com/x/${id}` })
const klass: ExportRow[] = [
  row({ rowNumber: 2, id: 'A1', ...own('A1'), name: 'Rahim' }),
  row({ rowNumber: 3, id: 'A2', name: 'Nusrat', repoUrl: 'https://github.com/x/shared', repoLink: 'https://github.com/x/shared' }),
  row({ rowNumber: 4, id: 'A3', name: 'Tanvir', repoUrl: 'https://github.com/x/shared', repoLink: 'https://github.com/x/shared' }),
  row({ rowNumber: 5, id: 'A4', ...own('A4'), name: 'Farhana', status: 'Late', statusKey: 'late', lateBy: '3h 20m', lateMinutes: 200 }),
  row({ rowNumber: 6, id: 'A5', ...own('A5'), name: 'Sabbir', status: 'Changed after deadline', statusKey: 'changed_after', lateBy: '9h' }),
  row({ rowNumber: 7, id: 'A6', name: 'Karim', status: 'Invalid link', statusKey: 'invalid_link', repoUrl: null, repoLink: 'will send later' }),
  row({ rowNumber: 8, id: 'A7', ...own('A7'), name: 'Lamia', status: 'Not found', statusKey: 'not_found' }),
  row({ rowNumber: 9, id: 'A8', ...own('A8'), name: 'Rakib', needsReview: true, notes: 'Main branch was created after the deadline' }),
]

/** Writes the finished, coloured file and reads it back, as Excel would. */
function roundTrip(rows: ExportRow[], details = info) {
  const bytes = writeWorkbook(buildWorkbook(rows, details))
  const book = XLSX.read(bytes, { type: 'array', cellFormula: true, cellStyles: true })
  const grid = (name: string) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '' })
  return { bytes, book, grid, results: book.Sheets.Results, about: book.Sheets.Info }
}

const fill = (cell: XLSX.CellObject | undefined) => (cell?.s as { fgColor?: { rgb?: string } } | undefined)?.fgColor?.rgb

/** The XML of the n-th sheet inside the file. */
function sheetXml(bytes: Uint8Array, n: number): string {
  const zip = XLSX.CFB.read(bytes, { type: 'array' })
  const index = zip.FullPaths.findIndex((path: string) => path.endsWith(`/xl/worksheets/sheet${n}.xml`))
  return new TextDecoder().decode(zip.FileIndex[index].content)
}

describe('the results report', () => {
  it('starts with a summary, then the results, what needs attention, shared repos and info', () => {
    expect(roundTrip(klass).book.SheetNames).toEqual(['Summary', 'Results', 'Needs attention', 'Same repo', 'Info'])
  })

  it('counts every status, with its share, and says what needs a look', () => {
    const summary = roundTrip(klass).grid('Summary')
    const value = (label: string) => summary.find((line) => line[0] === label)
    expect(summary[0][0]).toBe('Submission report')
    expect(value('Source sheet')?.[1]).toBe('Students')
    expect(value('People in this file')?.[1]).toBe('8')
    expect(value('On time')?.slice(1)).toEqual([4, 0.5])
    expect(value('Changed after deadline')?.slice(1)).toEqual([1, 0.125])
    expect(value('Late')?.slice(1)).toEqual([1, 0.125])
    // A status nobody has is still listed when it matters for a deadline.
    expect(value('No submission')?.slice(1)).toEqual([0, 0])
    expect(value('Not found')?.[1]).toBe(1)
    expect(value('Invalid link')?.[1]).toBe(1)
    expect(value('Check failed')).toBeUndefined()
    expect(value('Total')?.slice(1)).toEqual([8, 1])
    expect(value('Need attention')?.[1]).toBe(5)
    expect(value('Handed in the same repo as someone else')?.slice(1)).toEqual([2, '1 repo, see the "Same repo" sheet'])
  })

  it('says when the file holds only the filtered rows', () => {
    const summary = roundTrip([klass[3]], { ...info, totalPeople: 8, filter: 'filtered by Status: Late' }).grid('Summary')
    expect(summary.find((line) => line[0] === 'People in this file')?.[1]).toBe('1 of 8 (filtered by Status: Late)')
  })

  it('without a deadline, counts "Has work" instead of on time and late', () => {
    const rows = [row({ status: 'Has work', statusKey: 'submitted' }), row({ status: 'Nothing yet', statusKey: 'no_submission' })]
    const labels = roundTrip(rows, { ...info, deadline: null }).grid('Summary').map((line) => line[0])
    expect(labels).toContain('Has work')
    expect(labels).toContain('Nothing yet')
    expect(labels).not.toContain('On time')
    expect(labels).not.toContain('Late')
  })

  it('keeps the given row order and writes the header row', () => {
    const { results } = roundTrip([row({ id: 'B' }), row({ id: 'A' }), row({ id: 'C' })])
    expect([results.A1.v, results.B1.v, results.E1.v]).toEqual(['Row', 'ID', 'Status'])
    expect([results.B2.v, results.B3.v, results.B4.v]).toEqual(['B', 'A', 'C'])
  })

  it('makes repo links clickable, but never a cell that is not a validated link', () => {
    const { results } = roundTrip([row(), row({ repoUrl: null, repoLink: 'will send later', statusKey: 'invalid_link' })])
    expect(results.D2.l?.Target).toBe('https://github.com/rahim/task-1')
    expect(results.D3.v).toBe('will send later')
    expect(results.D3.l).toBeUndefined()
  })

  it('colours each status, makes the header bold and keeps it in view', () => {
    const { bytes, results } = roundTrip(klass)
    expect(fill(results.A1)).toBe('E9E4D6')
    expect(fill(results.E2)).toBe('D4EFDB') // On time
    expect(fill(results.E5)).toBe('F6CDC8') // Late
    expect(fill(results.E6)).toBe('FBE6B3') // Changed after deadline
    expect(fill(results.E7)).toBe('E6E6E6') // Invalid link
    expect(fill(results.C2)).toBeUndefined()
    const xml = sheetXml(bytes, 2)
    expect(xml).toContain('state="frozen"')
    expect(xml).toContain('<autoFilter ref="A1:N9"/>')
  })

  it('writes dates as real Excel dates in local wall-clock time', () => {
    process.env.TZ = 'Asia/Dhaka'
    const { results } = roundTrip([row()])
    // 15:10 UTC is 21:10 in Dhaka.
    expect(results.J2.t).toBe('n')
    expect(XLSX.SSF.format('yyyy-mm-dd hh:mm', results.J2.v)).toBe('2026-10-05 21:10')
    expect(results.M2).toMatchObject({ t: 'n', v: 12 })
  })

  it('never writes a formula, even when a cell starts with "="', () => {
    const { results } = roundTrip([
      row({ name: '=HYPERLINK("https://evil.example","click")', notes: '+1+1', id: '@SUM(A1)' }),
    ])
    for (const address of ['B2', 'C2', 'H2']) {
      expect(results[address].t, address).toBe('s')
      expect(results[address].f, address).toBeUndefined()
    }
    expect(results.C2.v).toBe('=HYPERLINK("https://evil.example","click")')
  })

  it('leaves unknown values blank and writes late minutes as a number', () => {
    const { results } = roundTrip([
      row({ status: 'Late', statusKey: 'late', lateBy: '3h 20m', lateMinutes: 200, commits: null }),
    ])
    expect(results.F2.v).toBe('3h 20m')
    expect(results.G2).toMatchObject({ t: 'n', v: 200 })
    expect(results.K2?.v ?? '').toBe('')
    expect(results.M2?.v ?? '').toBe('')
  })

  it('lists who needs attention, most urgent first, with what to do', () => {
    const attention = roundTrip(klass).grid('Needs attention')
    expect(attention[0]).toEqual(['Row', 'ID', 'Name', 'Repo link', 'Status', 'Late by', 'What to do', 'Notes'])
    expect(attention.slice(1).map((line) => line[2])).toEqual(['Farhana', 'Sabbir', 'Lamia', 'Karim', 'Rakib'])
    expect(attention[1][6]).toBe('Nothing had reached GitHub by the deadline. The first push came 3h 20m after it.')
    expect(attention[5][6]).toBe('Worth a look yourself: see the notes.')
  })

  it('says so when nobody needs attention and nobody shares a repo', () => {
    const { grid } = roundTrip([row()])
    expect(grid('Needs attention')[1][0]).toBe('Nobody needs attention.')
    expect(grid('Same repo')[1][0]).toBe('Every repo was handed in by one person only.')
  })

  it('groups the people who handed in the same repo', () => {
    const { grid, book } = roundTrip(klass)
    expect(grid('Same repo').slice(1)).toEqual([
      ['https://github.com/x/shared', 2, 'A2; A3', 'Nusrat; Tanvir', '3, 4', 'On time'],
    ])
    expect(book.Sheets['Same repo'].A2.l?.Target).toBe('https://github.com/x/shared')
  })

  it('records the deadline, check time, zone and what each status means', () => {
    process.env.TZ = 'Asia/Dhaka'
    const { about, grid } = roundTrip([row()])
    expect(XLSX.SSF.format('yyyy-mm-dd hh:mm', about.B2.v)).toBe('2026-10-05 23:59')
    expect(about.B4.v).toBe('Asia/Dhaka (UTC+6)')
    expect(grid('Info').map((line) => line[0])).toContain('Status: Changed after deadline')
    expect(roundTrip([row()], { ...info, deadline: null }).about.B2.v).toBe('No deadline set')
  })
})

describe('helpers', () => {
  it('puts the most urgent problems first and leaves out rows that are fine', () => {
    expect(needsAttention(klass).map((line) => line.statusKey)).toEqual([
      'late',
      'changed_after',
      'not_found',
      'invalid_link',
      'on_time',
    ])
  })

  it('explains a change after the deadline with how late it was', () => {
    expect(whatToDo(row({ statusKey: 'changed_after', lateBy: '9h' }))).toMatch(/^Work was in on time, then changed 9h after it\./)
    expect(whatToDo(row())).toBe('')
  })

  it('groups only validated links, largest group first', () => {
    const groups = sameRepoGroups([
      row({ rowNumber: 5, repoUrl: 'https://github.com/a/b' }),
      row({ rowNumber: 2, repoUrl: 'https://github.com/a/b' }),
      row({ repoUrl: null, repoLink: 'same text' }),
      row({ repoUrl: null, repoLink: 'same text' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].rows.map((line) => line.rowNumber)).toEqual([2, 5])
  })

  it('returns a blank cell for missing or broken dates', () => {
    expect(excelDate(null)).toEqual({ t: 's', v: '' })
    expect(excelDate('not a date')).toEqual({ t: 's', v: '' })
  })

  it('names the file after the check time', () => {
    process.env.TZ = 'Asia/Dhaka'
    expect(exportFileName(Date.parse('2026-10-05T17:59:00Z'))).toBe('results-2026-10-05-2359.xlsx')
  })

  it('hands the finished bytes and the file name to the saver', () => {
    const save = vi.fn()
    downloadWorkbook(buildWorkbook([row()], info), 'results.xlsx', save)
    const [bytes, name] = save.mock.calls[0]
    expect(name).toBe('results.xlsx')
    expect(XLSX.read(bytes, { type: 'array' }).SheetNames[0]).toBe('Summary')
  })
})
