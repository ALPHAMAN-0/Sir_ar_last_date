// The similarity .xlsx. Like src/sheet/exportXlsx.test.ts, every check is a
// real round trip: the workbook is written to bytes and read back as Excel would.

import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import type { TreeFile } from '../../shared/api.ts'
import { formatDateTimeShort } from '../logic/time.ts'
import { at, repo } from '../test/stories.ts'
import { analyse } from './compare.ts'
import { judgePair, pairKey, sharedBlobs } from './first.ts'
import type { FirstState } from './firstRun.ts'
import {
  downloadReport,
  MAX_FILES_PER_PAIR,
  reportFileName,
  writeReport,
  type ReportInput,
} from './report.ts'
import { noSkips } from './rules.ts'
import type { Plan, RepoGroup } from './run.ts'
import { summarise } from './summary.ts'
import type { Loaded, TreeError } from './trees.ts'
import type { RepoFiles } from './types.ts'

declare const process: { env: Record<string, string | undefined> }
const originalZone = process.env.TZ
afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

const sha = (content: string) =>
  [...content].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0').repeat(5)

function tree(repo: string, files: Record<string, string>): RepoFiles {
  const list: TreeFile[] = Object.entries(files).map(([path, content]) => ({ path, sha: sha(content), size: 2000 }))
  return { repo, branch: 'main', headOid: sha(repo), files: list, skipped: { ...noSkips(), thirdParty: 40 }, unopened: 0 }
}

const who = (rowNumber: number, id: string, name: string) => ({ rowId: `r${rowNumber}`, rowNumber, id, name })
const group = (repo: string, people: ReturnType<typeof who>[], isFork = false): RepoGroup => ({
  repo,
  nameWithOwner: repo,
  isFork,
  people,
})

type Setup = { groups: RepoGroup[]; trees: RepoFiles[]; errors?: Record<string, TreeError>; leftOut?: Plan['leftOut'] }

function input({ groups, trees, errors = {}, leftOut = [] }: Setup): ReportInput {
  const plan: Plan = {
    groups,
    inputs: groups.map((entry) => ({ repo: entry.repo, headOid: sha(entry.repo), branch: 'main' })),
    leftOut,
    waiting: 0,
  }
  const treeMap = new Map(trees.map((entry) => [entry.repo, entry]))
  const loaded: Loaded = { trees: treeMap, errors: new Map(Object.entries(errors)) }
  const analysis = analyse(trees)
  return {
    summary: summarise(plan, loaded, analysis),
    analysis,
    trees: treeMap,
    info: {
      fileName: 'section-b.xlsx',
      sheetName: 'Students',
      checkedAt: Date.parse('2026-10-05T17:59:00Z'),
      zone: 'Asia/Dhaka (UTC+6)',
    },
  }
}

/** Writes the finished, coloured file and reads it back, as Excel would. */
function roundTrip(setup: Setup, first?: ReportInput['first']) {
  const bytes = writeReport({ ...input(setup), first })
  const book = XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: true, cellStyles: true })
  const rows = (name: string) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '' })
  return { book, rows, bytes }
}

const work = { 'app.js': 'the work', 'view.js': 'the view', 'data.js': 'the data' }
const klass: Setup = {
  groups: [
    group('rahim/task-1', [who(2, '20-41234-1', 'Rahim Uddin'), who(6, '20-41238-1', 'Farhana Akter')]),
    group('karim/task-1', [who(3, '20-41235-1', 'Karim Hasan')], true),
    group('salma/task-1', [who(4, '20-41236-1', 'Salma Akter')]),
    group('tania/gone', [who(5, '20-41237-1', 'Tania Islam')]),
  ],
  trees: [
    tree('rahim/task-1', work),
    tree('karim/task-1', { 'main.js': 'the work', 'view.js': 'the view', 'data.js': 'karim changed this' }),
    tree('salma/task-1', { 'solo.js': 'her own work' }),
  ],
  errors: { 'tania/gone': { kind: 'not_found', message: 'GitHub no longer shows this repo. It may be private or deleted now.' } },
  leftOut: [{ person: who(7, '20-41239-1', 'Fahim Morshed'), rawLink: 'will send later', reason: 'Link could not be read' }],
}

