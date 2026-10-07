import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityEvent, ActivityResponse, RepoMeta, RepoOk } from '../../shared/api.ts'
import { parseDeadlineInput } from '../logic/time.ts'

// The store is a module-level singleton, so every test imports a fresh copy
// and answers its requests with a fake /api/v1 server. Nothing reaches the network.

type Store = typeof import('./store.ts')

const STORAGE_KEY = 'sirar:v1'
const OID = (n: number) => String(n).padStart(40, '0').replace(/^0/, 'a')
const DEADLINE_INPUT = '2026-09-25T13:00'
const DEADLINE = parseDeadlineInput(DEADLINE_INPUT)!.ms
const BEFORE = new Date(DEADLINE - 86_400_000).toISOString()
const AFTER = new Date(DEADLINE + 3_600_000).toISOString()
const LATER = new Date(DEADLINE + 7_200_000).toISOString()

function repo(key: string, extra: Partial<RepoOk> = {}): RepoOk {
  return {
    key,
    state: 'ok',
    nameWithOwner: key,
    isEmpty: false,
    isFork: false,
    isArchived: false,
    createdAt: '2026-09-01T00:00:00Z',
    pushedAt: BEFORE,
    defaultBranch: 'main',
    headOid: OID(9),
    headCommittedAt: BEFORE,
    totalCommits: 3,
    ...extra,
  }
}

const push = (ts: string, after: string): ActivityEvent => ({
  ts,
  type: 'push',
  ref: 'refs/heads/main',
  before: OID(1),
  after,
  actor: 'someone',
})

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const apiError = (status: number, code: string, extra: object = {}) =>
  json({ error: { code, message: code, ...extra } }, status)

type Handler = (url: URL) => Response | Promise<Response>

/** A fake Worker API. `github` holds what each repo looks like; handlers can be replaced per test. */
function fakeApi() {
  const github = new Map<string, RepoMeta>()
  const calls: URL[] = []
  const handlers: Record<string, Handler> = {
    '/api/v1/repos': (url) =>
      json({
        fetchedAt: new Date().toISOString(),
        repos: url.searchParams
          .getAll('r')
          .map((key) => github.get(key) ?? ({ key, state: 'not_found' } as const)),
      }),
    '/api/v1/activity': () =>
      json({ fetchedAt: new Date().toISOString(), settled: true, events: [], next: null }),
    '/api/v1/status': () =>
      json({ fetchedAt: new Date().toISOString(), core: null, graphql: null, reserve: 500 }),
  }
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input, 'https://register.test')
    calls.push(url)
    const handler = handlers[url.pathname]
    if (!handler) throw new Error(`unexpected request ${url.pathname}`)
    return handler(url)
  })
  const callsTo = (path: string) => calls.filter((url) => url.pathname === `/api/v1/${path}`)
  return { github, handlers, fetch, callsTo }
}

let storage: Storage
let api: ReturnType<typeof fakeApi>

async function freshStore(): Promise<Store> {
  vi.resetModules()
  return import('./store.ts')
}

