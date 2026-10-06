// Loads the file list of each repo through the Worker's `/api/v1/tree` and
// keeps only the files worth comparing (rules.ts).
//
// A list is addressed by commit id, so it never changes: it is kept for the
// session here, for a week in the browser's own cache, and at Cloudflare's edge.

import { treeUrl, type TreeFile, type TreeResponse } from '../../shared/api.ts'
import { ApiError } from '../api/client.ts'
import { isSkippedFolder, noSkips, skipReason } from './rules.ts'
import type { RepoFiles } from './types.ts'

/** File lists wait behind the register's own checks (0 and 1) in the request queue. */
const PRIORITY = 2
/** How often one request is asked again after "too many requests" before giving up. */
const MAX_ROUNDS = 4
/** What one very large repo may cost while it is read folder by folder. */
const MAX_WALK_REQUESTS = 40

export type TreeProblem = 'not_found' | 'too_large' | 'limit' | 'unavailable'
export type TreeError = { kind: TreeProblem; message: string }
export type TreeInput = { repo: string; headOid: string; branch: string }
export type Loaded = { trees: Map<string, RepoFiles>; errors: Map<string, TreeError> }
export type Progress = (done: number, total: number, current: string) => void
/** The request queue's `get` (api/client.ts). Passed in so tests can replace it. */
export type Get = <T>(url: string, priority?: number) => Promise<T>

class TooLarge extends Error {}

function toTreeError(error: unknown): TreeError {
  if (error instanceof TooLarge) {
    return { kind: 'too_large', message: 'This repo has too many files to list.' }
  }
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return { kind: 'not_found', message: 'GitHub no longer shows this repo. It may be private or deleted now.' }
    }
    if (error.code === 'quota_reserved') return { kind: 'limit', message: error.message }
    if (error.code === 'rate_limited' || error.code === 'github_throttled') {
      return { kind: 'limit', message: 'Too many requests for now. Press Try again in a minute.' }
    }
    return { kind: 'unavailable', message: error.message || 'The file list could not be loaded.' }
  }
  return { kind: 'unavailable', message: 'The file list could not be loaded.' }
}

export type TreeLoader = {
  /** The comparable files of one repo. Asked once per commit, however often it is called. */
  load(input: TreeInput): Promise<RepoFiles>
  /** Loads many repos. A repo that fails lands in `errors`; the others still load. */
  loadAll(inputs: readonly TreeInput[], onProgress?: Progress): Promise<Loaded>
}

export function createTreeLoader(get: Get): TreeLoader {
  const cache = new Map<string, Promise<RepoFiles>>()

  async function ask(url: string): Promise<TreeResponse> {
    for (let round = 1; ; round++) {
      try {
        const body = await get<TreeResponse>(url, PRIORITY)
        if (!body || !Array.isArray(body.files) || !Array.isArray(body.dirs)) {
          throw new ApiError(502, 'malformed', 'The server sent an unreadable file list.')
        }
        return body
      } catch (error) {
        // "Too many requests" pauses the whole queue. Asking again simply waits
        // in it until the pause is over, so a big class finishes by itself.
        const waitable =
          error instanceof ApiError &&
          (error.code === 'rate_limited' || error.code === 'github_throttled')
        if (!waitable || round >= MAX_ROUNDS) throw error
      }
    }
  }

  /**
   * For a repo too big to list at once (usually `node_modules` was committed):
   * open it folder by folder and never open the folders that are not compared.
   */
  async function walk(repo: string, rootSha: string): Promise<{ files: TreeFile[]; unopened: number }> {
    const files: TreeFile[] = []
    let unopened = 0
    let requests = 0
    const open = (sha: string, flat: boolean) => {
      if (++requests > MAX_WALK_REQUESTS) throw new TooLarge()
      return ask(treeUrl({ repo, sha, flat }))
    }
    const pending = [{ sha: rootSha, prefix: '' }]
    while (pending.length > 0) {
      const folder = pending.pop() as { sha: string; prefix: string }
      const level = await open(folder.sha, true)
      // A single folder with thousands of entries of its own.
      if (level.tooLarge) throw new TooLarge()
      for (const file of level.files) files.push({ ...file, path: folder.prefix + file.path })
      for (const dir of level.dirs) {
        if (isSkippedFolder(dir.path)) {
          unopened++
          continue
        }
        const prefix = `${folder.prefix}${dir.path}/`
        // Most sub-folders are small: take everything below in one request.
        const below = await open(dir.sha, false)
        if (below.tooLarge) pending.push({ sha: dir.sha, prefix })
        else for (const file of below.files) files.push({ ...file, path: prefix + file.path })
      }
    }
    return { files, unopened }
  }

  async function list(input: TreeInput): Promise<RepoFiles> {
    const whole = await ask(treeUrl({ repo: input.repo, sha: input.headOid }))
    const listed = whole.tooLarge
      ? await walk(input.repo, input.headOid)
      : { files: whole.files, unopened: 0 }

    const skipped = noSkips()
    const files: TreeFile[] = []
    for (const file of listed.files) {
      const reason = skipReason(file.path, file.size)
      if (reason) skipped[reason]++
      else files.push(file)
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return {
      repo: input.repo,
      branch: input.branch,
      headOid: input.headOid,
      files,
      skipped,
      unopened: listed.unopened,
    }
  }

  function load(input: TreeInput): Promise<RepoFiles> {
    const key = `${input.repo}@${input.headOid}`
    let pending = cache.get(key)
    if (!pending) {
      pending = list(input)
      // A failed load must not be remembered, so the next try asks again.
      pending.catch(() => cache.delete(key))
      cache.set(key, pending)
    }
    return pending
  }

  async function loadAll(inputs: readonly TreeInput[], onProgress?: Progress): Promise<Loaded> {
    const unique = new Map(inputs.map((input) => [input.repo, input]))
    const trees = new Map<string, RepoFiles>()
    const errors = new Map<string, TreeError>()
    let done = 0
    // All at once: the request queue itself lets only a few run at a time.
    await Promise.all(
      [...unique.values()].map(async (input) => {
        try {
          trees.set(input.repo, await load(input))
        } catch (error) {
          errors.set(input.repo, toTreeError(error))
        }
        onProgress?.(++done, unique.size, input.repo)
      }),
    )
    // Keep sheet order, whatever order the answers came in.
    const ordered = new Map<string, RepoFiles>()
    for (const repo of unique.keys()) {
      const tree = trees.get(repo)
      if (tree) ordered.set(repo, tree)
    }
    return { trees: ordered, errors }
  }

  return { load, loadAll }
}
