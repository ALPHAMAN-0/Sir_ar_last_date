import { describe, expect, it } from 'vitest'
import type { RepoMeta, RepoOk } from '../../shared/api.ts'
import { judge } from '../logic/verdict.ts'
import { parseRepoLink } from '../sheet/parseRepoLink.ts'
import type { PersonRow } from '../state/store.ts'
import { groupLabel, personLabel, planComparison } from './run.ts'

const HEAD = 'a'.repeat(40)

const ok = (key: string, over: Partial<RepoOk> = {}): RepoOk => ({
  key,
  state: 'ok',
  nameWithOwner: key,
  isEmpty: false,
  isFork: false,
  isArchived: false,
  createdAt: '2026-10-01T00:00:00Z',
  pushedAt: '2026-10-05T09:05:11Z',
  defaultBranch: 'main',
  headOid: HEAD,
  headCommittedAt: '2026-10-05T09:05:00Z',
  totalCommits: 5,
  ...over,
})

function person(rowNumber: number, rawLink: string, meta?: RepoMeta, id = '', name = ''): PersonRow {
  const link = parseRepoLink(rawLink)
  return {
    row: { rowId: `r${rowNumber}`, rowNumber, id, name, rawLink, link },
    meta,
    activity: undefined,
    verdict: judge({ link, meta, deadline: null }),
  }
}

describe('planComparison', () => {
  it('makes one group and one request per repo, in sheet order', () => {
    const plan = planComparison([
      person(2, 'github.com/b/two', ok('b/two', { defaultBranch: 'master', headOid: 'b'.repeat(40) }), '02', 'Bee'),
      person(3, 'github.com/a/one', ok('a/one'), '03', 'Ay'),
    ])
    expect(plan.inputs).toEqual([
      { repo: 'b/two', headOid: 'b'.repeat(40), branch: 'master' },
      { repo: 'a/one', headOid: HEAD, branch: 'main' },
    ])
    expect(plan.groups.map((group) => group.repo)).toEqual(['b/two', 'a/one'])
    expect(plan.groups[0].people).toEqual([{ rowId: 'r2', rowNumber: 2, id: '02', name: 'Bee' }])
    expect(plan.leftOut).toEqual([])
    expect(plan.waiting).toBe(0)
  })

  it('puts everybody who handed in the same repo into one group', () => {
    const plan = planComparison([
      person(2, 'https://github.com/octocat/Hello-World', ok('octocat/hello-world'), '1', 'Rahim'),
      person(3, 'https://github.com/a/one', ok('a/one'), '2', 'Nusrat'),
      person(4, 'github.com/octocat/hello-world.git', ok('octocat/hello-world'), '3', 'Farhana'),
    ])
    expect(plan.inputs).toHaveLength(2)
    expect(plan.groups[0].people.map((p) => p.name)).toEqual(['Rahim', 'Farhana'])
  })

  it('groups two links that lead to the same renamed repo', () => {
    const plan = planComparison([
      person(2, 'github.com/a/old-name', ok('a/old-name', { nameWithOwner: 'A/New-Name' })),
      person(3, 'github.com/a/new-name', ok('a/new-name', { nameWithOwner: 'A/New-Name' })),
    ])
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]).toMatchObject({ repo: 'a/new-name', nameWithOwner: 'A/New-Name' })
    expect(plan.inputs).toEqual([{ repo: 'a/new-name', headOid: HEAD, branch: 'main' }])
  })

  it('leaves a row out, with the reason, when its repo cannot be compared', () => {
    const plan = planComparison([
      person(2, 'will send later', undefined, '1', 'Karim'),
      person(3, 'github.com/a/gone', { key: 'a/gone', state: 'not_found' }),
      person(4, 'github.com/a/flaky', { key: 'a/flaky', state: 'error', code: 'timeout' }),
      person(5, 'github.com/a/empty', ok('a/empty', { isEmpty: true, headOid: null, defaultBranch: null })),
      person(6, 'github.com/a/headless', ok('a/headless', { headOid: null })),
      person(7, ''),
    ])
    expect(plan.groups).toEqual([])
    expect(plan.leftOut.map((entry) => [entry.person.rowNumber, entry.reason])).toEqual([
      [2, 'Link could not be read'],
      [3, 'Repo not found (private, deleted or mistyped)'],
      [4, 'Could not be checked; press Refresh on the register'],
      [5, 'The repo is empty'],
      [6, 'The repo is empty'],
      [7, 'No link in this row'],
    ])
    expect(plan.leftOut[0].rawLink).toBe('will send later')
  })

  it('counts rows the register is still checking, without leaving them out', () => {
    const plan = planComparison([person(2, 'github.com/a/one'), person(3, 'github.com/b/two', ok('b/two'))])
    expect(plan.waiting).toBe(1)
    expect(plan.leftOut).toEqual([])
    expect(plan.groups).toHaveLength(1)
  })

  it('remembers that a repo is a fork', () => {
    expect(planComparison([person(2, 'github.com/a/one', ok('a/one', { isFork: true }))]).groups[0].isFork).toBe(true)
  })
})

describe('labels', () => {
  const group = (count: number) => ({
    repo: 'a/one',
    nameWithOwner: 'a/one',
    isFork: false,
    people: Array.from({ length: count }, (_, i) => ({ rowId: `r${i}`, rowNumber: i + 2, id: `0${i}`, name: `N${i}` })),
  })

  it('names a person by ID and name, or by row when the sheet has neither', () => {
    expect(personLabel({ rowId: 'r2', rowNumber: 2, id: '22-1', name: 'Rahim' })).toBe('22-1 · Rahim')
    expect(personLabel({ rowId: 'r2', rowNumber: 2, id: '', name: 'Rahim' })).toBe('Rahim')
    expect(personLabel({ rowId: 'r9', rowNumber: 9, id: '', name: '' })).toBe('Row 9')
  })

  it('names a group by its first people and counts the rest', () => {
    expect(groupLabel(group(1))).toBe('00 · N0')
    expect(groupLabel(group(2))).toBe('00 · N0, 01 · N1')
    expect(groupLabel(group(5))).toBe('00 · N0, 01 · N1 +3 more')
    expect(groupLabel(group(5), 1)).toBe('00 · N0 +4 more')
  })
})