/** Lets every queued request and its follow-ups finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function saveSheet(links: string[], extra: object = {}): void {
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      fileName: 'class.xlsx',
      sheetName: 'Sheet1',
      truncated: false,
      rows: links.map((link, i) => [i + 2, `id-${i}`, `Person ${i}`, link]),
      deadlineInput: '',
      sort: { column: 'pushedAt', descending: true },
      ...extra,
    }),
  )
}

const saved = () => JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')

beforeEach(() => {
  storage = memoryStorage()
  api = fakeApi()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('fetch', api.fetch)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('starting the page', () => {
  it('starts empty and asks nothing when nothing was saved', async () => {
    const store = await freshStore()
    store.start()
    await settle()
    expect(store.getState().sheet).toBeNull()
    expect(api.fetch).not.toHaveBeenCalled()
  })

  it('brings back the saved sheet, deadline and sort, and checks the repos again', async () => {
    saveSheet(['https://github.com/b/two', 'github.com/a/one'], {
      deadlineInput: DEADLINE_INPUT,
      sort: { column: 'name', descending: false },
    })
    api.github.set('a/one', repo('a/one'))
    api.github.set('b/two', repo('b/two'))

    const store = await freshStore()
    store.start()
    await settle()

    const state = store.getState()
    expect(state.sheet?.fileName).toBe('class.xlsx')
    expect(state.sheet?.rows.map((row) => row.rowNumber)).toEqual([2, 3])
    expect(state.deadline).toBe(DEADLINE)
    expect(state.deadlineInput).toBe(DEADLINE_INPUT)
    expect(state.sort).toEqual({ column: 'name', descending: false })
    expect(api.callsTo('repos').map((url) => url.search)).toEqual(['?r=a%2Fone&r=b%2Ftwo'])
    expect([...state.repos.keys()].sort()).toEqual(['a/one', 'b/two'])
    expect(state.loadingRepos).toBe(0)
  })

  it('ignores a damaged save instead of failing', async () => {
    storage.setItem(STORAGE_KEY, '{not json')
    const store = await freshStore()
    store.start()
    expect(store.getState().sheet).toBeNull()
  })

  it('keeps what is usable from a save that was tampered with', async () => {
    saveSheet([], {
      rows: [[2, 'id', 'Name', 'github.com/a/one'], ['x', 'bad row'], 'junk'],
      deadlineInput: 'next friday',
      sort: { column: 'password', descending: true },
    })
    const store = await freshStore()
    store.start()
    const state = store.getState()
    expect(state.sheet?.rows).toHaveLength(1)
    expect(state.deadline).toBeNull()
    expect(state.sort).toEqual({ column: 'pushedAt', descending: true })
  })
})

describe('reading an uploaded file', () => {
  it('refuses a file over 5 MB without reading it', async () => {
    const store = await freshStore()
    await store.loadFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.xlsx'))
    expect(store.getState().uploadError).toMatch(/larger than 5 MB/)
    expect(store.getState().sheet).toBeNull()
  })

  it('says so when the sheet is empty', async () => {
    const store = await freshStore()
    await store.loadFile(new File([''], 'empty.csv'))
    expect(store.getState().uploadError).toBe('This sheet is empty.')
  })

  it('reads a CSV, keeps it in this browser, and checks each repo once', async () => {
    api.github.set('a/one', repo('a/one'))
    const csv = [
      'id,name,repolink',
      '1,Rahim,https://github.com/a/one',
      '2,Nusrat,github.com/A/One',
      '3,Tanvir,not a link',
    ].join('\n')
    const store = await freshStore()
    await store.loadFile(new File([csv], 'class.csv'))
    await settle()

    const state = store.getState()
    expect(state.uploadError).toBeNull()
    expect(state.sheet?.rows.map((row) => row.name)).toEqual(['Rahim', 'Nusrat', 'Tanvir'])
    expect(saved().rows).toHaveLength(3)
    expect(api.callsTo('repos')).toHaveLength(1)
    expect(api.callsTo('repos')[0].searchParams.getAll('r')).toEqual(['a/one'])

    const statuses = store.judgeRows(state.sheet!, state.repos, state.activity, null)
    expect(statuses.map((person) => person.verdict.status)).toEqual([
      'submitted',
      'submitted',
      'invalid_link',
    ])
    expect(statuses[0].verdict.notes).toContain('duplicate_link')
    expect(statuses[2].verdict.notes).not.toContain('duplicate_link')
  })

  it('lets the columns be picked again without uploading again', async () => {
    const csv = ['a,b,c', 'X1,Rahim,github.com/a/one'].join('\n')
    const store = await freshStore()
    await store.loadFile(new File([csv], 'class.csv'))
    store.remapColumns({ id: 1, name: 0, link: 2, headerRow: 0 })
    expect(store.getState().sheet?.rows[0]).toMatchObject({ id: 'Rahim', name: 'X1' })
    expect(saved().rows[0]).toEqual([2, 'Rahim', 'X1', 'github.com/a/one'])
  })
})

describe('checking repos', () => {
  it('asks for at most 20 repos per request, then reads the quota once', async () => {
    const links = Array.from({ length: 45 }, (_, i) => `github.com/owner/repo-${String(i).padStart(2, '0')}`)
    for (const link of links) api.github.set(link.slice(11), repo(link.slice(11)))
    saveSheet(links)

    const store = await freshStore()
    store.start()
    await settle()

    const batches = api.callsTo('repos').map((url) => url.searchParams.getAll('r'))
    expect(batches.map((keys) => keys.length)).toEqual([20, 20, 5])
    expect(new Set(batches.flat()).size).toBe(45)
    expect(store.getState().repos.size).toBe(45)
    expect(store.getState().loadingRepos).toBe(0)
    expect(api.callsTo('status')).toHaveLength(1)
    expect(store.getState().quota?.reserve).toBe(500)
  })

  it('splits a batch that keeps failing, so one slow repo does not sink the rest', async () => {
    vi.useFakeTimers()
    for (const key of ['a/one', 'b/two', 'd/four']) api.github.set(key, repo(key))
    const answer = api.handlers['/api/v1/repos']
    api.handlers['/api/v1/repos'] = (url) =>
      url.searchParams.getAll('r').includes('c/slow')
        ? apiError(504, 'github_timeout')
        : answer(url)
    saveSheet(['github.com/a/one', 'github.com/b/two', 'github.com/c/slow', 'github.com/d/four'])

    const store = await freshStore()
    store.start()
    await vi.runAllTimersAsync()

    const repos = store.getState().repos
    expect(repos.get('a/one')?.state).toBe('ok')
    expect(repos.get('b/two')?.state).toBe('ok')
    expect(repos.get('d/four')?.state).toBe('ok')
    expect(repos.get('c/slow')).toEqual({ key: 'c/slow', state: 'error', code: 'github_timeout' })
  })

  it('does not split a batch when the server token is wrong, since every half would fail too', async () => {
    vi.useFakeTimers()
    api.handlers['/api/v1/repos'] = () => apiError(502, 'github_auth')
    saveSheet(['github.com/a/one', 'github.com/b/two', 'github.com/c/three'])

    const store = await freshStore()
    store.start()
    await vi.runAllTimersAsync()

    // One batch, tried three times by the request queue, never split into halves.
    expect(api.callsTo('repos')).toHaveLength(3)
    expect(new Set(api.callsTo('repos').map((url) => url.search)).size).toBe(1)
    for (const key of ['a/one', 'b/two', 'c/three']) {
      expect(store.getState().repos.get(key)).toMatchObject({ state: 'error', code: 'github_auth' })
    }
  })

  it('spends no more requests once the hourly GitHub limit is used up', async () => {
    const resetAt = new Date(Date.now() + 30 * 60_000).toISOString()
    api.handlers['/api/v1/repos'] = () => apiError(503, 'quota_reserved', { resetAt })
    saveSheet(['github.com/a/one', 'github.com/b/two'])

    const store = await freshStore()
    store.start()
    await settle()

    expect(api.callsTo('repos')).toHaveLength(1)
    const repos = store.getState().repos
    expect(repos.get('a/one')).toMatchObject({ state: 'error', code: 'quota_reserved' })
    expect(repos.get('b/two')).toMatchObject({ state: 'error', code: 'quota_reserved' })
    expect(store.getState().pause).toEqual({ reason: 'quota_reserved', until: Date.parse(resetAt) })
  })

  it('drops answers that arrive after the sheet was removed', async () => {
    let answer: (response: Response) => void = () => {}
    api.handlers['/api/v1/repos'] = () => new Promise<Response>((resolve) => (answer = resolve))
    saveSheet(['github.com/a/one'])

    const store = await freshStore()
    store.start()
    await settle()
    store.clearSheet()
    answer(json({ fetchedAt: new Date().toISOString(), repos: [repo('a/one')] }))
    await settle()

    expect(store.getState().sheet).toBeNull()
    expect(store.getState().repos.size).toBe(0)
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('the deadline', () => {
  it('rejects a deadline it cannot read and keeps the one in force', async () => {
    const store = await freshStore()
    store.setDeadlineInput('tomorrow at noon')
    expect(store.applyDeadline()).toBe(false)
    expect(store.getState().deadline).toBeNull()
  })

  it('reads the push log only for repos pushed after the deadline, and stops once it reaches it', async () => {
    api.github.set('a/early', repo('a/early', { pushedAt: BEFORE }))
    api.github.set('b/late', repo('b/late', { pushedAt: AFTER }))
    api.handlers['/api/v1/activity'] = () =>
      json({
        fetchedAt: AFTER,
        settled: true,
        events: [push(AFTER, OID(9)), push(BEFORE, OID(5))],
        next: 'page-2',
      } satisfies ActivityResponse)
    saveSheet(['github.com/a/early', 'github.com/b/late'])

    const store = await freshStore()
    store.start()
    await settle()
    expect(api.callsTo('activity')).toHaveLength(0)

    store.setDeadlineInput(DEADLINE_INPUT)
    expect(store.applyDeadline()).toBe(true)
    await settle()

    expect(saved().deadlineInput).toBe(DEADLINE_INPUT)
    const asked = api.callsTo('activity')
    expect(asked).toHaveLength(1)
    expect(Object.fromEntries(asked[0].searchParams)).toEqual({ repo: 'b/late', v: AFTER, ref: 'main' })

    const state = store.getState()
    expect(state.activity.get('b/late')).toMatchObject({ exhausted: false, capped: false, failed: false })
    const rows = store.judgeRows(state.sheet!, state.repos, state.activity, state.deadline)
    expect(rows.map((person) => person.verdict.status)).toEqual(['on_time', 'changed_after'])
  })

  it('reads no more than 5 pages, then asks when the very first push was', async () => {
    api.github.set('b/busy', repo('b/busy', { pushedAt: LATER }))
    let page = 0
    api.handlers['/api/v1/activity'] = (url) => {
      if (url.searchParams.get('dir') === 'asc') {
        return json({ fetchedAt: LATER, settled: true, events: [push(BEFORE, OID(2))], next: null })
      }
      page++
      return json({ fetchedAt: LATER, settled: true, events: [push(LATER, OID(page))], next: `page-${page + 1}` })
    }
    saveSheet(['github.com/b/busy'], { deadlineInput: DEADLINE_INPUT })

    const store = await freshStore()
    store.start()
    await settle()

    const asked = api.callsTo('activity')
    const pages = asked.filter((url) => !url.searchParams.has('dir'))
    expect(pages).toHaveLength(5)
    expect(pages.slice(1).map((url) => url.searchParams.get('after'))).toEqual([
      'page-2',
      'page-3',
      'page-4',
      'page-5',
    ])
    expect(asked.filter((url) => url.searchParams.get('dir') === 'asc')).toHaveLength(1)

    const log = store.getState().activity.get('b/busy')
    expect(log).toMatchObject({ capped: true, exhausted: false })
    expect(log?.events).toHaveLength(5)
    expect(log?.probe).toHaveLength(1)
  })

  it('lets a second caller wait for the log being read, which then reads on as far as that caller asked', async () => {
    api.github.set('b/late', repo('b/late', { pushedAt: AFTER }))
    let page = 0
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    api.handlers['/api/v1/activity'] = async () => {
      const n = ++page
      if (n === 1) await held
      // Every page reaches the deadline, so the register alone would stop after the first.
      return json({
        fetchedAt: AFTER,
        settled: true,
        events: [push(AFTER, OID(n)), push(BEFORE, OID(n + 10))],
        next: `page-${n + 1}`,
      } satisfies ActivityResponse)
    }
    saveSheet(['github.com/b/late'], { deadlineInput: DEADLINE_INPUT })

    const store = await freshStore()
    store.start()
    await settle()
    expect(api.callsTo('activity')).toHaveLength(1)

    let done = false
    const reading = store.loadActivity('b/late', 3).then(() => {
      done = true
    })
    await settle()
    expect(done).toBe(false)
    expect(api.callsTo('activity')).toHaveLength(1)

    release()
    await reading
    expect(api.callsTo('activity')).toHaveLength(3)
    expect(store.getState().activity.get('b/late')?.events).toHaveLength(6)
  })

  it('reads on from where it stopped when a later caller asks for more pages', async () => {
    api.github.set('b/late', repo('b/late', { pushedAt: AFTER }))
    let page = 0
    api.handlers['/api/v1/activity'] = () => {
      const n = ++page
      return json({
        fetchedAt: AFTER,
        settled: true,
        events: [push(AFTER, OID(n)), push(BEFORE, OID(n + 10))],
        next: n < 2 ? `page-${n + 1}` : null,
      } satisfies ActivityResponse)
    }
    saveSheet(['github.com/b/late'], { deadlineInput: DEADLINE_INPUT })

    const store = await freshStore()
    store.start()
    await settle()
    expect(api.callsTo('activity')).toHaveLength(1)

    await store.loadActivity('b/late', store.HISTORY_PAGES)
    const asked = api.callsTo('activity')
    expect(asked.map((url) => url.searchParams.get('after'))).toEqual([null, 'page-2'])
    expect(store.getState().activity.get('b/late')).toMatchObject({ exhausted: true, capped: false, failed: false })
    expect(store.getState().activity.get('b/late')?.events).toHaveLength(4)

    // The log is at its end. Asking again costs nothing.
    await store.loadActivity('b/late', store.HISTORY_PAGES)
    expect(api.callsTo('activity')).toHaveLength(2)
  })

  it('has no push log to wait for when the repo is empty, missing or not in the sheet', async () => {
    api.github.set('a/empty', repo('a/empty', { isEmpty: true, headOid: null, defaultBranch: null }))
    saveSheet(['github.com/a/empty', 'github.com/a/missing'])

    const store = await freshStore()
    store.start()
    await settle()
    await Promise.all([store.loadActivity('a/empty', 3), store.loadActivity('a/missing', 3), store.loadActivity('no/such', 3)])
    expect(api.callsTo('activity')).toHaveLength(0)
    expect(store.getState().activity.size).toBe(0)
  })

  it('shows a failed push log as a failed check, not as the student being late', async () => {
    api.github.set('b/late', repo('b/late', { pushedAt: AFTER }))
    api.handlers['/api/v1/activity'] = () => apiError(404, 'not_found')
    saveSheet(['github.com/b/late'], { deadlineInput: DEADLINE_INPUT })

    const store = await freshStore()
    store.start()
    await settle()

    const state = store.getState()
    expect(state.activity.get('b/late')?.failed).toBe(true)
    const [person] = store.judgeRows(state.sheet!, state.repos, state.activity, state.deadline)
    expect(person.verdict.status).toBe('check_failed')
  })
})

describe('refresh', () => {
  it('checks every repo again and retries a push log that failed', async () => {
    api.github.set('b/late', repo('b/late', { pushedAt: AFTER }))
    let fail = true
    api.handlers['/api/v1/activity'] = () =>
      fail
        ? apiError(404, 'not_found')
        : json({ fetchedAt: AFTER, settled: true, events: [push(AFTER, OID(9))], next: null })
    saveSheet(['github.com/b/late'], { deadlineInput: DEADLINE_INPUT })

    const store = await freshStore()
    store.start()
    await settle()
    expect(store.getState().activity.get('b/late')?.failed).toBe(true)

    fail = false
    store.refresh()
    await settle()

    expect(api.callsTo('repos')).toHaveLength(2)
    expect(api.callsTo('activity')).toHaveLength(2)
    expect(store.getState().activity.get('b/late')).toMatchObject({ failed: false, exhausted: true })
  })

  it('lets go of a push log that is being read, and reads it once more without doubling it', async () => {
    api.github.set('b/late', repo('b/late', { pushedAt: AFTER }))
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    api.handlers['/api/v1/activity'] = async () => {
      await held
      return json({ fetchedAt: AFTER, settled: true, events: [push(AFTER, OID(9)), push(BEFORE, OID(5))], next: null })
    }
    saveSheet(['github.com/b/late'], { deadlineInput: DEADLINE_INPUT })

    const store = await freshStore()
    store.start()
    await settle()
    expect(store.getState().activity.has('b/late')).toBe(false)

    store.refresh()
    await settle()
    release()
    await settle()

    const log = store.getState().activity.get('b/late')
    expect(log).toMatchObject({ exhausted: true, failed: false })
    expect(log?.events).toHaveLength(2)
    expect(store.currentPeople()[0].verdict.status).toBe('changed_after')
    // The log is whole and nobody is reading it: a later caller is answered at once.
    const before = api.callsTo('activity').length
    await store.loadActivity('b/late', 3)
    expect(api.callsTo('activity')).toHaveLength(before)
  })

  it('forgets the push log when the repo was pushed again', async () => {
    api.github.set('b/late', repo('b/late', { pushedAt: AFTER }))
    api.handlers['/api/v1/activity'] = (url) =>
      json({
        fetchedAt: LATER,
        settled: true,
        events: [push(url.searchParams.get('v')!, OID(9)), push(BEFORE, OID(5))],
        next: null,
      })
    saveSheet(['github.com/b/late'], { deadlineInput: DEADLINE_INPUT })

    const store = await freshStore()
    store.start()
    await settle()

    api.github.set('b/late', repo('b/late', { pushedAt: LATER }))
    store.refresh()
    await settle()

    expect(api.callsTo('activity').map((url) => url.searchParams.get('v'))).toEqual([AFTER, LATER])
    expect(store.getState().activity.get('b/late')?.events[0].ts).toBe(LATER)
  })
})

describe('the rows and repos as they are now', () => {
  it('judges the rows without a hook, the same way the screen does', async () => {
    api.github.set('a/early', repo('a/early', { pushedAt: BEFORE }))
    api.github.set('b/late', repo('b/late', { pushedAt: AFTER }))
    api.handlers['/api/v1/activity'] = () =>
      json({ fetchedAt: AFTER, settled: true, events: [push(AFTER, OID(9)), push(BEFORE, OID(5))], next: null })
    saveSheet(['github.com/a/early', 'github.com/b/late', 'no link'], { deadlineInput: DEADLINE_INPUT })

    const store = await freshStore()
    expect(store.currentPeople()).toEqual([])
    store.start()
    await settle()

    const state = store.getState()
    expect(store.currentPeople()).toEqual(store.judgeRows(state.sheet!, state.repos, state.activity, state.deadline))
    expect(store.currentPeople().map((person) => person.verdict.status)).toEqual(['on_time', 'changed_after', 'invalid_link'])
  })

  it('gives the facts of one repo, and nothing but "checking" for one it has not heard of', async () => {
    api.github.set('b/late', repo('b/late', { pushedAt: AFTER }))
    api.handlers['/api/v1/activity'] = () =>
      json({ fetchedAt: AFTER, settled: true, events: [push(AFTER, OID(9)), push(BEFORE, OID(5))], next: null })
    saveSheet(['github.com/b/late'], { deadlineInput: DEADLINE_INPUT })

    const store = await freshStore()
    store.start()
    await settle()

    const facts = store.repoFacts('b/late')
    expect(facts.meta).toMatchObject({ key: 'b/late', state: 'ok' })
    expect(facts.activity?.events).toHaveLength(2)
    expect(facts.verdict.status).toBe('changed_after')
    expect(store.repoFacts('no/such')).toMatchObject({ meta: undefined, activity: undefined, verdict: { status: 'checking' } })
  })
})

describe('sorting and clearing', () => {
  it('starts dates newest first and text A to Z, flips on a second click, and remembers it', async () => {
    saveSheet(['github.com/a/one'])
    const store = await freshStore()
    store.start()

    store.setSort('name')
    expect(store.getState().sort).toEqual({ column: 'name', descending: false })
    store.setSort('name')
    expect(store.getState().sort).toEqual({ column: 'name', descending: true })
    store.setSort('commits')
    expect(store.getState().sort).toEqual({ column: 'commits', descending: true })
    expect(saved().sort).toEqual({ column: 'commits', descending: true })
  })

  it('removes the sheet and the deadline from this browser', async () => {
    saveSheet(['github.com/a/one'], { deadlineInput: DEADLINE_INPUT })
    const store = await freshStore()
    store.start()
    store.setSearch('rahim')

    store.clearSheet()

    const state = store.getState()
    expect(state.sheet).toBeNull()
    expect(state.deadline).toBeNull()
    expect(state.deadlineInput).toBe('')
    expect(state.search).toBe('')
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })
})
