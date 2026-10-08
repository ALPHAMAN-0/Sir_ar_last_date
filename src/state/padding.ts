// Which commits are padding, for the report and the person screen. A check
// reads the files of each commit (the same answers the person screen shows)
// and keeps what it found for the session, so that both screens and the
// download read one result, and a second run asks only for what is missing.

import type { CommitInfo } from '../../shared/api.ts'
import { checkOf, moreMayTell, type CommitCheck } from '../logic/padding.ts'
import { apiRepoName } from '../logic/repoName.ts'
import { loadCommits, loadFiles, type FilePage } from './person.ts'
import { repoFacts, type PersonRow } from './store.ts'

/** Pages of files read for one commit at most, while the first ones changed only whitespace. */
export const MAX_KIND_PAGES = 3
/** Commits checked per repo unless all are asked for: the newest ones. */
export const MAX_CHECKED_COMMITS = 200
/** The class-wide check waits behind what the screens ask for. */
const CLASS_PRIORITY = 3

export const NO_CHECKS: ReadonlyMap<string, CommitCheck> = new Map()
const UNKNOWN: CommitCheck = { kind: 'unknown', tiny: false }

// What was found, by repo, then by commit id. A repo's map is replaced, never
// changed, so that a screen can tell by the map itself whether anything is new.
const checks = new Map<string, ReadonlyMap<string, CommitCheck>>()
const running = new Map<string, Promise<CommitCheck>>()
const listeners = new Set<() => void>()
let notifying = false

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** What the check found for a repo's commits. The same map until something new is found. */
export function checksOf(repo: string | null): ReadonlyMap<string, CommitCheck> {
  return (repo && checks.get(repo)) || NO_CHECKS
}

/** Several findings in one go wake the screens once. */
function remember(repo: string, sha: string, check: CommitCheck): void {
  checks.set(repo, new Map(checks.get(repo) ?? []).set(sha, check))
  if (notifying) return
  notifying = true
  queueMicrotask(() => {
    notifying = false
    for (const listener of listeners) listener()
  })
}

/**
 * Reads the files of one commit and says what kind of commit it is. Never
 * rejects: a load that failed answers unknown and is not remembered, so the
 * next run asks again.
 */
export function checkCommit(repo: string, sha: string, priority = 2): Promise<CommitCheck> {
  const known = checks.get(repo)?.get(sha)
  if (known) return Promise.resolve(known)
  const key = `${repo}@${sha}`
  let run = running.get(key)
  if (!run) {
    run = (async () => {
      try {
        const pages: FilePage[] = [await loadFiles(repo, sha, 1, priority)]
        while (moreMayTell(pages) && pages.length < MAX_KIND_PAGES) {
          pages.push(await loadFiles(repo, sha, pages.length + 1, priority))
        }
        const check = checkOf(pages)
        remember(repo, sha, check)
        return check
      } catch {
        return UNKNOWN
      } finally {
        running.delete(key)
      }
    })()
    running.set(key, run)
  }
  return run
}

export type CheckOptions = {
  /** How many of the newest commits to check; the list's length for all of them. */
  limit?: number
  priority?: number
  onProgress?: (done: number, total: number) => void
}

/** Checks the newest commits of one repo. Commits already known cost nothing. Never fails. */
export async function checkRepo(
  repo: string,
  commits: readonly CommitInfo[],
  options: CheckOptions = {},
): Promise<void> {
  const chosen = commits.slice(0, options.limit ?? MAX_CHECKED_COMMITS)
  let done = 0
  options.onProgress?.(0, chosen.length)
  await Promise.all(
    chosen.map(async (commit) => {
      await checkCommit(repo, commit.oid, options.priority)
      options.onProgress?.(++done, chosen.length)
    }),
  )
}

export type PaddingProgress = {
  /** First the commit lists, one per repo; then the files, one per commit. */
  phase: 'lists' | 'files'
  done: number
  total: number
}

/**
 * Checks every repo with work among these people: its commit list, then the
 * newest commits. Never fails: what could not be read stays not checked.
 */
export async function loadPadding(
  people: readonly PersonRow[],
  onProgress?: (progress: PaddingProgress) => void,
): Promise<void> {
  // By the repo's current name, as the lists and files are kept: a repo handed in twice is read once.
  const heads = new Map<string, string>()
  for (const { row } of people) {
    if (!row.link.ok) continue
    const { meta, verdict } = repoFacts(row.link.key)
    if (meta?.state !== 'ok' || verdict.status === 'no_submission' || !meta.headOid) continue
    heads.set(apiRepoName(meta), meta.headOid)
  }

  let listed = 0
  onProgress?.({ phase: 'lists', done: 0, total: heads.size })
  const lists = await Promise.all(
    [...heads].map(async ([repo, headOid]) => {
      const list = await loadCommits(repo, headOid).catch(() => null)
      onProgress?.({ phase: 'lists', done: ++listed, total: heads.size })
      return list ? { repo, commits: list.commits.slice(0, MAX_CHECKED_COMMITS) } : null
    }),
  )

  const work = lists.filter((entry) => entry !== null)
  const total = work.reduce((sum, entry) => sum + entry.commits.length, 0)
  let done = 0
  onProgress?.({ phase: 'files', done: 0, total })
  await Promise.all(
    work.flatMap((entry) =>
      entry.commits.map(async (commit) => {
        await checkCommit(entry.repo, commit.oid, CLASS_PRIORITY)
        onProgress?.({ phase: 'files', done: ++done, total })
      }),
    ),
  )
}
