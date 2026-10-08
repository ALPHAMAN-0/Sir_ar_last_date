import { describe, expect, it } from 'vitest'
import type { CommitInfo, RepoMeta, RepoOk } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import { parseRepoLink } from '../sheet/parseRepoLink.ts'
import type { SheetRow } from '../sheet/columns.ts'
import { judgeRows, type PersonRow, type Sheet } from '../state/store.ts'
import type { FirstPush } from './firstPush.ts'
import {
  countByStatus,
  filterPeople,
  noteTexts,
  repoLinkFor,
  sortPeople,
  statusLabel,
  toExportRows,
} from './people.ts'
import { buildTimeline } from './timeline.ts'

const DEADLINE = Date.parse('2026-10-05T17:59:59.999Z')

const row = (rowNumber: number, id: string, name: string, rawLink: string): SheetRow => ({
  rowId: `r${rowNumber}`,
  rowNumber,
  id,
  name,
  rawLink,
  link: parseRepoLink(rawLink),
})

const repo = (key: string, over: Partial<RepoOk> = {}): RepoMeta => ({
  key,
  state: 'ok',
  nameWithOwner: key,
  isEmpty: false,
  isFork: false,
  isArchived: false,
  createdAt: '2026-10-01T00:00:00Z',
  pushedAt: '2026-10-05T10:00:00Z',
  defaultBranch: 'main',
  headOid: 'a'.repeat(40),
  headCommittedAt: '2026-10-05T09:59:00Z',
  totalCommits: 5,
  ...over,
})

const sheet: Sheet = {
  fileName: 'class.xlsx',
  sheetName: 'Students',
  truncated: false,
  rows: [
    row(2, '10', 'Rahim', 'https://github.com/rahim/task'),
    row(3, '9', 'karim', 'https://github.com/karim/task'),
    row(4, '100', 'Salma', 'https://github.com/salma/task'),
    row(5, '11', 'Nadia', 'https://github.com/nadia/task'),
    row(6, '12', 'Tania', 'not a link at all'),
    row(7, '13', 'Zahid', 'https://github.com/rahim/task'),
  ],
}

const repos = new Map<string, RepoMeta>([
  ['rahim/task', repo('rahim/task', { nameWithOwner: 'Rahim/Task', totalCommits: 12 })],
  ['karim/task', repo('karim/task', { createdAt: '2026-10-05T19:00:00Z', pushedAt: '2026-10-05T21:00:00Z', totalCommits: 3 })],
  ['salma/task', repo('salma/task', { isEmpty: true, headOid: null, defaultBranch: null, pushedAt: '2026-10-02T00:00:00Z' })],
  ['nadia/task', { key: 'nadia/task', state: 'not_found' }],
])

const people = judgeRows(sheet, repos, new Map(), DEADLINE)
const names = (list: PersonRow[]) => list.map((person) => person.row.name)

describe('judgeRows', () => {
  it('judges every sheet row and flags repos used twice', () => {
    expect(people.map((person) => person.verdict.status)).toEqual([
      'on_time',
      'late',
      'no_submission',
      'not_found',
      'invalid_link',
      'on_time',
    ])
    expect(people[0].verdict.notes).toContain('duplicate_link')
    expect(people[5].verdict.notes).toContain('duplicate_link')
    expect(people[1].verdict.notes).not.toContain('duplicate_link')
  })

  it('counts people per status', () => {
    expect(Object.fromEntries(countByStatus(people))).toEqual({
      on_time: 2,
      late: 1,
      no_submission: 1,
      not_found: 1,
      invalid_link: 1,
    })
  })
})

