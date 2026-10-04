// Fetches the file tree of one repo from GitHub's public, anonymous
// `git/trees?recursive=1` endpoint. Caches in `sessionStorage` for an
// hour. The Worker is not involved: this is the user talking to GitHub
// directly, so the project's shared-token quota reserve is untouched.
//
// The endpoint is rate-limited per IP (~60/hr anonymous, 5000/hr when
// the user is signed into GitHub). The browser carries the user's
// cookie if they have one, so being signed in is the natural way to
// raise the limit. The page tells the user this when a tree fetch
// returns 403.

import type { FileTree } from './types.ts'

const CACHE_PREFIX = 'sirar:tree:'
const CACHE_TTL_MS = 60 * 60 * 1000

export type TreeError =
  | { kind: 'http'; status: number; message: string }
  | { kind: 'truncated'; message: string }
  | { kind: 'network'; message: string }
  | { kind: 'malformed'; message: string }

export type FetchedTree =
  | { ok: true; tree: FileTree; fromCache: boolean }
  | { ok: false; repo: string; headOid: string; error: TreeError }

const TREE_PATH = (repo: string, sha: string) => `/repos/${repo}/git/trees/${sha}?recursive=1`

const cacheKey = (repo: string, sha: string) => `${CACHE_PREFIX}${repo}@${sha}`

type CachedTree = {
  paths: string[]
  fetchedAt: string
  branch: string
}

function readCache(repo: string, sha: string, now: number, storage: Storage | null): CachedTree | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(cacheKey(repo, sha))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedTree & { savedAt?: number }
    if (!Array.isArray(parsed.paths) || typeof parsed.fetchedAt !== 'string') return null
    if (parsed.savedAt !== undefined && now - parsed.savedAt > CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(repo: string, sha: string, value: CachedTree, storage: Storage | null, now: number): void {
  if (!storage) return
  try {
    storage.setItem(cacheKey(repo, sha), JSON.stringify({ ...value, savedAt: now }))
  } catch {
    // Storage may be full or blocked. The page still works, just slower.
  }
}

type RawTree = {
  sha?: string
  truncated?: boolean
  tree?: Array<{ path?: string; type?: string }>
  message?: string
}

function normalize(raw: unknown): { paths: string[]; truncated: boolean } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as RawTree
  if (!Array.isArray(r.tree)) return null
  const seen = new Set<string>()
  for (const entry of r.tree) {
    if (entry.type !== 'blob' || typeof entry.path !== 'string') continue
    seen.add(entry.path)
  }
  return { paths: [...seen].sort(), truncated: r.truncated === true }
}

export type FetchOptions = {
  /** Override `fetch` (used in tests). */
  fetchImpl?: typeof fetch
  /** Override `sessionStorage` (used in tests). */
  storage?: Storage | null
  /** Override the base URL (used in tests). */
  baseUrl?: string
  /** Override the clock (used in tests). */
  now?: () => number
}

const DEFAULT_BASE = 'https://api.github.com'

/** Fetches one tree. Returns a discriminated union so the caller can show a real error. */
export async function fetchTree(
  repo: string,
  headOid: string,
  branch: string,
  options: FetchOptions = {},
): Promise<FetchedTree> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const baseUrl = options.baseUrl ?? DEFAULT_BASE
  const now = options.now ?? Date.now
  const storage =
    options.storage !== undefined
      ? options.storage
      : typeof sessionStorage !== 'undefined'
        ? sessionStorage
        : null

  const cached = readCache(repo, headOid, now(), storage)
  if (cached) {
    return {
      ok: true,
      tree: { repo, branch, headOid, fetchedAt: cached.fetchedAt, paths: cached.paths },
      fromCache: true,
    }
  }

  let res: Response
  try {
    res = await fetchImpl(`${baseUrl}${TREE_PATH(repo, headOid)}`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return { ok: false, repo, headOid, error: { kind: 'network', message: 'Could not reach GitHub.' } }
  }

  if (res.status === 403) {
    return {
      ok: false,
      repo,
      headOid,
      error: {
        kind: 'http',
        status: 403,
        message: 'GitHub rate-limited this browser. Sign in to GitHub to raise the limit.',
      },
    }
  }
  if (res.status === 404) {
    return {
      ok: false,
      repo,
      headOid,
      error: { kind: 'http', status: 404, message: 'Repo or commit not found.' },
    }
  }
  if (!res.ok) {
    return {
      ok: false,
      repo,
      headOid,
      error: { kind: 'http', status: res.status, message: `GitHub answered ${res.status}.` },
    }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return {
      ok: false,
      repo,
      headOid,
      error: { kind: 'malformed', message: 'GitHub sent an unreadable answer.' },
    }
  }

  const norm = normalize(body)
  if (!norm) {
    return {
      ok: false,
      repo,
      headOid,
      error: { kind: 'malformed', message: 'GitHub response did not look like a tree.' },
    }
  }
  if (norm.truncated) {
    return {
      ok: false,
      repo,
      headOid,
      error: {
        kind: 'truncated',
        message: 'The tree was truncated by GitHub (>100,000 entries). Try a smaller repo.',
      },
    }
  }

  const fetchedAt = new Date().toISOString()
  writeCache(repo, headOid, { branch, fetchedAt, paths: norm.paths }, storage, now())
  return {
    ok: true,
    tree: { repo, branch, headOid, fetchedAt, paths: norm.paths },
    fromCache: false,
  }
}

export type FetchAllInput = {
  repo: string
  headOid: string
  branch: string
}

/** Concurrency limit so we do not exhaust the per-IP rate budget at once. */
const DEFAULT_CONCURRENCY = 4

export type FetchAllOptions = FetchOptions & {
  concurrency?: number
  onProgress?: (done: number, total: number, current: string) => void
}

export type FetchAllResult = {
  trees: Map<string, FileTree>
  errors: Map<string, TreeError>
}

/**
 * Fetches many trees in parallel, capped at `concurrency` (default 4).
 * Inputs may repeat; each unique (repo, headOid) is fetched at most once.
 */
export async function fetchAll(
  inputs: readonly FetchAllInput[],
  options: FetchAllOptions = {},
): Promise<FetchAllResult> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const trees = new Map<string, FileTree>()
  const errors = new Map<string, TreeError>()
  const onProgress = options.onProgress

  const queue: FetchAllInput[] = []
  const seen = new Set<string>()
  for (const item of inputs) {
    const key = `${item.repo}@${item.headOid}`
    if (seen.has(key)) continue
    seen.add(key)
    queue.push(item)
  }

  let cursor = 0
  let done = 0
  const total = queue.length

  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(
      (async () => {
        for (;;) {
          const index = cursor++
          if (index >= queue.length) return
          const item = queue[index]
          const result = await fetchTree(item.repo, item.headOid, item.branch, options)
          done++
          if (result.ok) {
            trees.set(result.tree.repo, result.tree)
          } else {
            errors.set(result.repo, result.error)
          }
          onProgress?.(done, total, item.repo)
        }
      })(),
    )
  }
  await Promise.all(workers)
  return { trees, errors }
}

/** Removes every cached tree from `sessionStorage`. Useful for the user-facing "Refresh" button. */
export function clearCache(storage: Storage | null = typeof sessionStorage !== 'undefined' ? sessionStorage : null): void {
  if (!storage) return
  try {
    const toRemove: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && key.startsWith(CACHE_PREFIX)) toRemove.push(key)
    }
    for (const key of toRemove) storage.removeItem(key)
  } catch {
    // Ignore; the cache is best-effort.
  }
}