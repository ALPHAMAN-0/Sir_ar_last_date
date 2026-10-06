import { describe, expect, it } from 'vitest'
import {
  activityUrl,
  treeUrl,
  type ActivityEvent,
  type ActivityResponse,
  type TreeFile,
  type TreeResponse,
} from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import { ApiError } from '../api/client.ts'
import { createHistoryLoader, type Allowance } from './history.ts'
import { noSkips } from './rules.ts'
import type { RepoFacts } from './run.ts'
import type { Get } from './trees.ts'
import type { RepoFiles } from './types.ts'

const REPO = 'a/app'
const VERSION = '2026-09-30T08:00:00Z'

/** A 40-character id made from a label, the same for the same label. */
function id(label: string): string {
  let hash = 7
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash.toString(16).padStart(8, '0').repeat(5)
}

const facts: RepoFacts = {
  repo: REPO,
  nameWithOwner: REPO,
  owner: 'a',
  branch: 'main',
  headOid: id('head'),
  createdAt: Date.parse('2026-09-01T08:00:00Z'),
  pushedAt: Date.parse(VERSION),
  version: VERSION,
  isFork: false,
  parent: null,
  template: null,
  totalCommits: 4,
}

type Files = Record<string, string>
const tree = (files: Files): TreeFile[] =>
  Object.entries(files).map(([path, content]) => ({ path, sha: id(content), size: 500 }))
const listing = (files: Files): TreeResponse => ({ files: tree(files), dirs: [], tooLarge: false })
const TOO_LARGE: TreeResponse = { files: [], dirs: [], tooLarge: true }

const HEAD_FILES: Files = { 'README.md': 'readme', 'src/app.js': 'the app', 'src/util.js': 'the helpers' }
const head: RepoFiles = { repo: REPO, branch: 'main', headOid: id('head'), files: tree(HEAD_FILES), skipped: noSkips(), unopened: 0 }
const need = (...contents: string[]) => new Set(contents.map(id))

/** Push `n` of the main branch, one day after the one before. */
function push(n: number, over: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    ts: `2026-09-${String(n + 1).padStart(2, '0')}T09:00:00Z`,
    type: n === 1 ? 'branch_creation' : 'push',
    ref: 'refs/heads/main',
    before: n === 1 ? ZERO_OID : id(`c${n - 1}`),
    after: id(`c${n}`),
    actor: 'a',
    ...over,
  }
}
const page = (events: ActivityEvent[], next: string | null = null, settled = true): ActivityResponse => ({
  fetchedAt: '2026-10-06T04:00:00Z',
  settled,
  events,
  next,
})

const LOG = activityUrl({ repo: REPO, v: VERSION, asc: true })
const at = (n: number) => treeUrl({ repo: REPO, sha: id(`c${n}`) })
const limited = new ApiError(429, 'rate_limited', 'Too many requests. Please wait a moment.', { retryAfter: 30 })
const gone = new ApiError(404, 'repo_or_sha_not_found', 'Repo or commit not found.')
const broken = new ApiError(502, 'github_error', 'GitHub answered with status 502.')

type Answer = ActivityResponse | TreeResponse | Error
/** A fake request queue: answers come from a map of URL to answer, or to a list of answers in turn. */
function queue(answers: Record<string, Answer | Answer[]>) {
  const calls: Array<{ url: string; priority: number | undefined }> = []
  const get = (async (url: string, priority?: number) => {
    calls.push({ url, priority })
    const answer = answers[url]
    const next = Array.isArray(answer) ? (answer.length > 1 ? answer.shift() : answer[0]) : answer
    if (next === undefined) throw gone
    if (next instanceof Error) throw next
    return next
  }) as Get
  return { get, calls, asked: () => calls.map((call) => call.url) }
}

const free: Allowance = { take: () => true }
const budget = (count: number): Allowance => ({ take: () => count-- > 0 })

/** Three pushes: a README, then the app, then the helpers. */
const story = (): Record<string, Answer | Answer[]> => ({
  [LOG]: page([push(1), push(2), push(3)]),
  [at(1)]: listing({ 'README.md': 'readme' }),
  [at(2)]: listing({ 'README.md': 'readme', 'src/app.js': 'the app' }),
  [at(3)]: listing(HEAD_FILES),
})

