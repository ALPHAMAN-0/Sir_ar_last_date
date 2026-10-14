import { describe, expect, it } from 'vitest'
import type { RepoMeta, RepoOk } from '../../shared/api.ts'
import type { CommitAuthor, CommitShares } from '../logic/commitShares.ts'
import { judge } from '../logic/verdict.ts'
import { parseRepoLink } from '../sheet/parseRepoLink.ts'
import type { PersonRow } from '../state/store.ts'
import { filterContribution, summariseContribution } from './rows.ts'

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

const author = (who: string, commits: number, over: Partial<CommitAuthor> = {}): CommitAuthor => ({
  who,
  login: who.toLowerCase(),
  commits,
  merges: 0,
  ...over,
})

/** The commits of one repo as the loader hands them over, the most commits first. */
const counted = (authors: CommitAuthor[], truncated = false): CommitShares => ({
  kind: 'counted',
  total: authors.reduce((sum, entry) => sum + entry.commits, 0),
  truncated,
  authors,
})

const shares = (entries: Record<string, CommitShares>) => new Map(Object.entries(entries))

describe('summariseContribution', () => {
  it('names every committer of a repo with their commits and their share', () => {
    const { repos, notCounted, waiting } = summariseContribution(
      [person(2, 'https://github.com/Crew/Project', ok('crew/project', { nameWithOwner: 'Crew/Project' }), '01', 'Rahim')],
      shares({ 'crew/project': counted([author('rahim', 8, { merges: 2 }), author('Nusrat Jahan', 4, { login: null })]) }),
    )
    expect(notCounted).toEqual([])
    expect(waiting).toBe(0)
    expect(repos).toHaveLength(1)
    expect(repos[0]).toMatchObject({
      repo: 'crew/project',
      nameWithOwner: 'Crew/Project',
      state: 'counted',
      total: 12,
      truncated: false,
      members: [{ rowId: 'r2', rowNumber: 2, id: '01', name: 'Rahim' }],
    })
    expect(repos[0].contributors.map((entry) => [entry.who, entry.commits, entry.merges])).toEqual([
      ['rahim', 8, 2],
      ['Nusrat Jahan', 4, 0],
    ])
    expect(repos[0].contributors[0].share).toBeCloseTo(8 / 12)
    expect(repos[0].contributors[1].share).toBeCloseTo(4 / 12)
  })

  it('writes a share the way the results report does', () => {
    const { repos } = summariseContribution(
      [person(2, 'github.com/a/x', ok('a/x'))],
      shares({ 'a/x': counted([author('rahim', 400), author('nusrat', 199), author('guest', 1)]) }),
    )
    expect(repos[0].contributors.map((entry) => entry.percent)).toEqual(['67%', '33%', '<1%'])
    expect(repos[0].contributors.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1)
  })

  it('shows a repo handed in by several people once, with all of them in sheet order', () => {
    const { repos } = summariseContribution(
      [
        person(2, 'https://github.com/crew/project', ok('crew/project'), '1', 'Rahim'),
        person(3, 'https://github.com/solo/work', ok('solo/work'), '2', 'Nusrat'),
        person(4, 'github.com/Crew/Project.git', ok('crew/project'), '3', 'Farhana'),
      ],
      shares({ 'crew/project': counted([author('rahim', 3)]), 'solo/work': counted([author('nusrat', 2)]) }),
    )
    expect(repos.map((entry) => entry.repo)).toEqual(['crew/project', 'solo/work'])
    expect(repos[0].members.map((member) => member.name)).toEqual(['Rahim', 'Farhana'])
    expect(repos[1].members.map((member) => member.name)).toEqual(['Nusrat'])
  })

  it('puts the old and the new name of a renamed repo together', () => {
    const { repos } = summariseContribution(
      [
        person(2, 'github.com/zeit/ms', ok('zeit/ms', { nameWithOwner: 'vercel/ms' }), '1', 'Old link'),
        person(3, 'github.com/vercel/ms', ok('vercel/ms', { nameWithOwner: 'vercel/ms' }), '2', 'New link'),
      ],
      // The commits were read under the first row's link only.
      shares({ 'zeit/ms': counted([author('leerob', 5)]) }),
    )
    expect(repos).toHaveLength(1)
    expect(repos[0].repo).toBe('vercel/ms')
    expect(repos[0].members.map((member) => member.name)).toEqual(['Old link', 'New link'])
    expect(repos[0].state).toBe('counted')
    expect(repos[0].contributors.map((entry) => entry.who)).toEqual(['leerob'])
  })

  it('keeps every row without commits to count, with the reason', () => {
    const { repos, notCounted } = summariseContribution(
      [
        person(2, 'will send later', undefined, '1', 'No link'),
        person(3, 'github.com/a/gone', { key: 'a/gone', state: 'not_found' }, '2', 'Gone'),
        person(4, 'github.com/a/down', { key: 'a/down', state: 'error', code: 'timeout' }, '3', 'Down'),
        person(5, 'github.com/a/empty', ok('a/empty', { isEmpty: true, headOid: null, defaultBranch: null }), '4', 'Empty'),
        person(
          6,
          'github.com/a/fork',
          ok('a/fork', { isFork: true, createdAt: '2026-10-03T00:00:00Z', pushedAt: '2026-10-01T00:00:00Z' }),
          '5',
          'Fork',
        ),
      ],
      new Map(),
    )
    expect(repos).toEqual([])
    expect(notCounted.map((entry) => [entry.member.name, entry.reason])).toEqual([
      ['No link', 'Link could not be read'],
      ['Gone', 'Repo not found (private, deleted or mistyped)'],
      ['Down', 'Could not be checked; press Refresh on the register'],
      ['Empty', 'The repo is empty'],
      ['Fork', 'Fork with no pushes of its own'],
    ])
    expect(notCounted[0].rawLink).toBe('will send later')
  })

  it('counts the rows the register is still checking', () => {
    const { repos, notCounted, waiting } = summariseContribution(
      [person(2, 'github.com/a/one'), person(3, 'github.com/a/two', ok('a/two'))],
      new Map(),
    )
    expect(waiting).toBe(1)
    expect(notCounted).toEqual([])
    expect(repos.map((entry) => entry.repo)).toEqual(['a/two'])
  })

  it('says loading until the commits were read, and failed when they could not be', () => {
    const { repos } = summariseContribution(
      [person(2, 'github.com/a/one', ok('a/one')), person(3, 'github.com/a/two', ok('a/two'))],
      shares({ 'a/two': { kind: 'failed' } }),
    )
    expect(repos.map((entry) => [entry.repo, entry.state, entry.contributors.length])).toEqual([
      ['a/one', 'loading', 0],
      ['a/two', 'failed', 0],
    ])
  })

  it('takes the answer that could be read when a renamed repo was asked for under both links', () => {
    const rows = [
      person(2, 'github.com/zeit/ms', ok('zeit/ms', { nameWithOwner: 'vercel/ms' })),
      person(3, 'github.com/vercel/ms', ok('vercel/ms', { nameWithOwner: 'vercel/ms' })),
    ]
    const read = counted([author('leerob', 5)])
    for (const entries of [
      { 'zeit/ms': { kind: 'failed' } as CommitShares, 'vercel/ms': read },
      { 'zeit/ms': read, 'vercel/ms': { kind: 'failed' } as CommitShares },
    ]) {
      const { repos } = summariseContribution(rows, shares(entries))
      expect(repos.map((entry) => [entry.state, entry.total])).toEqual([['counted', 5]])
    }
  })

  it('shows a repo whose commits hold nobody to name as counted, with nothing in it', () => {
    const { repos } = summariseContribution(
      [person(2, 'github.com/a/x', ok('a/x')), person(3, 'github.com/a/y', ok('a/y'))],
      shares({ 'a/x': { kind: 'none' }, 'a/y': counted([]) }),
    )
    expect(repos.map((entry) => [entry.state, entry.total, entry.contributors])).toEqual([
      ['counted', 0, []],
      ['counted', 0, []],
    ])
  })

  it('says when only the newest commits of a long history were counted', () => {
    const { repos } = summariseContribution(
      [person(2, 'github.com/a/long', ok('a/long', { totalCommits: 4200 }))],
      shares({ 'a/long': counted([author('rahim', 700), author('nusrat', 300)], true) }),
    )
    expect(repos[0]).toMatchObject({ total: 1000, truncated: true })
    expect(repos[0].contributors.map((entry) => entry.percent)).toEqual(['70%', '30%'])
  })

  it('gives each person their padding commits once the commits were checked', () => {
    const checked = { real: 12, tiny: 5, whitespace: 26, empty: 2, unknown: 0 }
    const { repos } = summariseContribution(
      [person(2, 'github.com/a/x', ok('a/x')), person(3, 'github.com/a/y', ok('a/y'))],
      shares({
        'a/x': counted([author('rahim', 40, { checked }), author('nusrat', 20, { checked: { ...checked, whitespace: 0, empty: 0 } })]),
        'a/y': counted([author('salma', 3)]),
      }),
    )
    expect(repos[0].contributors.map((entry) => entry.padding)).toEqual([28, 0])
    // Not checked is not the same as none found.
    expect(repos[1].contributors.map((entry) => entry.padding)).toEqual([null])
  })
})

describe('filterContribution', () => {
  const { repos } = summariseContribution(
    [
      person(2, 'github.com/crew/project', ok('crew/project', { nameWithOwner: 'Crew/Project' }), '22-46001-1', 'Rahim Uddin'),
      person(3, 'github.com/solo/work', ok('solo/work'), '22-46002-1', 'Nusrat Jahan'),
    ],
    shares({ 'crew/project': counted([author('octocat', 3)]), 'solo/work': counted([author('nusrat-j', 2)]) }),
  )
  const found = (search: string) => filterContribution(repos, search).map((entry) => entry.repo)

  it('gives every repo back for an empty search', () => {
    expect(found('')).toEqual(['crew/project', 'solo/work'])
    expect(found('   ')).toEqual(['crew/project', 'solo/work'])
  })

  it('finds a repo by a member, by its name, or by a committer', () => {
    expect(found('rahim')).toEqual(['crew/project'])
    expect(found('46002')).toEqual(['solo/work'])
    expect(found('CREW/proj')).toEqual(['crew/project'])
    expect(found('octocat')).toEqual(['crew/project'])
    expect(found('nobody')).toEqual([])
  })
})