describe('sortPeople', () => {
  it('sorts IDs as numbers, not as text', () => {
    expect(names(sortPeople(people, { column: 'id', descending: false }))).toEqual([
      'karim', 'Rahim', 'Nadia', 'Tania', 'Zahid', 'Salma',
    ])
  })

  it('ignores letter case in names', () => {
    expect(names(sortPeople(people, { column: 'name', descending: false }))).toEqual([
      'karim', 'Nadia', 'Rahim', 'Salma', 'Tania', 'Zahid',
    ])
  })

  it('puts rows without a date last in both directions', () => {
    const newest = names(sortPeople(people, { column: 'pushedAt', descending: true }))
    expect(newest.slice(0, 3)).toEqual(['karim', 'Rahim', 'Zahid'])
    expect(newest.slice(3)).toEqual(['Salma', 'Nadia', 'Tania'])
    const oldest = names(sortPeople(people, { column: 'pushedAt', descending: false }))
    expect(oldest.slice(0, 3)).toEqual(['Salma', 'Rahim', 'Zahid'])
    expect(oldest.slice(3)).toEqual(['karim', 'Nadia', 'Tania'])
  })

  it('puts problems first when sorting by status', () => {
    expect(names(sortPeople(people, { column: 'status', descending: false }))).toEqual([
      'karim', 'Salma', 'Nadia', 'Tania', 'Rahim', 'Zahid',
    ])
  })

  it('leaves the original list untouched', () => {
    const before = names(people)
    sortPeople(people, { column: 'name', descending: true })
    expect(names(people)).toEqual(before)
  })
})

describe('filterPeople', () => {
  it('filters by status and by text in ID, name or link', () => {
    expect(names(filterPeople(people, 'on_time', ''))).toEqual(['Rahim', 'Zahid'])
    expect(names(filterPeople(people, 'all', 'KARIM'))).toEqual(['karim'])
    expect(names(filterPeople(people, 'all', 'salma/task'))).toEqual(['Salma'])
    expect(names(filterPeople(people, 'all', '100'))).toEqual(['Salma'])
    expect(names(filterPeople(people, 'late', 'rahim'))).toEqual([])
  })
})

describe('labels and links', () => {
  it('softens the wording until the deadline has passed', () => {
    expect(statusLabel('on_time', true)).toBe('On time')
    expect(statusLabel('on_time', false)).toBe('Submitted')
    expect(statusLabel('no_submission', false)).toBe('Nothing yet')
  })

  it('builds repo links only from validated names', () => {
    expect(repoLinkFor(people[0])).toBe('https://github.com/rahim/task')
    expect(repoLinkFor(people[3])).toBe('https://github.com/nadia/task')
    expect(repoLinkFor(people[4])).toBe('')
  })

  it('explains problems in words', () => {
    expect(noteTexts(people[4])).toEqual(['Link could not be read'])
    expect(noteTexts(people[3])).toEqual(['Private, deleted or mistyped'])
  })

  it('prepares export rows in the given order', () => {
    const rows = toExportRows(sortPeople(people, { column: 'name', descending: false }), true)
    expect(rows.map((item) => [item.name, item.status])).toEqual([
      ['karim', 'Late'],
      ['Nadia', 'Not found'],
      ['Rahim', 'On time'],
      ['Salma', 'No submission'],
      ['Tania', 'Invalid link'],
      ['Zahid', 'On time'],
    ])
    // The repo is named as the page names it, and linked by its validated address.
    expect(rows[2]).toMatchObject({ commits: 12, branch: 'main', repoName: 'Rahim/Task', repoUrl: 'https://github.com/rahim/task' })
    expect(rows[1]).toMatchObject({ repoName: 'nadia/task', repoUrl: 'https://github.com/nadia/task' })
    // An empty repo has no commits and no push worth reporting.
    expect(rows[3]).toMatchObject({ commits: null, lastPushAt: null })
    // A bad link is exported as it was typed.
    expect(rows[4]).toMatchObject({ repoName: 'not a link at all', repoUrl: null })
  })

  it('gives each export row the first push read for its repo', () => {
    const read = new Map<string, FirstPush>([
      ['rahim/task', { kind: 'recorded', at: '2026-10-02T03:00:00Z' }],
      ['salma/task', { kind: 'none' }],
    ])
    const rows = toExportRows(people, true, read)
    // Rahim and Zahid handed in the same repo.
    expect(rows[0].firstPush).toEqual({ kind: 'recorded', at: '2026-10-02T03:00:00Z' })
    expect(rows[5].firstPush).toEqual(rows[0].firstPush)
    // No work, no repo, no link: no first push.
    expect(rows.slice(2, 5).map((item) => item.firstPush.kind)).toEqual(['none', 'none', 'none'])
  })

  it('gives each export row who committed on its repo, and says when that was not read', () => {
    const counted = {
      kind: 'counted' as const,
      total: 2,
      truncated: false,
      authors: [{ who: 'rahim', login: 'rahim', commits: 2, merges: 0 }],
    }
    const rows = toExportRows(people, true, new Map(), new Map([['rahim/task', counted]]))
    // Rahim and Zahid handed in the same repo.
    expect(rows[0].commitShares).toEqual(counted)
    expect(rows[5].commitShares).toBe(rows[0].commitShares)
    // No work, no repo, no link: nobody's commits to count.
    expect(rows.slice(2, 5).map((item) => item.commitShares.kind)).toEqual(['none', 'none', 'none'])
    // A repo with work that was not read is written as not loaded.
    expect(rows[1].commitShares).toEqual({ kind: 'failed' })
  })

  it('falls back on what the register knows: a late row names its own first push', () => {
    const FIRST = '2026-10-05T21:00:00Z'
    const log = {
      events: [{ ts: FIRST, type: 'branch_creation', ref: 'refs/heads/main', before: ZERO_OID, after: 'a'.repeat(40), actor: 'karim' }],
      exhausted: true,
      capped: false,
      settled: true,
      probe: null,
      failed: false,
    }
    const judged = judgeRows(sheet, repos, new Map([['karim/task', log]]), DEADLINE)
    expect(toExportRows(judged, true)[1]).toMatchObject({ status: 'Late', firstPush: { kind: 'recorded', at: FIRST } })
  })
})