describe('the push log', () => {
  it('is asked for oldest first, all branches, spelled like the register\'s own request', async () => {
    const { get, calls } = queue(story())
    const history = await createHistoryLoader(get).ensure(facts, head, need(), free)
    expect(calls).toEqual([{ url: LOG, priority: 3 }])
    expect(LOG).toBe('/api/v1/activity?repo=a%2Fapp&v=2026-09-30T08%3A00%3A00Z&dir=asc')
    expect(history).toMatchObject({ repo: REPO, headOid: id('head'), log: 'ok', logComplete: true, startKnown: true, trusted: 3 })
    expect(history.pushes.map((entry) => entry.after)).toEqual([id('c1'), id('c2'), id('c3')])
  })

  it('is read page by page, up to the limit', async () => {
    const second = activityUrl({ repo: REPO, v: VERSION, asc: true, after: 'cursor1' })
    const third = activityUrl({ repo: REPO, v: VERSION, asc: true, after: 'cursor2' })
    const { get, asked } = queue({
      [LOG]: page([push(1)], 'cursor1'),
      [second]: page([push(2)], 'cursor2'),
      [third]: page([push(3)]),
    })
    const history = await createHistoryLoader(get).ensure(facts, head, need(), free)
    // Two pages are read; the third is left alone, and the answer says the log goes on.
    expect(asked()).toEqual([LOG, second])
    expect(history).toMatchObject({ log: 'ok', logComplete: false, trusted: 2 })
    expect(history.pushes).toHaveLength(2)

    const all = queue({ [LOG]: page([push(1)], 'cursor1'), [second]: page([push(2)]) })
    expect(await createHistoryLoader(all.get).ensure(facts, head, need(), free)).toMatchObject({ logComplete: true })
  })

  it('keeps the first page when a later one fails', async () => {
    const second = activityUrl({ repo: REPO, v: VERSION, asc: true, after: 'cursor1' })
    const { get } = queue({ [LOG]: page([push(1)], 'cursor1'), [second]: broken })
    const history = await createHistoryLoader(get).ensure(facts, head, need(), free)
    expect(history).toMatchObject({ log: 'ok', logComplete: false })
    expect(history.pushes).toHaveLength(1)
  })

  it('says so when GitHub has no log for the repo', async () => {
    const { get, asked } = queue({ [LOG]: page([]) })
    const history = await createHistoryLoader(get).ensure(facts, head, need('the app'), free)
    expect(history).toMatchObject({ log: 'none', scanned: 0, startKnown: false })
    expect(asked()).toEqual([LOG])
  })

  it('never fails: a log that cannot be loaded is reported, and asked for again next time', async () => {
    const { get, asked } = queue({ ...story(), [LOG]: [broken, page([push(1), push(2), push(3)])] })
    const loader = createHistoryLoader(get)
    expect(await loader.ensure(facts, head, need('the app'), free)).toMatchObject({ log: 'failed', scanned: 0 })
    expect(await loader.ensure(facts, head, need('the app'), free)).toMatchObject({ log: 'ok', scanned: 2 })
    expect(asked().filter((url) => url === LOG)).toHaveLength(2)
  })

  it('does not build on a log that is still settling, and looks again later', async () => {
    const { get } = queue({ ...story(), [LOG]: [page([push(1), push(2)], null, false), page([push(1), push(2), push(3)])] })
    const loader = createHistoryLoader(get)
    expect(await loader.ensure(facts, head, need('the app'), free)).toMatchObject({ log: 'unsettled', scanned: 0 })
    expect(await loader.ensure(facts, head, need('the app'), free)).toMatchObject({ log: 'ok' })
  })

  it('waits out "too many requests"', async () => {
    const { get, asked } = queue({ ...story(), [LOG]: [limited, limited, page([push(1)])], [at(1)]: [limited, listing(HEAD_FILES)] })
    const history = await createHistoryLoader(get).ensure(facts, head, need('the app'), free)
    expect(history).toMatchObject({ log: 'ok', scanned: 1, stopped: 'all_seen' })
    expect(asked()).toEqual([LOG, LOG, LOG, at(1), at(1)])
  })
})