describe('buildReportWorkbook', () => {
  it('has one sheet for each question a teacher asks', () => {
    expect(roundTrip(klass).book.SheetNames).toEqual([
      'Pairs',
      'Who was first',
      'Matching files',
      'Same repo',
      'People',
      'Starter files',
      'Info',
    ])
  })

  it('lists a repo handed in by several people first, as a 100% match', () => {
    const { book, rows } = roundTrip(klass)
    const [, first] = rows('Pairs')
    expect(first).toEqual([
      1, 'Same repo', 1,
      '20-41234-1; 20-41238-1', 'Rahim Uddin; Farhana Akter', 'https://github.com/rahim/task-1',
      '', '(same people as A)', 'https://github.com/rahim/task-1',
      3, 1, 3, 1, 3, 0,
      '',
      'Handed in by 2 people: the very same repo, so every file is identical',
    ])
    expect(book.Sheets.Pairs.F2.l?.Target).toBe('https://github.com/rahim/task-1')
  })

  it('writes one row per pair, with both repos named and linked', () => {
    const { book, rows } = roundTrip(klass)
    const [header, , second] = rows('Pairs')
    expect(header).toEqual([
      'Pair', 'Result', 'Match', 'A ID', 'A name', 'A repo', 'B ID', 'B name', 'B repo',
      'Identical files', 'Share of A', 'A files compared', 'Share of B', 'B files compared',
      'Same name, other content', 'Who had it first', 'Note',
    ])
    expect(rows('Pairs')).toHaveLength(3)
    expect(second.slice(0, 2)).toEqual([2, 'Mostly identical'])
    expect(second.slice(3, 9)).toEqual([
      '20-41234-1; 20-41238-1',
      'Rahim Uddin; Farhana Akter',
      'https://github.com/rahim/task-1',
      '20-41235-1',
      'Karim Hasan',
      'https://github.com/karim/task-1',
    ])
    expect(second.slice(9)).toEqual([2, 2 / 3, 3, 2 / 3, 3, 1, 'Not checked', 'B is a fork'])
    expect(book.Sheets.Pairs.F3.l?.Target).toBe('https://github.com/rahim/task-1')
    expect(book.Sheets.Pairs.I3.l?.Target).toBe('https://github.com/karim/task-1')
  })

  it('colours each result, makes headers bold and keeps them in view', () => {
    const { book, bytes } = roundTrip(klass)
    const fill = (sheet: string, address: string) =>
      (book.Sheets[sheet][address].s as { fgColor?: { rgb?: string } } | undefined)?.fgColor?.rgb
    expect(fill('Pairs', 'A1')).toBe('E9E4D6')
    expect(fill('Pairs', 'B2')).toBe('F6CDC8') // Same repo
    expect(fill('Pairs', 'C2')).toBe('F6CDC8')
    expect(fill('Pairs', 'B3')).toBe('FBE6B3') // Mostly identical
    expect(fill('People', 'K2')).toBe('F6CDC8')
    const zip = XLSX.CFB.read(bytes, { type: 'array' })
    for (let n = 1; n <= 6; n++) {
      const index = zip.FullPaths.findIndex((path: string) => path.endsWith(`/sheet${n}.xml`))
      expect(new TextDecoder().decode(zip.FileIndex[index].content), `sheet${n}`).toContain('state="frozen"')
    }
  })

  it('writes shares as real numbers that Excel shows as a percentage', () => {
    const pairs = roundTrip(klass).book.Sheets.Pairs
    expect(pairs.C3).toMatchObject({ t: 'n', v: 2 / 3 })
    expect(XLSX.SSF.format('0%', pairs.C3.v)).toBe('67%')
    expect(pairs.C3.z).toBe('0%')
    expect(pairs.K3.z).toBe('0%')
    expect(pairs.C2).toMatchObject({ t: 'n', v: 1, z: '0%' })
  })

  it('names every matching file, with both paths when a copy was renamed', () => {
    const { rows } = roundTrip(klass)
    expect(rows('Matching files')).toEqual([
      ['Pair', 'A name', 'B name', 'What', 'Path in A', 'Path in B', 'Size (bytes)'],
      [1, 'Rahim Uddin; Farhana Akter', '(same people)', 'Same repo: every file is identical', '3 files compared', '', 6000],
      [2, 'Rahim Uddin; Farhana Akter', 'Karim Hasan', 'Identical content', 'app.js', 'main.js', 2000],
      [2, 'Rahim Uddin; Farhana Akter', 'Karim Hasan', 'Identical content', 'view.js', 'view.js', 2000],
      [2, 'Rahim Uddin; Farhana Akter', 'Karim Hasan', 'Same name, other content', 'data.js', 'data.js', ''],
    ])
  })

  it('lists the repos that more than one person handed in', () => {
    expect(roundTrip(klass).rows('Same repo')).toEqual([
      ['Repo', 'People', 'IDs', 'Names', 'Sheet rows'],
      ['https://github.com/rahim/task-1', 2, '20-41234-1; 20-41238-1', 'Rahim Uddin; Farhana Akter', '2, 6'],
    ])
  })

  it('accounts for every row of the uploaded sheet on the People sheet', () => {
    const people = roundTrip(klass).rows('People')
    expect(people[0]).toEqual([
      'Row', 'ID', 'Name', 'Repo', 'Compared', 'Files compared', 'Starter files', 'Other files left out',
      'Closest match', 'Closest match repo', 'Closest match %', 'Closest result', 'Pairs mostly identical or more', 'Note',
    ])
    expect(people.slice(1).map((row) => [row[0], row[2], row[4], row[13]])).toEqual([
      [2, 'Rahim Uddin', 'Yes', 'Same repo as row 6'],
      [3, 'Karim Hasan', 'Yes', ''],
      [4, 'Salma Akter', 'Yes', ''],
      [5, 'Tania Islam', 'No', 'GitHub no longer shows this repo. It may be private or deleted now.'],
      [6, 'Farhana Akter', 'Yes', 'Same repo as row 2'],
      [7, 'Fahim Morshed', 'No', 'Link could not be read'],
    ])
    // Rahim: 3 files compared, none starter, 40 left out; his closest match is Farhana, same repo.
    expect(people[1].slice(5, 13)).toEqual([
      3, 0, 40, 'Same repo as 20-41238-1 · Farhana Akter', 'https://github.com/rahim/task-1', 1, 'Same repo', 2,
    ])
    // Karim's closest is the repo Rahim and Farhana handed in, at 67%.
    expect(people[2].slice(8, 13)).toEqual([
      '20-41234-1 · Rahim Uddin, 20-41238-1 · Farhana Akter', 'https://github.com/rahim/task-1', 2 / 3, 'Mostly identical', 1,
    ])
    // Salma took part and matched nobody; Fahim's cell is shown as typed, not as a link.
    expect(people[3].slice(8, 13)).toEqual(['', '', '', '', 0])
    expect(people[6][3]).toBe('will send later')
    expect(people[6].slice(5, 13)).toEqual(['', '', '', '', '', '', '', ''])
  })

  it('lists the starter files that were left out', () => {
    const starter = { 'starter/a.js': 'handed out a', 'starter/b.js': 'handed out b' }
    const groups = ['s1', 's2', 's3', 's4', 's5', 's6'].map((owner, i) => group(`${owner}/task`, [who(i + 2, `id-${i}`, owner)]))
    const trees = groups.map((entry) => tree(entry.repo, { ...starter, 'own.js': `own ${entry.repo}` }))
    const { rows } = roundTrip({ groups, trees })
    expect(rows('Starter files')).toEqual([
      ['File', 'Found in repos', 'Size (bytes)'],
      ['starter/a.js', 6, 2000],
      ['starter/b.js', 6, 2000],
    ])
    expect(rows('Pairs')).toHaveLength(1)
  })

  it('never writes a formula, even when a name, ID or path starts with "="', () => {
    const { book } = roundTrip({
      groups: [
        group('a/x', [who(2, '=SUM(A1)', '+cmd|" /C calc"!A0')]),
        group('b/y', [who(3, '@id', '=HYPERLINK("https://evil.example","click")')]),
      ],
      trees: [
        tree('a/x', { '=1+1.js': 'shared', 'b.js': 'shared 2', 'c.js': 'shared 3' }),
        tree('b/y', { '=1+1.js': 'shared', 'b.js': 'shared 2', 'c.js': 'shared 3' }),
      ],
    })
    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name]
      for (const address of Object.keys(sheet)) {
        if (address.startsWith('!')) continue
        expect(sheet[address].f, `${name}!${address}`).toBeUndefined()
      }
    }
    expect(book.Sheets.Pairs.D2).toMatchObject({ t: 's', v: '=SUM(A1)' })
    expect(book.Sheets.Pairs.H2).toMatchObject({ t: 's', v: '=HYPERLINK("https://evil.example","click")' })
    expect(book.Sheets['Matching files'].E2).toMatchObject({ t: 's', v: '=1+1.js' })
  })

  it('records how the report was made on the Info sheet', () => {
    process.env.TZ = 'Asia/Dhaka'
    const { book, rows } = roundTrip(klass)
    const info = new Map(rows('Info').map((row) => [row[0] as string, row[1]]))
    expect(info.get('Source file')).toBe('section-b.xlsx')
    expect(info.get('Sheet')).toBe('Students')
    expect(XLSX.SSF.format('yyyy-mm-dd hh:mm', book.Sheets.Info.B3.v)).toBe('2026-10-05 23:59')
    expect(info.get('Time zone of all dates')).toBe('Asia/Dhaka (UTC+6)')
    expect(info.get('People in the sheet')).toBe(6)
    expect(info.get('People compared')).toBe(4)
    expect(info.get('People not compared')).toBe(2)
    expect(info.get('Repos compared')).toBe(3)
    expect(info.get('Matches found (rows on the Pairs sheet)')).toBe(2)
    expect(info.get('Repos handed in by more than one person (100% match)')).toBe(1)
    expect(info.get('People who handed in the same repo as someone else')).toBe(2)
    expect(info.get('Pairs of different repos that could be formed')).toBe(3)
    expect(info.get('Pairs of different repos with identical files')).toBe(1)
    expect(info.get('Pairs of different repos mostly identical or more')).toBe(1)
    expect(info.get('Matching files listed')).toBe(3)
    expect(info.get('Starter-file limit')).toBe(4)
    expect(info.get('Starter files left out')).toBe(0)
    expect(String(info.get('What "identical" means'))).toMatch(/byte for byte/)
    expect(String(info.get('What this cannot see'))).toMatch(/not a verdict/)
    // No label twice.
    expect(info.size).toBe(rows('Info').length)
  })

  it('still writes a valid file when a pair shares thousands of files', () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < 3000; i++) many[`src/some/rather/long/folder/name/component-number-${i}.jsx`] = `content ${i}`
    const setup: Setup = {
      groups: [group('a/big', [who(2, '1', 'A')]), group('b/big', [who(3, '2', 'B')])],
      trees: [tree('a/big', many), tree('b/big', many)],
    }
    const { rows } = roundTrip(setup)
    const files = rows('Matching files')
    expect(files).toHaveLength(1 + MAX_FILES_PER_PAIR + 1)
    expect(files[files.length - 1].slice(3, 5)).toEqual(['Not listed', '2,500 more files'])
    expect(rows('Pairs')[1][9]).toBe(3000)
  })

  it('writes an empty but complete workbook when nothing matches', () => {
    const { book, rows } = roundTrip({
      groups: [group('a/x', [who(2, '1', 'A')]), group('b/y', [who(3, '2', 'B')])],
      trees: [tree('a/x', { 'a.js': 'one' }), tree('b/y', { 'b.js': 'two' })],
    })
    expect(book.SheetNames).toHaveLength(7)
    expect(rows('Pairs')).toHaveLength(1)
    expect(rows('Who was first')).toHaveLength(1)
    expect(rows('Matching files')).toHaveLength(1)
    expect(rows('People')).toHaveLength(3)
  })
})

