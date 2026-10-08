// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommitInfo } from '../../shared/api.ts'
import { failure, okRepo, oid, saveSheet, stubApi, type FakeApi } from '../test/fakeApi.ts'

const WRITTEN = '2026-09-20T12:00:00Z'

type By = { login?: string | null; name?: string | null; merge?: boolean }
/** One commit, by a GitHub account unless `login` is null: then GitHub cannot say whose it is. */
const commit = (seed: string, { login = 'student', name = null, merge = false }: By = {}): CommitInfo => ({
  oid: oid(seed),
  committedAt: WRITTEN,
  authoredAt: WRITTEN,
  headline: seed,
  parents: merge ? [oid('p1'), oid('p2')] : [oid('p1')],
  authorName: name,
  authorLogin: login,
})

type Options = {
  deadlineInput?: string
  /** Commit lists that GitHub answers page by page, newest page first. */
  commitPages?: Record<string, CommitInfo[][]>
}

/** A fresh store with the sheet saved and every repo checked, as when Download is pressed. */
async function open(links: string[], data: Partial<FakeApi>, options: Options = {}) {
  saveSheet(
    links.map((link, index) => [`id-${index}`, `Person ${index}`, link]),
    { deadlineInput: options.deadlineInput },
  )
  const fake = stubApi(data)
  const answer = fake.fetch.getMockImplementation() as typeof fetch
  fake.fetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    const pages = options.commitPages?.[url.searchParams.get('repo') ?? '']
    if (url.pathname !== '/api/v1/commits' || !pages) return answer(input)
    const index = Number(url.searchParams.get('after')?.replace('page-', '') ?? 0)
    return new Response(
      JSON.stringify({ commits: pages[index], next: index + 1 < pages.length ? `page-${index + 1}` : null }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })

  vi.resetModules()
  const store = await import('./store.ts')
  const { loadCommitShares } = await import('./commitShares.ts')
  store.start()
  await vi.waitFor(() => {
    expect(store.getState().checkedAt).not.toBeNull()
    expect(store.getState().loadingRepos).toBe(0)
    expect(store.currentPeople().every((person) => person.verdict.need === null)).toBe(true)
    expect(store.currentPeople().some((person) => person.verdict.status === 'checking')).toBe(false)
  })
  const asked = (route: string) => fake.paths().filter((path) => path === `/api/v1/${route}`).length
  return { store, fake, asked, loadCommitShares, read: () => loadCommitShares(store.currentPeople()) }
}

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('who committed, for the download', () => {
  it("counts each person's commits on a repo with work, and asks once", async () => {
    const { read, asked } = await open(['github.com/a/x'], {
      repos: { 'a/x': okRepo('a/x') },
      commits: {
        'a/x': [
          commit('merge', { login: 'rahim', merge: true }),
          commit('two', { login: 'rahim' }),
          commit('one', { login: 'nusrat' }),
        ],
      },
    })
    expect(await read()).toEqual(
      new Map([
        [
          'a/x',
          {
            kind: 'counted',
            total: 3,
            truncated: false,
            authors: [
              { who: 'rahim', login: 'rahim', commits: 2, merges: 1 },
              { who: 'nusrat', login: 'nusrat', commits: 1, merges: 0 },
            ],
          },
        ],
      ]),
    )
    expect(asked('commits')).toBe(1)
  })

  it('has nothing to count, and asks nothing, for a repo without work, one that was not found, or no link', async () => {
    const { read, asked } = await open(['github.com/a/empty', 'github.com/a/missing', 'not a link'], {
      repos: { 'a/empty': okRepo('a/empty', { isEmpty: true, headOid: null, defaultBranch: null }) },
    })
    expect(await read()).toEqual(new Map([['a/empty', { kind: 'none' }], ['a/missing', { kind: 'none' }]]))
    expect(asked('commits')).toBe(0)
  })

  it('counts nothing for a fork its owner never pushed to: its commits are the other repo\'s', async () => {
    // A fork copies its parent's pushedAt until its owner pushes, and its head is the parent's.
    const { read, asked } = await open(['github.com/a/fork'], {
      repos: {
        'a/fork': okRepo('a/fork', { isFork: true, createdAt: '2026-09-10T00:00:00Z', pushedAt: '2026-09-01T08:00:00Z' }),
      },
      commits: { 'a/fork': [commit('theirs', { login: 'upstream' })] },
    })
    expect((await read()).get('a/fork')).toEqual({ kind: 'none' })
    expect(asked('commits')).toBe(0)
  })

  it('says so when the commits cannot be read', async () => {
    const { read } = await open(['github.com/a/gone', 'github.com/a/busy', 'github.com/a/fine'], {
      repos: { 'a/gone': okRepo('a/gone'), 'a/busy': okRepo('a/busy'), 'a/fine': okRepo('a/fine') },
      commits: {
        'a/gone': failure(404, 'not_found', 'Not found.'),
        'a/busy': failure(503, 'quota_reserved', 'The shared GitHub limit is used up for this hour.'),
        'a/fine': [commit('only')],
      },
    })
    const shares = await read()
    expect(shares.get('a/gone')).toEqual({ kind: 'failed' })
    expect(shares.get('a/busy')).toEqual({ kind: 'failed' })
    expect(shares.get('a/fine')).toMatchObject({ kind: 'counted', total: 1 })
  })

  it('asks once for a repo handed in twice, and nothing for a second download', async () => {
    const { read, asked } = await open(['github.com/a/x', 'github.com/A/X'], {
      repos: { 'a/x': okRepo('a/x') },
      commits: { 'a/x': [commit('only')] },
    })
    const first = await read()
    expect([...first.keys()]).toEqual(['a/x'])
    expect(asked('commits')).toBe(1)

    expect(await read()).toEqual(first)
    expect(asked('commits')).toBe(1)
  })

  it('uses the list the first pushes already read', async () => {
    const { store, asked, loadCommitShares } = await open(['github.com/a/old'], {
      repos: { 'a/old': okRepo('a/old') },
      commits: { 'a/old': [commit('oldest')] },
    })
    const { loadFirstPushes } = await import('./firstPushes.ts')
    expect((await loadFirstPushes(store.currentPeople())).get('a/old')).toEqual({ kind: 'commit_date', at: WRITTEN })
    expect(asked('commits')).toBe(1)

    expect((await loadCommitShares(store.currentPeople())).get('a/old')).toMatchObject({ kind: 'counted', total: 1 })
    expect(asked('commits')).toBe(1)
  })

  it('stops at ten pages of a long history and says so', async () => {
    const pages = Array.from({ length: 11 }, (_, p) => [commit(`p${p}`)])
    const { read, asked } = await open(
      ['github.com/a/long'],
      { repos: { 'a/long': okRepo('a/long') } },
      { commitPages: { 'a/long': pages } },
    )
    expect((await read()).get('a/long')).toMatchObject({ kind: 'counted', total: 10, truncated: true })
    expect(asked('commits')).toBe(10)
  })

  it('reports how many repos are done, and still answers for nobody at all', async () => {
    const { store, loadCommitShares } = await open(['github.com/a/x', 'github.com/a/y', 'see my email'], {
      repos: { 'a/x': okRepo('a/x'), 'a/y': okRepo('a/y') },
      commits: { 'a/x': [commit('x')], 'a/y': [commit('y')] },
    })
    const progress: Array<[number, number]> = []
    await loadCommitShares(store.currentPeople(), (done, total) => progress.push([done, total]))
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]])

    const nobody: Array<[number, number]> = []
    expect(await loadCommitShares([], (done, total) => nobody.push([done, total]))).toEqual(new Map())
    expect(nobody).toEqual([[0, 0]])
  })
})