describe('reading the pushed commits', () => {
  it('reads oldest first and stops once every file looked for has been seen', async () => {
    const { get, calls } = queue(story())
    const history = await createHistoryLoader(get).ensure(facts, head, need('the app'), free)
    expect(calls.map((call) => call.url)).toEqual([LOG, at(1), at(2)])
    expect(calls.every((call) => call.priority === 3)).toBe(true)
    expect(history).toMatchObject({ scanned: 2, stopped: 'all_seen' })
    expect(history.digests.map((seen) => [...seen.held])).toEqual([[id('readme')], [id('readme'), id('the app')]])
  })

  it('reads nothing when nothing is looked for', async () => {
    const { get, asked } = queue(story())
    const history = await createHistoryLoader(get).ensure(facts, head, need(), free)
    expect(asked()).toEqual([LOG])
    expect(history).toMatchObject({ scanned: 0, stopped: 'all_seen' })
  })

  it('goes on where it stopped when more is looked for later', async () => {
    const { get, asked } = queue(story())
    const loader = createHistoryLoader(get)
    const first = await loader.ensure(facts, head, need('the app'), free)
    const second = await loader.ensure(facts, head, need('the app', 'the helpers'), free)
    expect(asked()).toEqual([LOG, at(1), at(2), at(3)])
    expect(second).toMatchObject({ scanned: 3, stopped: 'all_seen' })
    // The first answer is not changed behind the caller's back.
    expect(first.scanned).toBe(2)
    expect(loader.peek(REPO, id('head'))).toBe(second)
    expect(loader.peek(REPO, id('other head'))).toBeUndefined()
  })

  it('reaches the end of the log when a file never shows up', async () => {
    const { get } = queue(story())
    const history = await createHistoryLoader(get).ensure(facts, head, need('not in any push'), free)
    expect(history).toMatchObject({ scanned: 3, stopped: 'end' })
  })

  it('says the log goes on when its last page read did not bring the file', async () => {
    const { get } = queue({ ...story(), [LOG]: page([push(1), push(2)], 'cursor1') })
    const history = await createHistoryLoader(get, { pages: 1 }).ensure(facts, head, need('the helpers'), free)
    expect(history).toMatchObject({ scanned: 2, stopped: 'cap', logComplete: false })
  })

  it('asks once for a commit that several pushes point at', async () => {
    const { get, asked } = queue({
      ...story(),
      [LOG]: page([
        push(1),
        // A new branch at the same commit, then the next push.
        push(1, { ts: '2026-09-02T10:00:00Z', ref: 'refs/heads/dev' }),
        push(2),
      ]),
    })
    const history = await createHistoryLoader(get).ensure(facts, head, need('the app'), free)
    expect(asked()).toEqual([LOG, at(1), at(2)])
    expect(history).toMatchObject({ scanned: 3, stopped: 'all_seen' })
  })

  it('counts a file in a folder the comparison itself leaves out', async () => {
    const { get } = queue({
      ...story(),
      // The app once sat in `build/`, which the fixed rules never compare.
      [at(1)]: listing({ 'build/app.js': 'the app', 'node_modules/x/index.js': 'the helpers' }),
    })
    const history = await createHistoryLoader(get).ensure(facts, head, need('the app', 'the helpers'), free)
    expect(history).toMatchObject({ scanned: 1, stopped: 'all_seen' })
  })

  it('notes a path that held other content before', async () => {
    const { get } = queue({ ...story(), [at(1)]: listing({ 'README.md': 'readme', 'src/app.js': 'a first try' }) })
    const history = await createHistoryLoader(get).ensure(facts, head, need('the app'), free)
    expect([...history.digests[0].changed]).toEqual(['src/app.js'])
  })

  it('stops at a commit too large to list, and does not ask for it again', async () => {
    const { get, asked } = queue({ ...story(), [at(2)]: TOO_LARGE })
    const loader = createHistoryLoader(get)
    expect(await loader.ensure(facts, head, need('the helpers'), free)).toMatchObject({ scanned: 1, stopped: 'too_large' })
    expect(await loader.ensure(facts, head, need('the helpers'), free)).toMatchObject({ scanned: 1, stopped: 'too_large' })
    expect(asked()).toEqual([LOG, at(1), at(2)])
  })

  it('stops at a commit GitHub no longer has', async () => {
    const { get } = queue({ ...story(), [at(2)]: gone })
    const history = await createHistoryLoader(get).ensure(facts, head, need('the helpers'), free)
    expect(history).toMatchObject({ scanned: 1, stopped: 'gone' })
  })

  it('stops at a failed request, and tries that commit again next time', async () => {
    const { get, asked } = queue({ ...story(), [at(2)]: [broken, listing({ 'README.md': 'readme', 'src/app.js': 'the app' })] })
    const loader = createHistoryLoader(get)
    expect(await loader.ensure(facts, head, need('the app'), free)).toMatchObject({ scanned: 1, stopped: 'failed' })
    expect(await loader.ensure(facts, head, need('the app'), free)).toMatchObject({ scanned: 2, stopped: 'all_seen' })
    expect(asked()).toEqual([LOG, at(1), at(2), at(2)])
  })

  it('stops when the shared budget is spent, and goes on with a new one', async () => {
    const { get, asked } = queue(story())
    const loader = createHistoryLoader(get)
    expect(await loader.ensure(facts, head, need('the helpers'), budget(1))).toMatchObject({ scanned: 1, stopped: 'budget' })
    expect(asked()).toEqual([LOG, at(1)])
    expect(await loader.ensure(facts, head, need('the helpers'), budget(5))).toMatchObject({ scanned: 3, stopped: 'all_seen' })
  })

  it('reads no more commits of one repo than the limit', async () => {
    const { get, asked } = queue(story())
    const loader = createHistoryLoader(get, { snapshots: 2 })
    expect(await loader.ensure(facts, head, need('the helpers'), free)).toMatchObject({ scanned: 2, stopped: 'cap' })
    expect(await loader.ensure(facts, head, need('the helpers'), free)).toMatchObject({ scanned: 2, stopped: 'cap' })
    expect(asked()).toEqual([LOG, at(1), at(2)])
  })

  it('runs two calls for one repo one after the other, sharing what was read', async () => {
    const { get, asked } = queue(story())
    const loader = createHistoryLoader(get)
    const [one, two] = await Promise.all([
      loader.ensure(facts, head, need('the app'), free),
      loader.ensure(facts, head, need('the helpers'), free),
    ])
    expect(one.scanned).toBe(2)
    expect(two.scanned).toBe(3)
    expect(asked()).toEqual([LOG, at(1), at(2), at(3)])
  })
})
