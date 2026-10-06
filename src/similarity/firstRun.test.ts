import { describe, expect, it, vi } from 'vitest'
import type { ActivityResponse, TreeResponse } from '../../shared/api.ts'
import { ApiError } from '../api/client.ts'
import { at, repo, type Files, type Repo } from '../test/stories.ts'
import { analyse, sharedSets } from './compare.ts'
import { pairKey, type Commits } from './first.ts'
import { createFirstRunner, type FirstInput, type FirstProgress, type FirstStates } from './firstRun.ts'
import { createHistoryLoader } from './history.ts'
import type { Get } from './trees.ts'

const README = (who: string): Files => ({ 'README.md': `readme of ${who}` })
/** Three files: enough to be more than "a small file or two". */
const WORK: Files = { 'src/app.js': 'the app', 'src/util.js': 'the helpers', 'src/view.js': 'the view' }

/** A repo that got its README on the 2nd and the work on `day`. */
const student = (name: string, day: string, extra: Files = {}) =>
  repo(name, [
    { at: '02 09:00', files: README(name) },
    { at: `${day} 10:00`, files: { ...README(name), ...WORK, ...extra } },
  ])

/** A fake Worker made of repo stories, the real history loader on top of it, and the comparison's own pairs. */
function world(repos: Repo[], limits: { auto?: number; open?: number } = {}) {
  const byName = new Map(repos.map((entry) => [entry.facts.repo, entry]))
  const asked: string[] = []
  const urls: string[] = []
  const get = (async (url: string) => {
    urls.push(url)
    const address = new URL(url, 'http://localhost')
    const entry = byName.get(address.searchParams.get('repo') ?? '')
    asked.push(`${address.pathname.replace('/api/v1/', '')} ${entry?.facts.repo ?? '?'}`)
    if (!entry) throw new ApiError(404, 'repo_not_found', 'This repo was not found.')
    if (address.pathname === '/api/v1/activity') {
      const page: ActivityResponse = { fetchedAt: '', settled: true, events: entry.events, next: null }
      return page
    }
    const files = entry.snapshots.get(address.searchParams.get('sha') ?? '')
    if (!files) throw new ApiError(404, 'repo_or_sha_not_found', 'Repo or commit not found.')
    const listing: TreeResponse = { files, dirs: [], tooLarge: false }
    return listing
  }) as Get

  const trees = new Map(repos.map((entry) => [entry.facts.repo, entry.head]))
  const analysis = analyse([...trees.values()])
  const input: FirstInput = {
    pairs: analysis.pairs,
    trees,
    facts: new Map(repos.map((entry) => [entry.facts.repo, entry.facts])),
    starter: sharedSets(analysis).starter,
  }
  const commits = vi.fn(async (name: string): Promise<Commits> => {
    const entry = byName.get(name)
    if (!entry) throw new Error('no such repo')
    return entry.commits
  })
  const runner = createFirstRunner({ history: createHistoryLoader(get), commits }, limits)

  let states: FirstStates = new Map()
  let progress: FirstProgress = { done: 0, total: 0 }
  const seen: string[] = []
  const start = () =>
    runner.start(input, (next, nextProgress) => {
      states = next
      progress = nextProgress
      seen.push([...next].map(([key, value]) => `${key}=${value.state}`).join(' '))
    })
  const state = (a: string, b: string) => states.get(pairKey(a, b)) ?? states.get(pairKey(b, a))
  const verdict = (a: string, b: string) => {
    const found = state(a, b)
    return found?.state === 'ready' ? `${found.evidence.verdict}${found.evidence.reason ? `/${found.evidence.reason}` : ''}` : found?.state
  }
  /** Waits until nothing is being checked any more. */
  const settled = () =>
    vi.waitFor(() => {
      expect([...states.values()].some((value) => value.state === 'checking')).toBe(false)
      expect(progress.done).toBe(progress.total)
    })
  return { input, analysis, commits, asked, urls, start, state, verdict, settled, seen, progress: () => progress, states: () => states }
}

describe('which pairs are checked', () => {
  it('checks a strong pair by itself and says who had the files first', async () => {
    const w = world([student('a/app', '12'), student('b/app', '14')])
    expect(w.analysis.pairs.map((pair) => pair.tier)).toEqual(['most'])
    w.start()
    expect(w.state('a/app', 'b/app')).toEqual({ state: 'checking' })
    await w.settled()
    const found = w.state('a/app', 'b/app')
    expect(found).toMatchObject({ state: 'ready', evidence: { verdict: 'a_first', basis: 'push_times', shared: 3 } })
    expect(w.progress()).toEqual({ done: 2, total: 2 })
    expect(w.commits).toHaveBeenCalledTimes(2)
  })

  it('leaves a weak pair alone until its row is opened', async () => {
    const one: Files = { 'notes.md': 'the same note' }
    const a = repo('a/app', [{ at: '05 09:00', files: { ...README('a'), ...one, 'a1.js': 'a1', 'a2.js': 'a2' } }])
    const b = repo('b/app', [{ at: '09 09:00', files: { ...README('b'), ...one, 'b1.js': 'b1', 'b2.js': 'b2' } }])
    const w = world([a, b])
    expect(w.analysis.pairs.map((pair) => pair.tier)).toEqual(['thin'])
    const run = w.start()
    await w.settled()
    expect(w.state('a/app', 'b/app')).toEqual({ state: 'waiting' })
    expect(w.asked).toEqual([])

    run.open(pairKey('a/app', 'b/app'))
    expect(w.state('a/app', 'b/app')).toEqual({ state: 'checking' })
    await w.settled()
    expect(w.verdict('a/app', 'b/app')).toBe('a_first')
    // Opening it again asks for nothing.
    const before = w.asked.length
    run.open(pairKey('a/app', 'b/app'))
    expect(w.asked).toHaveLength(before)
  })

  it('settles a fork at once, without a single request', async () => {
    const a = student('a/app', '12')
    const fork = repo('b/app', [{ at: '14 10:00', files: { ...README('a/app'), ...WORK } }], { isFork: true, parent: 'a/app' })
    const w = world([a, fork])
    w.start()
    expect(w.state('a/app', 'b/app')).toMatchObject({ state: 'ready', evidence: { verdict: 'a_first', basis: 'fork' } })
    await w.settled()
    expect(w.asked).toEqual([])
    expect(w.commits).not.toHaveBeenCalled()
  })

  it('ignores an unknown pair', async () => {
    const w = world([student('a/app', '12'), student('b/app', '14')])
    const run = w.start()
    await w.settled()
    const before = w.asked.length
    run.open('no/such|pair/here')
    expect(w.asked).toHaveLength(before)
  })
})

