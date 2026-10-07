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
  repoName: 'rahim/task-1',
  repoUrl: 'https://github.com/rahim/task-1',
  status: 'On time',
  statusKey: 'on_time',
  needsReview: false,
  lateBy: '',
  lateMinutes: null,
  repoCreatedAt: '2026-10-01T04:00:00Z',
  firstPush: { kind: 'recorded', at: '2026-10-02T03:30:00Z' },
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
const own = (id: string) => ({ repoUrl: `https://github.com/x/${id}`, repoName: `x/${id}` })
const klass: ExportRow[] = [
  row({ rowNumber: 2, id: 'A1', ...own('A1'), name: 'Rahim' }),
  row({ rowNumber: 3, id: 'A2', name: 'Nusrat', repoUrl: 'https://github.com/x/shared', repoName: 'x/shared' }),
  row({ rowNumber: 4, id: 'A3', name: 'Tanvir', repoUrl: 'https://github.com/x/shared', repoName: 'x/shared' }),
  row({ rowNumber: 5, id: 'A4', ...own('A4'), name: 'Farhana', status: 'Late', statusKey: 'late', lateBy: '3h 20m', lateMinutes: 200 }),
  row({ rowNumber: 6, id: 'A5', ...own('A5'), name: 'Sabbir', status: 'Changed after deadline', statusKey: 'changed_after', lateBy: '9h' }),
  row({ rowNumber: 7, id: 'A6', name: 'Karim', status: 'Invalid link', statusKey: 'invalid_link', repoUrl: null, repoName: 'will send later' }),
  row({ rowNumber: 8, id: 'A7', ...own('A7'), name: 'Lamia', status: 'Not found', statusKey: 'not_found' }),
  row({ rowNumber: 9, id: 'A8', ...own('A8'), name: 'Rakib', needsReview: true }),
]

/** Writes the finished, coloured file and reads it back, as Excel would. */
function roundTrip(rows: ExportRow[], details = info) {
  const bytes = writeWorkbook(buildWorkbook(rows, details))
  const book = XLSX.read(bytes, { type: 'array', cellFormula: true, cellStyles: true })
  const grid = (name: string) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '' })
  return { bytes, book, grid, results: book.Sheets.Results, about: book.Sheets.Info }
}

const fill = (cell: XLSX.CellObject | undefined) => (cell?.s as { fgColor?: { rgb?: string } } | undefined)?.fgColor?.rgb

/** The colours found in one row, from column A to `last`. One colour means the whole row has it. */
function rowFills(sheet: XLSX.WorkSheet, r: number, last: string): Array<string | undefined> {
  const columns = Array.from({ length: XLSX.utils.decode_col(last) + 1 }, (_, c) => XLSX.utils.encode_col(c))
  return [...new Set(columns.map((column) => fill(sheet[`${column}${r}`])))]
}

/** The XML of the n-th sheet inside the file. */
function sheetXml(bytes: Uint8Array, n: number): string {
  const zip = XLSX.CFB.read(bytes, { type: 'array' })
  const index = zip.FullPaths.findIndex((path: string) => path.endsWith(`/xl/worksheets/sheet${n}.xml`))
  return new TextDecoder().decode(zip.FileIndex[index].content)
}

