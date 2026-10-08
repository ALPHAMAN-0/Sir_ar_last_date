// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommitFilesResponse, CommitInfo, FileChange } from '../../shared/api.ts'
import { failure, okRepo, oid, saveSheet, stubApi, type FakeApi } from '../test/fakeApi.ts'

const WRITTEN = '2026-09-20T12:00:00Z'

const commit = (seed: string, login = 'student'): CommitInfo => ({
  oid: oid(seed),
  committedAt: WRITTEN,
  authoredAt: WRITTEN,
  headline: seed,
  parents: [oid('parent')],
  authorName: null,
  authorLogin: login,
})

const file = (realChange: boolean | undefined, lines = 10): FileChange => ({
  path: 'src/app.js',
  status: 'modified',
  additions: lines,
  deletions: 0,
  ...(realChange === undefined ? {} : { realChange }),
})

/** The files of one commit as the Worker answers them. */
const filesOf = (files: FileChange[], over: Partial<CommitFilesResponse> = {}): CommitFilesResponse => ({
  sha: '',
  stats: { additions: files.reduce((sum, item) => sum + item.additions, 0), deletions: 0 },
  files,
  more: false,
  tooLarge: false,
  ...over,
})

/** A fresh store with the sheet saved and every repo checked, as when the register is on screen. */
async function open(links: string[], data: Partial<FakeApi>) {
  saveSheet(links.map((link, index) => [`id-${index}`, `Person ${index}`, link]), {})
  const fake = stubApi(data)

  vi.resetModules()
  const store = await import('./store.ts')
  const padding = await import('./padding.ts')
  store.start()
  await vi.waitFor(() => {
    expect(store.getState().checkedAt).not.toBeNull()
    expect(store.getState().loadingRepos).toBe(0)
    expect(store.currentPeople().some((person) => person.verdict.status === 'checking')).toBe(false)
  })
  const asked = (route: string) => fake.paths().filter((path) => path === `/api/v1/${route}`).length
  return { store, fake, asked, ...padding, run: () => padding.loadPadding(store.currentPeople()) }
}

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('checking a class for padding', () => {
  it('says of each commit whether it was real, tiny, only whitespace, empty, or cannot be told', async () => {
    const commits = [commit('real'), commit('small'), commit('blank'), commit('nothing'), commit('picture')]
    const { run, asked, checksOf } = await open(['github.com/a/x'], {
      repos: { 'a/x': okRepo('a/x') },
      commits: { 'a/x': commits },
      files: {
        [oid('real')]: filesOf([file(true, 40)]),
        [oid('small')]: filesOf([file(true, 1)]),
        [oid('blank')]: filesOf([file(false, 3)]),
        [oid('nothing')]: filesOf([]),
        [oid('picture')]: filesOf([file(undefined, 0)]),
      },
    })
    await run()
    expect(checksOf('a/x')).toEqual(
      new Map([
        [oid('real'), { kind: 'real', tiny: false }],
        [oid('small'), { kind: 'real', tiny: true }],
        [oid('blank'), { kind: 'whitespace', tiny: false }],
        [oid('nothing'), { kind: 'empty', tiny: false }],
        [oid('picture'), { kind: 'unknown', tiny: false }],
      ]),
    )
    expect([asked('commits'), asked('commit')]).toEqual([1, 5])
  })

  it('reports the lists first, then the files, and asks nothing for a second run', async () => {
    const { store, loadPadding, asked } = await open(['github.com/a/x', 'github.com/a/y', 'see my email'], {
      repos: { 'a/x': okRepo('a/x'), 'a/y': okRepo('a/y') },
      commits: { 'a/x': [commit('x1'), commit('x2')], 'a/y': [commit('y1')] },
      files: {
        [oid('x1')]: filesOf([file(true)]),
        [oid('x2')]: filesOf([file(true)]),
        [oid('y1')]: filesOf([file(false)]),
      },
    })
    const progress: Array<[string, number, number]> = []
    await loadPadding(store.currentPeople(), ({ phase, done, total }) => progress.push([phase, done, total]))
    expect(progress.slice(0, 4)).toEqual([['lists', 0, 2], ['lists', 1, 2], ['lists', 2, 2], ['files', 0, 3]])
    expect(progress.slice(4).map(([, done]) => done).sort()).toEqual([1, 2, 3])
    expect(progress.at(-1)).toEqual(['files', 3, 3])
    expect([asked('commits'), asked('commit')]).toEqual([2, 3])

    await loadPadding(store.currentPeople())
    expect([asked('commits'), asked('commit')]).toEqual([2, 3])
  })

  it('asks nothing for a repo without work, one that was not found, or one handed in twice', async () => {
    const { run, asked, checksOf, NO_CHECKS } = await open(
      ['github.com/a/empty', 'github.com/a/missing', 'github.com/a/x', 'github.com/A/X'],
      {
        repos: { 'a/empty': okRepo('a/empty', { isEmpty: true, headOid: null, defaultBranch: null }), 'a/x': okRepo('a/x') },
        commits: { 'a/x': [commit('only')] },
        files: { [oid('only')]: filesOf([file(true)]) },
      },
    )
    await run()
    expect([asked('commits'), asked('commit')]).toEqual([1, 1])
    expect(checksOf('a/empty')).toBe(NO_CHECKS)
    expect(checksOf(null)).toBe(NO_CHECKS)
  })

  it('checks the newest 200 commits of a long history', async () => {
    const commits = Array.from({ length: 201 }, (_, i) => commit(`c${i}`))
    const files = Object.fromEntries(commits.map((item) => [item.oid, filesOf([file(true)])]))
    const { run, asked, checksOf, MAX_CHECKED_COMMITS } = await open(['github.com/a/long'], {
      repos: { 'a/long': okRepo('a/long') },
      commits: { 'a/long': commits },
      files,
    })
    await run()
    expect(MAX_CHECKED_COMMITS).toBe(200)
    expect(asked('commit')).toBe(200)
    expect(checksOf('a/long').size).toBe(200)
    expect(checksOf('a/long').has(oid('c200'))).toBe(false)
  })

  it('reads further pages only while everything so far was whitespace, and three at most', async () => {
    const { run, fake, checksOf } = await open(['github.com/a/x'], {
      repos: { 'a/x': okRepo('a/x') },
      commits: { 'a/x': [commit('settled'), commit('endless'), commit('picture')] },
      files: {
        [oid('settled')]: filesOf([file(false)], { more: true }),
        [`${oid('settled')}#2`]: filesOf([file(true)]),
        [oid('endless')]: filesOf([file(false)], { more: true }),
        [`${oid('endless')}#2`]: filesOf([file(false)], { more: true }),
        [`${oid('endless')}#3`]: filesOf([file(false)], { more: true }),
        [`${oid('endless')}#4`]: filesOf([file(false)]),
        [oid('picture')]: filesOf([file(undefined)], { more: true }),
      },
    })
    await run()
    expect(checksOf('a/x').get(oid('settled'))).toEqual({ kind: 'real', tiny: false })
    expect(checksOf('a/x').get(oid('endless'))).toEqual({ kind: 'unknown', tiny: false })
    expect(checksOf('a/x').get(oid('picture'))).toEqual({ kind: 'unknown', tiny: false })
    const pages = fake.fetch.mock.calls
      .map(([input]) => new URL(String(input), 'http://localhost'))
      .filter((url) => url.pathname === '/api/v1/commit')
      .map((url) => `${url.searchParams.get('sha') === oid('settled') ? 's' : url.searchParams.get('sha') === oid('endless') ? 'e' : 'p'}${url.searchParams.get('page') ?? 1}`)
      .sort()
    expect(pages).toEqual(['e1', 'e2', 'e3', 'p1', 's1', 's2'])
  })

  it('forgets a commit it could not read, so that the next run asks again', async () => {
    const { run, fake, asked, checksOf } = await open(['github.com/a/x'], {
      repos: { 'a/x': okRepo('a/x') },
      commits: { 'a/x': [commit('gone'), commit('fine')] },
      files: { [oid('fine')]: filesOf([file(true)]) },
    })
    await run()
    expect(checksOf('a/x').has(oid('gone'))).toBe(false)
    expect(checksOf('a/x').get(oid('fine'))).toEqual({ kind: 'real', tiny: false })
    expect(asked('commit')).toBe(2)

    fake.api.files[oid('gone')] = filesOf([file(false)])
    await run()
    expect(checksOf('a/x').get(oid('gone'))).toEqual({ kind: 'whitespace', tiny: false })
    expect(asked('commit')).toBe(3)
  })

  it('ends the run when the hourly GitHub limit is used up, keeping what it read', async () => {
    const commits = Array.from({ length: 8 }, (_, i) => commit(`c${i}`))
    const files: FakeApi['files'] = Object.fromEntries(commits.map((item) => [item.oid, filesOf([file(true)])]))
    files[oid('c0')] = failure(503, 'quota_reserved', 'The shared GitHub limit is used up for this hour.')
    const { run, checksOf } = await open(['github.com/a/x'], {
      repos: { 'a/x': okRepo('a/x') },
      commits: { 'a/x': commits },
      files,
    })
    await run()
    // Six requests were on their way; the two still waiting were given up.
    expect(checksOf('a/x').has(oid('c0'))).toBe(false)
    expect(checksOf('a/x').size).toBeGreaterThanOrEqual(5)
    expect(checksOf('a/x').size).toBeLessThan(8)
  })

  it('wakes a subscriber with a new map once something was found', async () => {
    const { checkCommit, checksOf, subscribe, NO_CHECKS } = await open(['github.com/a/x'], {
      repos: { 'a/x': okRepo('a/x') },
      commits: { 'a/x': [commit('one'), commit('two')] },
      files: { [oid('one')]: filesOf([file(true)]), [oid('two')]: filesOf([file(false)]) },
    })
    const before = checksOf('a/x')
    expect(before).toBe(NO_CHECKS)
    const woken = vi.fn()
    const stop = subscribe(woken)

    await Promise.all([checkCommit('a/x', oid('one')), checkCommit('a/x', oid('two'))])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(woken).toHaveBeenCalled()
    const after = checksOf('a/x')
    expect(after).not.toBe(before)
    expect(after.size).toBe(2)
    // Nothing new: the same map again.
    expect(checksOf('a/x')).toBe(after)
    expect(await checkCommit('a/x', oid('one'))).toEqual({ kind: 'real', tiny: false })
    expect(checksOf('a/x')).toBe(after)

    stop()
  })

  it('gives the download the counts once a check ran', async () => {
    const { store, run, asked } = await open(['github.com/a/x'], {
      repos: { 'a/x': okRepo('a/x') },
      commits: { 'a/x': [commit('real', 'rahim'), commit('blank', 'rahim'), commit('theirs', 'nusrat')] },
      files: {
        [oid('real')]: filesOf([file(true, 1)]),
        [oid('blank')]: filesOf([file(false)]),
        [oid('theirs')]: filesOf([file(true, 30)]),
      },
    })
    const { loadCommitShares } = await import('./commitShares.ts')
    expect((await loadCommitShares(store.currentPeople())).get('a/x')).toMatchObject({
      authors: [{ who: 'rahim', commits: 2 }, { who: 'nusrat', commits: 1 }],
    })
    expect(((await loadCommitShares(store.currentPeople())).get('a/x') as { authors: unknown[] }).authors[0]).not.toHaveProperty('checked')

    await run()
    expect((await loadCommitShares(store.currentPeople())).get('a/x')).toMatchObject({
      authors: [
        { who: 'rahim', checked: { real: 1, tiny: 1, whitespace: 1, empty: 0, unknown: 0 } },
        { who: 'nusrat', checked: { real: 1, tiny: 0, whitespace: 0, empty: 0, unknown: 0 } },
      ],
    })
    expect(asked('commits')).toBe(1)
  })
})