describe('what is read', () => {
  it('reads a repo once, however many pairs it is in', async () => {
    const w = world([student('a/app', '12'), student('b/app', '14'), student('c/app', '16')])
    expect(w.analysis.pairs).toHaveLength(3)
    w.start()
    await w.settled()
    // One push log and two file lists per repo.
    expect(w.asked.filter((line) => line.startsWith('activity'))).toHaveLength(3)
    expect(w.asked.filter((line) => line.startsWith('tree'))).toHaveLength(6)
    expect(w.urls).toHaveLength(new Set(w.urls).size)
    expect(w.commits).toHaveBeenCalledTimes(3)
  })

  it('does not rank two repos against each other when a third had the files before both', async () => {
    const w = world([student('a/app', '12'), student('b/app', '14'), student('c/app', '16')])
    w.start()
    await w.settled()
    expect(w.verdict('a/app', 'b/app')).toBe('a_first')
    expect(w.verdict('a/app', 'c/app')).toBe('a_first')
    expect(w.verdict('b/app', 'c/app')).toBe('unknown/third_repo')
    const pair = w.state('b/app', 'c/app')
    expect(pair?.state === 'ready' && pair.evidence).toMatchObject({ elsewhere: 3, otherRepos: 1 })
  })

  it('reads a third repo that holds the files of an opened pair', async () => {
    const one: Files = { 'notes.md': 'the same note' }
    const own = (who: string): Files => ({ ...README(who), [`${who}1.js`]: `${who}1`, [`${who}2.js`]: `${who}2` })
    const w = world([
      repo('a/app', [{ at: '05 09:00', files: { ...own('a'), ...one } }]),
      repo('b/app', [{ at: '09 09:00', files: { ...own('b'), ...one } }]),
      // C had the note before either of them.
      repo('c/app', [{ at: '03 09:00', files: { ...own('c'), ...one } }]),
    ])
    const run = w.start()
    await w.settled()
    run.open(pairKey('a/app', 'b/app'))
    await w.settled()
    expect(w.asked.some((line) => line === 'tree c/app')).toBe(true)
    expect(w.verdict('a/app', 'b/app')).toBe('unknown/third_repo')
    // C is read for its files only: it is not one of the pair.
    expect(w.commits.mock.calls.map(([name]) => name).toSorted()).toEqual(['a/app', 'b/app'])
  })

  it('asks for nothing again when the same comparison is started once more', async () => {
    const w = world([student('a/app', '12'), student('b/app', '14')])
    w.start()
    await w.settled()
    const before = w.asked.length
    w.start()
    await w.settled()
    expect(w.asked).toHaveLength(before)
    expect(w.verdict('a/app', 'b/app')).toBe('a_first')
  })

  it('names nobody when a commit list cannot be read', async () => {
    const w = world([student('a/app', '12'), student('b/app', '14')])
    w.commits.mockRejectedValueOnce(new Error('offline'))
    w.start()
    await w.settled()
    expect(w.verdict('a/app', 'b/app')).toBe('unknown/commits_unread')
  })
})

describe('the budget', () => {
  it('says nothing about a pair it could not finish reading, until the row is opened', async () => {
    const w = world([student('a/app', '12'), student('b/app', '14')], { auto: 3, open: 10 })
    const run = w.start()
    await w.settled()
    // Four file lists are needed and three were allowed.
    expect(w.asked.filter((line) => line.startsWith('tree'))).toHaveLength(3)
    expect(w.state('a/app', 'b/app')).toEqual({ state: 'waiting' })

    run.open(pairKey('a/app', 'b/app'))
    await w.settled()
    expect(w.asked.filter((line) => line.startsWith('tree'))).toHaveLength(4)
    expect(w.verdict('a/app', 'b/app')).toBe('a_first')
  })

  it('stops reading and reporting once the run is stopped', async () => {
    const w = world([student('a/app', '12'), student('b/app', '14')])
    const run = w.start()
    const reports = w.seen.length
    run.stop()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(w.seen).toHaveLength(reports)
    expect(w.asked.filter((line) => line.startsWith('tree'))).toEqual([])
    run.open(pairKey('a/app', 'b/app'))
    expect(w.seen).toHaveLength(reports)
  })
})

describe('the dates the runner works from', () => {
  it('uses the push times, not the order of the sheet', async () => {
    const w = world([student('a/app', '14'), student('b/app', '12')])
    w.start()
    await w.settled()
    const found = w.state('a/app', 'b/app')
    expect(found?.state === 'ready' && found.evidence).toMatchObject({ verdict: 'b_first', gapMs: at('14 10:00') - at('12 10:00') })
  })
})