describe('who had the files first', () => {
  const WORK = { 'app.js': 'the work', 'view.js': 'the view' }
  /** Rahim pushed the work on 12 September, Karim on the 14th. */
  const rahim = () =>
    repo('rahim/task-1', [
      { at: '02 09:00', files: { 'README.md': 'rahim' } },
      { at: '12 10:14', files: { 'README.md': 'rahim', ...WORK } },
    ])
  const karim = (when = '14 23:51') =>
    repo('karim/task-1', [
      { at: '03 09:00', files: { 'README.md': 'karim' } },
      { at: when, files: { 'README.md': 'karim', ...WORK } },
    ])
  const checked = (b = karim()): FirstState => {
    const a = rahim()
    return {
      state: 'ready',
      evidence: judgePair({
        a: a.facts,
        b: b.facts,
        blobs: sharedBlobs(a.head, b.head, new Set()),
        aHistory: a.history,
        bHistory: b.history,
        aCommits: a.commits,
        bCommits: b.commits,
      }),
    }
  }
  const KEY = pairKey('rahim/task-1', 'karim/task-1')
  const fill = (book: XLSX.WorkBook, sheet: string, address: string) =>
    (book.Sheets[sheet][address].s as { fgColor?: { rgb?: string } } | undefined)?.fgColor?.rgb

  it('names the first repo on the Pairs sheet, in words that fit the size of the match', () => {
    const { book, rows } = roundTrip(klass, new Map([[KEY, checked()]]))
    const [header, sameRepo, pair] = rows('Pairs')
    const column = header.indexOf('Who had it first')
    expect(column).toBe(15)
    // One repo handed in by several people has no direction.
    expect(sameRepo[column]).toBe('')
    expect(pair[column]).toBe('A first: B likely copied from A')
    expect(pair[column + 1]).toBe('B is a fork')
    expect(fill(book, 'Pairs', 'P3')).toBe('FBE6B3')
    expect(fill(book, 'Pairs', 'P2')).toBeUndefined()
  })

  it('says so when a pair was not checked, or not checked to the end', () => {
    const cell = (first?: ReportInput['first']) => roundTrip(klass, first).rows('Pairs')[2][15]
    expect(cell()).toBe('Not checked')
    expect(cell(new Map())).toBe('Not checked')
    expect(cell(new Map([[KEY, { state: 'waiting' }]]))).toBe('Not checked')
    expect(cell(new Map([[KEY, { state: 'checking' }]]))).toBe('Not finished when this report was made')
    expect(cell(new Map([[KEY, checked(karim('12 10:40'))]]))).toBe('Cannot tell')
    // None of these is a finding, so none gets a row on the sheet of findings.
    expect(roundTrip(klass, new Map([[KEY, { state: 'checking' }]])).rows('Who was first')).toHaveLength(1)
  })

  it('writes what was seen about each checked pair on a sheet of its own', () => {
    process.env.TZ = 'Asia/Dhaka'
    const { book, rows } = roundTrip(klass, new Map([[KEY, checked()]]))
    const [header, row] = rows('Who was first')
    const cells = Object.fromEntries(header.map((title, index) => [title as string, row[index]]))
    expect(cells).toMatchObject({
      Pair: 2,
      'A name': 'Rahim Uddin; Farhana Akter',
      'B name': 'Karim Hasan',
      'Had it first': 'A first',
      Result: 'B likely copied from A',
      'Decided by': 'Push times',
      'Later by (hours)': 61.6,
      'Files shared': 2,
      'Files A had first': 2,
      'Files B had first': 0,
      'Files not decided': 0,
      'A pushes that brought them': 1,
      'B pushes that brought them': 1,
      'A commits': 5,
      'B commits': 5,
      "Commits in A by B's account": 0,
      "Commits in B by A's account": 0,
      'Commits in both': 0,
      'Files also in other repos': 0,
    })
    const when = (text: string) => formatDateTimeShort(at(text), Date.parse('2026-10-05T17:59:00Z'))
    expect(cells['What was seen']).toBe(
      `A pushed them ${when('12 10:14')}; B pushed them ${when('14 23:51')}; B got them 2d 13h later; ` +
        "A's repo has 5 commits in all, B's has 5",
    )
    // Real dates, in the zone the page shows: 10:14 UTC is 16:14 in Dhaka.
    const sheet = book.Sheets['Who was first']
    const date = (title: string) =>
      XLSX.SSF.format('yyyy-mm-dd hh:mm', sheet[XLSX.utils.encode_cell({ r: 1, c: header.indexOf(title) })].v)
    expect(date('A repo created')).toBe('2026-09-01 14:00')
    expect(date('A got the files from')).toBe('2026-09-12 16:14')
    expect(date('A got the files until')).toBe('2026-09-12 16:14')
    expect(date('B got the files from')).toBe('2026-09-15 05:51')
    expect(fill(book, 'Who was first', 'D2')).toBe('FBE6B3')
    expect(fill(book, 'Who was first', 'A1')).toBe('E9E4D6')
  })

  it('leaves the dates empty when the files were not seen arriving', () => {
    const fork = judgePair({
      a: rahim().facts,
      b: { ...karim().facts, isFork: true, parent: 'rahim/task-1' },
      blobs: [],
    })
    const { rows } = roundTrip(klass, new Map([[KEY, { state: 'ready', evidence: fork }]]))
    const [header, row] = rows('Who was first')
    const cell = (title: string) => row[header.indexOf(title)]
    expect(cell('Decided by')).toBe('GitHub says one is a fork of the other')
    expect(cell('A got the files from')).toBe('')
    expect(cell('Later by (hours)')).toBe('')
    expect(cell("Commits in A by B's account")).toBe('')
    expect(String(cell('What was seen'))).toMatch(/^B's repo is a GitHub fork of A's repo; /)
  })

  it('counts the checked pairs on the Info sheet and says what "first" means', () => {
    const info = (first?: ReportInput['first']) =>
      new Map(roundTrip(klass, first).rows('Info').map((row) => [row[0] as string, row[1]]))
    const none = info()
    expect(none.get('Pairs checked for who had the files first')).toBe(0)
    expect(none.get('Pairs in which one repo clearly had the files first')).toBe(0)
    const one = info(new Map([[KEY, checked()]]))
    expect(one.get('Pairs checked for who had the files first')).toBe(1)
    expect(one.get('Pairs in which one repo clearly had the files first')).toBe(1)
    const close = info(new Map([[KEY, checked(karim('12 10:40'))]]))
    expect(close.get('Pairs checked for who had the files first')).toBe(1)
    expect(close.get('Pairs in which one repo clearly had the files first')).toBe(0)
    expect(String(one.get('What "had it first" means'))).toMatch(/not the date written in a commit/)
    expect(String(one.get('What "had it first" cannot see'))).toMatch(/outside GitHub/)
  })

  it('never writes a formula into the new sheet either', () => {
    const { book } = roundTrip(
      {
        groups: [
          group('rahim/task-1', [who(2, '=SUM(A1)', '=HYPERLINK("https://evil.example","click")')]),
          group('karim/task-1', [who(3, '@id', '+cmd')]),
        ],
        trees: [tree('rahim/task-1', work), tree('karim/task-1', work)],
      },
      new Map([[KEY, checked()]]),
    )
    const sheet = book.Sheets['Who was first']
    for (const address of Object.keys(sheet)) {
      if (!address.startsWith('!')) expect(sheet[address].f, address).toBeUndefined()
    }
    expect(sheet.B2).toMatchObject({ t: 's', v: '=HYPERLINK("https://evil.example","click")' })
    expect(sheet.C2).toMatchObject({ t: 's', v: '+cmd' })
  })
})

describe('reportFileName', () => {
  it('names the file after the check time in the local zone', () => {
    process.env.TZ = 'Asia/Dhaka'
    expect(reportFileName(Date.parse('2026-10-05T17:59:00Z'))).toBe('similarity-2026-10-05-2359.xlsx')
  })

  it('produces a four-digit time even when minutes are zero', () => {
    process.env.TZ = 'Asia/Dhaka'
    expect(reportFileName(Date.parse('2026-10-05T18:00:00Z'))).toBe('similarity-2026-10-06-0000.xlsx')
  })
})

describe('downloadReport', () => {
  it('saves the finished file under the right name', () => {
    const save = vi.fn()
    process.env.TZ = 'Asia/Dhaka'
    downloadReport(input(klass), save)
    const [bytes, name] = save.mock.calls[0]
    expect(name).toBe('similarity-2026-10-05-2359.xlsx')
    expect(XLSX.read(bytes, { type: 'array' }).SheetNames).toEqual([
      'Pairs', 'Who was first', 'Matching files', 'Same repo', 'People', 'Starter files', 'Info',
    ])
  })
})