describe('buildTimeline', () => {
  const commit = (oid: string, committedAt: string): CommitInfo => ({
    oid,
    committedAt,
    authoredAt: committedAt,
    headline: oid,
    parents: [],
    authorName: null,
    authorLogin: null,
  })
  const kinds = (deadline: number | null, ...commits: CommitInfo[]) =>
    buildTimeline(commits, deadline).map((item) =>
      item.kind === 'commit' ? item.commit.oid : item.kind === 'day' ? `day ${item.key} (${item.count})` : 'DEADLINE',
    )

  // Days are computed in UTC here so the test does not depend on the machine's zone.
  const c1 = commit('c1', '2026-10-03T08:00:00Z')
  const c2 = commit('c2', '2026-10-05T08:00:00Z')
  const c3 = commit('c3', '2026-10-05T09:00:00Z')
  const c4 = commit('c4', '2026-10-06T08:00:00Z')

  it('lists newest first with one heading per day', () => {
    const items = buildTimeline([c1, c3, c2, c4], null)
    expect(items.filter((item) => item.kind === 'commit').map((item) => (item.kind === 'commit' ? item.commit.oid : ''))).toEqual(['c4', 'c3', 'c2', 'c1'])
    expect(items.filter((item) => item.kind === 'day')).toHaveLength(new Set(items.filter((item) => item.kind === 'day').map((item) => (item.kind === 'day' ? item.key : ''))).size)
    expect(items.some((item) => item.kind === 'deadline')).toBe(false)
  })

  it('draws exactly one deadline line, between the commits dated after and before it', () => {
    const between = kinds(Date.parse('2026-10-05T08:30:00Z'), c1, c2, c3, c4)
    expect(between.filter((kind) => kind === 'DEADLINE')).toHaveLength(1)
    expect(between.indexOf('DEADLINE')).toBeGreaterThan(between.indexOf('c3'))
    expect(between.indexOf('DEADLINE')).toBeLessThan(between.indexOf('c2'))
  })

  it('puts the line first when everything is dated before it, last when everything is after', () => {
    expect(kinds(Date.parse('2026-12-01T00:00:00Z'), c1, c2)[0]).toBe('DEADLINE')
    expect(kinds(Date.parse('2026-01-01T00:00:00Z'), c1, c2).at(-1)).toBe('DEADLINE')
    expect(kinds(Date.parse('2026-01-01T00:00:00Z'))).toEqual(['DEADLINE'])
  })
})
