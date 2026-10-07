// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityEvent, CommitInfo } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import { parseDeadlineInput } from '../logic/time.ts'
import { failure, FETCHED_AT, okRepo, oid, saveSheet, stubApi, type FakeApi } from '../test/fakeApi.ts'

const CREATED = '2026-09-02T09:00:00Z'
const LATER = '2026-09-20T12:00:00Z'

const event = (ts: string, after: string, before: string = ZERO_OID): ActivityEvent => ({
  ts,
  type: before === ZERO_OID ? 'branch_creation' : 'push',
  ref: 'refs/heads/main',
  before,
  after,
  actor: 'student',
})

/** A branch as GitHub logs it: created by its first push, then pushed once more. Newest first. */
const log = (key: string): ActivityEvent[] => [event(LATER, oid(key), oid('first')), event(CREATED, oid('first'))]

const commit = (seed: string, committedAt: string): CommitInfo => ({
  oid: oid(seed),
  committedAt,
  authoredAt: committedAt,
  headline: seed,
  parents: [],
  authorName: 'Student',
  authorLogin: 'student',
})

type Options = {
  deadlineInput?: string
  /** Push logs that GitHub answers page by page, newest page first. */
  pages?: Record<string, ActivityEvent[][]>
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
    const pages = options.pages?.[url.searchParams.get('repo') ?? '']
    if (url.pathname !== '/api/v1/activity' || !pages || url.searchParams.has('dir')) return answer(input)
    const index = Number(url.searchParams.get('after')?.replace('page-', '') ?? 0)
    return new Response(
      JSON.stringify({
        fetchedAt: FETCHED_AT,
        settled: true,
        events: pages[index],
        next: index + 1 < pages.length ? `page-${index + 1}` : null,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })

  vi.resetModules()
  const store = await import('./store.ts')
  const { loadFirstPushes } = await import('./firstPushes.ts')
  store.start()
  await vi.waitFor(() => {
    expect(store.getState().checkedAt).not.toBeNull()
    expect(store.getState().loadingRepos).toBe(0)
    // With a deadline, the register first reads the push logs it needs itself.
    expect(store.currentPeople().every((person) => person.verdict.need === null)).toBe(true)
    expect(store.currentPeople().some((person) => person.verdict.status === 'checking')).toBe(false)
  })
  const asked = (route: string) => fake.paths().filter((path) => path === `/api/v1/${route}`).length
  const statuses = () => store.currentPeople().map((person) => person.verdict.status)
  return { store, fake, asked, statuses, read: () => loadFirstPushes(store.currentPeople()) }
}

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('the first pushes for the download', () => {
  it('reads the push log the register had no need for, and names the push that created the branch', async () => {
    const { read, asked } = await open(['github.com/a/x'], {
      repos: { 'a/x': okRepo('a/x') },
      activity: { 'a/x': log('a/x') },
    })
    expect(asked('activity')).toBe(0)

    expect(await read()).toEqual(new Map([['a/x', { kind: 'recorded', at: CREATED }]]))
    expect(asked('activity')).toBe(1)
    // The log told. The commits are not needed.
    expect(asked('commits')).toBe(0)
  })

  it('gives the date of the oldest commit when GitHub has no push log for the repo', async () => {
    const { read } = await open(['github.com/a/old'], {
      repos: { 'a/old': okRepo('a/old') },
      commits: { 'a/old': [commit('newest', '2022-06-01T10:00:00Z'), commit('oldest', '2021-03-04T05:00:00Z')] },
    })
    expect((await read()).get('a/old')).toEqual({ kind: 'commit_date', at: '2021-03-04T05:00:00Z' })
  })

  it('gives the commit date too when the log begins after the branch already had commits', async () => {
    const { read } = await open(['github.com/a/older'], {
      repos: { 'a/older': okRepo('a/older') },
      // The oldest push GitHub kept moved the branch on; it did not create it.
      activity: { 'a/older': [event(LATER, oid('a/older'), oid('before the log'))] },
      commits: { 'a/older': [commit('oldest', '2022-11-11T11:00:00Z')] },
    })
    expect((await read()).get('a/older')).toEqual({ kind: 'commit_date', at: '2022-11-11T11:00:00Z' })
  })

  it('takes the first push a fork got from its owner', async () => {
    const { read, asked } = await open(['github.com/a/fork'], {
      repos: { 'a/fork': okRepo('a/fork', { isFork: true }) },
      activity: { 'a/fork': [event(LATER, oid('a/fork'), oid('theirs'))] },
    })
    expect((await read()).get('a/fork')).toEqual({ kind: 'recorded', at: LATER })
    expect(asked('commits')).toBe(0)
  })

  it('does not guess for a fork without a log, whose oldest commits were written for another repo', async () => {
    const { read, asked } = await open(['github.com/a/fork'], {
      repos: { 'a/fork': okRepo('a/fork', { isFork: true }) },
      commits: { 'a/fork': [commit('theirs', '2019-01-01T00:00:00Z')] },
    })
    expect((await read()).get('a/fork')).toEqual({ kind: 'unknown' })
    expect(asked('commits')).toBe(0)
  })

  it('says so when the log or the commits cannot be read', async () => {
    const { read } = await open(['github.com/a/nolog', 'github.com/a/nocommits', 'github.com/a/nothing'], {
      repos: { 'a/nolog': okRepo('a/nolog'), 'a/nocommits': okRepo('a/nocommits'), 'a/nothing': okRepo('a/nothing') },
      activity: { 'a/nolog': failure(404, 'not_found', 'Not found.') },
      commits: { 'a/nocommits': failure(404, 'not_found', 'Not found.'), 'a/nothing': [] },
    })
    const firsts = await read()
    expect(firsts.get('a/nolog')).toEqual({ kind: 'failed' })
    expect(firsts.get('a/nocommits')).toEqual({ kind: 'unknown' })
    expect(firsts.get('a/nothing')).toEqual({ kind: 'unknown' })
  })

  it('has no first push, and asks nothing, for a repo without work or one that was not found', async () => {
    const { read, asked } = await open(['github.com/a/empty', 'github.com/a/missing', 'not a link'], {
      repos: { 'a/empty': okRepo('a/empty', { isEmpty: true, headOid: null, defaultBranch: null }) },
    })
    // A cell that is no link stands for no repo at all.
    expect(await read()).toEqual(new Map([['a/empty', { kind: 'none' }], ['a/missing', { kind: 'none' }]]))
    expect(asked('activity') + asked('commits')).toBe(0)
  })

  it('asks once for a repo handed in twice, and nothing for a second download', async () => {
    const { read, asked } = await open(['github.com/a/x', 'github.com/A/X', 'github.com/a/old'], {
      repos: { 'a/x': okRepo('a/x'), 'a/old': okRepo('a/old') },
      activity: { 'a/x': log('a/x') },
      commits: { 'a/old': [commit('only', '2021-03-04T05:00:00Z')] },
    })
    const first = await read()
    expect([...first.keys()].sort()).toEqual(['a/old', 'a/x'])
    expect([asked('activity'), asked('commits')]).toEqual([2, 1])

    expect(await read()).toEqual(first)
    expect([asked('activity'), asked('commits')]).toEqual([2, 1])
  })

  it('still names the first push when a refresh drops the log while it is being read', async () => {
    const { read, asked, store, fake } = await open(['github.com/a/x'], {
      repos: { 'a/x': okRepo('a/x') },
      activity: { 'a/x': log('a/x') },
    })
    // The first answer about the log is held back until the refresh has happened.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let logs = 0
    const answer = fake.fetch.getMockImplementation() as typeof fetch
    fake.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v1/activity') && ++logs === 1) await held
      return answer(input)
    })

    const reading = read()
    await vi.waitFor(() => expect(asked('activity')).toBe(1))
    store.refresh()
    release()

    expect((await reading).get('a/x')).toEqual({ kind: 'recorded', at: CREATED })
    expect(asked('activity')).toBe(2)
  })

  it('reports how many repos are done', async () => {
    const { store } = await open(['github.com/a/x', 'github.com/a/y', 'see my email'], {
      repos: { 'a/x': okRepo('a/x'), 'a/y': okRepo('a/y') },
      activity: { 'a/x': log('a/x'), 'a/y': log('a/y') },
    })
    const { loadFirstPushes } = await import('./firstPushes.ts')
    const progress: Array<[number, number]> = []
    await loadFirstPushes(store.currentPeople(), (done, total) => progress.push([done, total]))
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]])
  })

  it('has nothing to read, and still answers, for nobody at all', async () => {
    const { store, asked } = await open(['see my email', 'github.com/a/x'], { repos: { 'a/x': okRepo('a/x') } })
    const { loadFirstPushes } = await import('./firstPushes.ts')
    const progress: Array<[number, number]> = []
    expect(await loadFirstPushes([], (done, total) => progress.push([done, total]))).toEqual(new Map())
    // Only the person whose cell holds no link.
    expect(await loadFirstPushes(store.currentPeople().slice(0, 1))).toEqual(new Map())
    expect(progress).toEqual([[0, 0]])
    expect(asked('activity') + asked('commits')).toBe(0)
  })
})