describe('the results report', () => {
  it('opens on the results, then has a summary, what needs attention, shared repos and info', () => {
    expect(roundTrip(klass).book.SheetNames).toEqual(['Results', 'Summary', 'Needs attention', 'Same repo', 'Info'])
  })

  it('has the columns of the register in the register\'s order with the first push among the dates, then the extra ones', () => {
    expect(roundTrip([row()]).grid('Results')[0]).toEqual([
      'Row', 'ID', 'Name', 'Repo', 'Status', 'Late by', 'Repo created', 'First push', 'Last push', 'Last commit', 'Commits',
      'Late (minutes)', 'Last on-time push', 'Branch',
    ])
  })

  it('has no notes column on any sheet', () => {
    const { book, grid } = roundTrip(klass)
    for (const name of book.SheetNames) expect(grid(name)[0], name).not.toContain('Notes')
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

  it('names the repo as the page does and makes it clickable, but never a cell that is not a validated link', () => {
    const { results } = roundTrip([row(), row({ repoUrl: null, repoName: 'will send later', statusKey: 'invalid_link' })])
    expect(results.D2.v).toBe('rahim/task-1')
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
    const xml = sheetXml(bytes, 1)
    expect(xml).toContain('state="frozen"')
    expect(xml).toContain('<autoFilter ref="A1:N9"/>')
  })

  it('colours the whole row of a person, blank cells and dates included', () => {
    process.env.TZ = 'Asia/Dhaka'
    const { results } = roundTrip(klass)
    expect(rowFills(results, 2, 'N')).toEqual(['D4EFDB']) // On time
    expect(rowFills(results, 5, 'N')).toEqual(['F6CDC8']) // Late
    expect(rowFills(results, 6, 'N')).toEqual(['FBE6B3']) // Changed after deadline
    expect(rowFills(results, 7, 'N')).toEqual(['E6E6E6']) // Invalid link
    expect(rowFills(results, 8, 'N')).toEqual(['E6E6E6']) // Not found
    // A coloured date is still a date, and a coloured link still a link.
    expect(results.I5.w).toBe('05 Oct 2026, 21:10')
    expect(results.D5.l?.Target).toBe('https://github.com/x/A4')
  })

  it('colours an empty repo red and "Has work" blue, and leaves a row still being checked white', () => {
    const { results } = roundTrip([
      row({ status: 'No submission', statusKey: 'no_submission' }),
      row({ status: 'Has work', statusKey: 'submitted' }),
      row({ status: 'Checking', statusKey: 'checking' }),
    ])
    expect(rowFills(results, 2, 'N')).toEqual(['F6CDC8'])
    expect(rowFills(results, 3, 'N')).toEqual(['DCE8F7'])
    expect(rowFills(results, 4, 'N')).toEqual([undefined])
  })

  it('colours whole rows on the "Needs attention" sheet too', () => {
    const attention = roundTrip(klass).book.Sheets['Needs attention']
    expect(rowFills(attention, 1, 'G')).toEqual(['E9E4D6']) // the header
    expect(rowFills(attention, 2, 'G')).toEqual(['F6CDC8']) // Farhana, late
    expect(rowFills(attention, 3, 'G')).toEqual(['FBE6B3']) // Sabbir, changed after deadline
    expect(rowFills(attention, 4, 'G')).toEqual(['E6E6E6']) // Lamia, not found
  })

  it('colours no row on the sheets that are not one row per person', () => {
    const { book } = roundTrip(klass)
    expect(rowFills(book.Sheets['Same repo'], 2, 'F')).toEqual([undefined])
    // On the summary only the name of a status carries its colour.
    const summary = book.Sheets.Summary
    const late = Object.keys(summary).find((address) => address.startsWith('A') && summary[address].v === 'Late')
    expect(fill(summary[late as string])).toBe('F6CDC8')
    expect(fill(summary[(late as string).replace('A', 'B')])).toBeUndefined()
  })

  it('writes dates as real Excel dates in local wall-clock time, shown the way the page shows them', () => {
    process.env.TZ = 'Asia/Dhaka'
    const { results } = roundTrip([row()])
    // 15:10 UTC is 21:10 in Dhaka.
    expect(results.I2.t).toBe('n')
    expect(XLSX.SSF.format('yyyy-mm-dd hh:mm', results.I2.v)).toBe('2026-10-05 21:10')
    // Repo created, first push, last push, last commit.
    expect([results.G2.w, results.H2.w, results.I2.w, results.J2.w]).toEqual([
      '01 Oct 2026, 10:00',
      '02 Oct 2026, 09:30',
      '05 Oct 2026, 21:10',
      '05 Oct 2026, 21:09',
    ])
    expect(results.K2).toMatchObject({ t: 'n', v: 12 })
  })

  it('marks a first push that is only the date of the first commit, and keeps it a date', () => {
    process.env.TZ = 'Asia/Dhaka'
    const { results } = roundTrip([
      row({ firstPush: { kind: 'commit_date', at: '2021-03-04T05:00:00Z' } }),
      row(),
    ])
    expect(results.H2.t).toBe('n')
    expect(results.H2.w).toBe('04 Mar 2021, 11:00 (commit date)')
    expect(XLSX.SSF.format('yyyy-mm-dd hh:mm', results.H2.v)).toBe('2021-03-04 11:00')
    // A recorded push time carries no mark.
    expect(results.H3.w).toBe('02 Oct 2026, 09:30')
    // The mark survives the colour of the row.
    expect(fill(results.H2)).toBe('D4EFDB')
  })

  it('keeps the first push column wide enough for a marked date, which Excel would otherwise show as ####', () => {
    process.env.TZ = 'Asia/Dhaka'
    const rows = [row({ firstPush: { kind: 'commit_date', at: '2021-03-04T05:00:00Z' } })]
    const { book } = buildWorkbook(rows, info)
    const header = XLSX.utils.sheet_to_json<string[]>(book.Sheets.Results, { header: 1 })[0]
    const width = book.Sheets.Results['!cols']?.[header.indexOf('First push')]?.wch ?? 0
    expect(width).toBeGreaterThan((roundTrip(rows).results.H2.w as string).length)
  })

  it('sorts a marked commit date among the push times, oldest first', () => {
    const { results } = roundTrip([
      row({ firstPush: { kind: 'recorded', at: '2026-10-02T03:30:00Z' } }),
      row({ firstPush: { kind: 'commit_date', at: '2021-03-04T05:00:00Z' } }),
      row({ firstPush: { kind: 'recorded', at: '2024-01-01T00:00:00Z' } }),
    ])
    const values = [results.H2.v, results.H3.v, results.H4.v] as number[]
    expect(values.every((value) => typeof value === 'number')).toBe(true)
    expect([...values].sort((a, b) => a - b)).toEqual([values[1], values[2], values[0]])
  })

  it('leaves the cell blank when the first push is no readable date', () => {
    const { results } = roundTrip([
      row({ firstPush: { kind: 'recorded', at: 'not a date' } }),
      row({ firstPush: { kind: 'commit_date', at: '' } }),
    ])
    expect([results.H2?.v ?? '', results.H3?.v ?? '']).toEqual(['', ''])
  })

  it('says in words when the first push is not known, and leaves it blank only for a repo without work', () => {
    const { results } = roundTrip([
      row({ firstPush: { kind: 'unknown' } }),
      row({ firstPush: { kind: 'failed' } }),
      row({ firstPush: { kind: 'none' }, status: 'No submission', statusKey: 'no_submission' }),
      // Never read by the time the file was written: that is not the same as no work.
      row({ firstPush: { kind: 'loading' } }),
    ])
    expect(results.H2.v).toBe('Not known')
    expect(results.H3.v).toBe('Could not be loaded')
    expect(results.H4?.v ?? '').toBe('')
    expect(results.H5.v).toBe('Could not be loaded')
  })

  it('never writes a formula, even when a cell starts with "="', () => {
    const { results } = roundTrip([
      row({ name: '=HYPERLINK("https://evil.example","click")', repoName: '+1+1', repoUrl: null, id: '@SUM(A1)' }),
    ])
    for (const address of ['B2', 'C2', 'D2']) {
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
    expect(results.L2).toMatchObject({ t: 'n', v: 200 })
    expect(results.M2?.v ?? '').toBe('')
    expect(results.K2?.v ?? '').toBe('')
  })

  it('lists who needs attention, most urgent first, with what to do', () => {
    const attention = roundTrip(klass).grid('Needs attention')
    expect(attention[0]).toEqual(['Row', 'ID', 'Name', 'Repo', 'Status', 'Late by', 'What to do'])
    expect(attention.slice(1).map((line) => line[2])).toEqual(['Farhana', 'Sabbir', 'Lamia', 'Karim', 'Rakib'])
    expect(attention[1][6]).toBe('Nothing had reached GitHub by the deadline. The first push came 3h 20m after it.')
    expect(attention[5][6]).toBe('Worth a look yourself. Open this person on the page to see why.')
    // Seven columns, and a filter button on each.
    expect(attention.every((line) => line.length === 7)).toBe(true)
    expect(sheetXml(roundTrip(klass).bytes, 3)).toContain('<autoFilter ref="A1:G6"/>')
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
    expect(about.B2.w).toBe('05 Oct 2026, 23:59')
    expect(about.B4.v).toBe('Asia/Dhaka (UTC+6)')
    expect(grid('Info').map((line) => line[0])).toContain('Status: Changed after deadline')
    expect(grid('Info').find((line) => line[0] === 'First push')?.[1]).toContain('marked "(commit date)"')
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
      row({ repoUrl: null, repoName: 'same text' }),
      row({ repoUrl: null, repoName: 'same text' }),
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
    expect(XLSX.read(bytes, { type: 'array' }).SheetNames[0]).toBe('Results')
  })
})
