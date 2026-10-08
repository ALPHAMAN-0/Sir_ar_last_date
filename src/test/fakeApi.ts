// Helpers for the screen tests: a fake /api/v1 behind a stubbed fetch, a sheet
// saved the way the store saves it, and a fake IntersectionObserver. No test
// that uses these ever reaches the real network.

import { vi } from 'vitest'
import type {
  ActivityEvent,
  CommitFilesResponse,
  CommitInfo,
  RepoMeta,
  RepoOk,
  StatusResponse,
  TreeFile,
} from '../../shared/api.ts'

export const STORAGE_KEY = 'sirar:v1'
export const FETCHED_AT = '2026-10-06T04:00:00Z'

/** A made-up but valid 40-character commit id, the same for the same seed. */
export function oid(seed: string): string {
  let hash = 7
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash.toString(16).padStart(8, '0').repeat(5)
}

/** Repo facts as the Worker sends them for a repo with work in it. */
export function okRepo(key: string, over: Partial<RepoOk> = {}): RepoOk {
  return {
    key,
    state: 'ok',
    nameWithOwner: key,
    isEmpty: false,
    isFork: false,
    isArchived: false,
    createdAt: '2026-09-01T08:00:00Z',
    pushedAt: '2026-10-01T08:00:00Z',
    defaultBranch: 'main',
    headOid: oid(key),
    headCommittedAt: '2026-10-01T07:55:00Z',
    totalCommits: 5,
    parent: null,
    template: null,
    branches: { total: 1, names: ['main'] },
    ...over,
  }
}

export type Failure = { failure: { status: number; code: string; message: string } }
export const failure = (status: number, code: string, message: string): Failure => ({
  failure: { status, code, message },
})
const isFailure = (value: unknown): value is Failure =>
  typeof value === 'object' && value !== null && 'failure' in value

/** What the fake Worker knows. Tests may change it between requests. */
export type FakeApi = {
  /** Repo facts by sheet key. A key that is missing answers "not found". */
  repos: Record<string, RepoMeta>
  /** Push events of the main branch by repo, newest first. A repo that is missing has none. */
  activity: Record<string, ActivityEvent[] | Failure>
  /** The commit list behind each repo's head. */
  commits: Record<string, CommitInfo[] | Failure>
  /** Changed files by commit id; later pages under `${sha}#${page}`. */
  files: Record<string, CommitFilesResponse | Failure>
  /** Push events of every branch by repo, oldest first. Without it, the main branch's stand in. */
  branches: Record<string, ActivityEvent[]>
  /** File lists by repo, or by `${repo}@${commit}` for the files at an older commit. */
  trees: Record<string, TreeFile[] | Failure>
  /** The quota answer. Null answers 404, which the page quietly ignores. */
  status: StatusResponse | null
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const answer = (value: unknown, build: (value: never) => unknown) =>
  isFailure(value)
    ? json(value.failure.status, { error: { code: value.failure.code, message: value.failure.message } })
    : value === undefined
      ? json(404, { error: { code: 'not_found', message: 'Not found.' } })
      : json(200, build(value as never))

/** Replaces fetch with a fake Worker. Returns its data (changeable) and the fetch mock. */
export function stubApi(data: Partial<FakeApi> = {}) {
  const api: FakeApi = {
    repos: {},
    activity: {},
    branches: {},
    commits: {},
    files: {},
    trees: {},
    status: null,
    ...data,
  }
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    const query = url.searchParams
    const repo = query.get('repo') ?? ''
    switch (url.pathname) {
      case '/api/v1/repos':
        return json(200, {
          fetchedAt: FETCHED_AT,
          repos: query.getAll('r').map((key) => api.repos[key] ?? { key, state: 'not_found' }),
        })
      case '/api/v1/status':
        return answer(api.status ?? undefined, (status: StatusResponse) => status)
      case '/api/v1/activity':
        if (!query.has('ref') && api.branches[repo]) {
          return json(200, { fetchedAt: FETCHED_AT, settled: true, events: api.branches[repo], next: null })
        }
        return answer(api.activity[repo] ?? [], (events: ActivityEvent[]) => ({
          fetchedAt: FETCHED_AT,
          settled: true,
          // The all-branches probe asks oldest first.
          events: query.get('dir') === 'asc' ? [...events].reverse() : events,
          next: null,
        }))
      case '/api/v1/commits':
        return answer(api.commits[repo], (commits: CommitInfo[]) => ({ commits, next: null }))
      case '/api/v1/commit': {
        const sha = query.get('sha') ?? ''
        const page = query.get('page')
        return answer(api.files[page ? `${sha}#${page}` : sha], (files: CommitFilesResponse) => files)
      }
      case '/api/v1/tree':
        return answer(api.trees[`${repo}@${query.get('sha')}`] ?? api.trees[repo], (files: TreeFile[]) => ({
          files,
          dirs: [],
          tooLarge: false,
        }))
      default:
        return json(404, { error: { code: 'not_found', message: 'No such route.' } })
    }
  })
  vi.stubGlobal('fetch', fetch)
  /** The paths of every request so far, e.g. "/api/v1/commits". */
  const paths = () => fetch.mock.calls.map(([input]) => new URL(String(input), 'http://localhost').pathname)
  return { api, fetch, paths }
}

/** One row of a sheet: ID, name, and what the link cell holds. */
export type RowCells = [id: string, name: string, link: string]

/**
 * Saves a sheet the way the store does, so `start()` restores it. The first
 * person is on sheet row 2, below the header, so their route is `#/p/r2`.
 */
export function saveSheet(rows: RowCells[], options: { deadlineInput?: string } = {}): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      fileName: 'class-7.xlsx',
      sheetName: 'Sheet1',
      truncated: false,
      rows: rows.map(([id, name, link], index) => [index + 2, id, name, link]),
      deadlineInput: options.deadlineInput ?? '',
      // No saved order, so the register starts with its own: newest push first.
    }),
  )
}

/** jsdom has no IntersectionObserver. This one reports nothing until `showAll()`. */
export function stubIntersectionObserver() {
  const observers: FakeObserver[] = []
  class FakeObserver {
    callback: IntersectionObserverCallback
    nodes = new Set<Element>()
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
      observers.push(this)
    }
    observe(node: Element) {
      this.nodes.add(node)
    }
    unobserve(node: Element) {
      this.nodes.delete(node)
    }
    disconnect() {
      this.nodes.clear()
    }
    takeRecords() {
      return []
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  return {
    /** Every observed element scrolls into view. */
    showAll() {
      for (const observer of observers) {
        if (observer.nodes.size === 0) continue
        const entries = [...observer.nodes].map(
          (target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry,
        )
        observer.callback(entries, observer as unknown as IntersectionObserver)
      }
    },
  }
}