describe('a push log of more than one page', () => {
  const page = (n: number) => [event(`2026-09-${String(20 - n).padStart(2, '0')}T12:00:00Z`, oid(`p${n}`), oid(`p${n + 1}`))]

  it('is read on to its end, where the first push is', async () => {
    const { read, asked } = await open(
      ['github.com/a/busy'],
      { repos: { 'a/busy': okRepo('a/busy') } },
      { pages: { 'a/busy': [page(0), [event(CREATED, oid('p1'))]] } },
    )
    expect((await read()).get('a/busy')).toEqual({ kind: 'recorded', at: CREATED })
    expect(asked('activity')).toBe(2)
  })

  it('is read no further than the person screen reads it, and then the oldest commit stands in', async () => {
    const { read, asked, store } = await open(
      ['github.com/a/verybusy'],
      {
        repos: { 'a/verybusy': okRepo('a/verybusy') },
        commits: { 'a/verybusy': [commit('oldest', '2026-09-01T10:00:00Z')] },
      },
      { pages: { 'a/verybusy': [page(0), page(1), page(2), page(3), [event(CREATED, oid('p4'))]] } },
    )
    expect((await read()).get('a/verybusy')).toEqual({ kind: 'commit_date', at: '2026-09-01T10:00:00Z' })
    expect(asked('activity')).toBe(store.HISTORY_PAGES)
    expect(store.getState().activity.get('a/verybusy')).toMatchObject({ exhausted: false, failed: false })
  })
})

describe('the first pushes with a deadline', () => {
  const INPUT = '2026-10-02T23:59'
  const DEADLINE = (parseDeadlineInput(INPUT) as { ms: number }).ms
  /** An instant whole minutes after the deadline (or before, when negative). */
  const at = (minutes: number) => new Date(DEADLINE + 1 + minutes * 60_000).toISOString()

  const links = ['github.com/a/early', 'github.com/b/changed', 'github.com/c/late']
  const data = (): Partial<FakeApi> => ({
    repos: {
      'a/early': okRepo('a/early', { pushedAt: at(-600) }),
      'b/changed': okRepo('b/changed', { pushedAt: at(540) }),
      'c/late': okRepo('c/late', { createdAt: at(120), pushedAt: at(199) }),
    },
    activity: {
      'a/early': [event(at(-600), oid('a/early'), oid('a1')), event(at(-3000), oid('a1'))],
      'b/changed': [event(at(540), oid('b/changed'), oid('b1')), event(at(-1440), oid('b1'))],
      'c/late': [event(at(199), oid('c/late'))],
    },
  })

  it('reads only the logs the register did not read, and changes nobody\'s status', async () => {
    const { read, asked, statuses } = await open(links, data(), { deadlineInput: INPUT })
    expect(statuses()).toEqual(['on_time', 'changed_after', 'late'])
    // The register read the logs of the two repos pushed after the deadline.
    expect(asked('activity')).toBe(2)

    const firsts = await read()
    expect(firsts).toEqual(
      new Map([
        ['a/early', { kind: 'recorded', at: at(-3000) }],
        ['b/changed', { kind: 'recorded', at: at(-1440) }],
        ['c/late', { kind: 'recorded', at: at(199) }],
      ]),
    )
    expect(asked('activity')).toBe(3)
    expect(asked('commits')).toBe(0)
    expect(statuses()).toEqual(['on_time', 'changed_after', 'late'])
  })

  it('names the same first push for a late row as its verdict does', async () => {
    const { read, store } = await open(links, data(), { deadlineInput: INPUT })
    const late = store.currentPeople()[2]
    expect(late.verdict.firstPushAt).toBe(at(199))
    expect((await read()).get('c/late')).toEqual({ kind: 'recorded', at: late.verdict.firstPushAt })
  })

  it('leaves an on-time row on time when its log cannot be read', async () => {
    const broken = data()
    ;(broken.activity as FakeApi['activity'])['a/early'] = failure(404, 'repo_not_found', 'This repo was not found.')
    const { read, statuses } = await open(links, broken, { deadlineInput: INPUT })

    expect((await read()).get('a/early')).toEqual({ kind: 'failed' })
    expect(statuses()).toEqual(['on_time', 'changed_after', 'late'])
  })

  it('gives up at once, without changing a status, when the hourly GitHub limit is used up', async () => {
    const { read, statuses, fake, asked } = await open(links, data(), { deadlineInput: INPUT })
    fake.api.activity['a/early'] = failure(503, 'quota_reserved', 'The shared GitHub limit is used up for this hour.')

    const firsts = await read()
    expect(firsts.get('a/early')).toEqual({ kind: 'failed' })
    // What was already read stays.
    expect(firsts.get('b/changed')).toEqual({ kind: 'recorded', at: at(-1440) })
    expect(firsts.get('c/late')).toEqual({ kind: 'recorded', at: at(199) })
    expect(asked('activity')).toBe(3)
    expect(statuses()).toEqual(['on_time', 'changed_after', 'late'])
  })
})
