// Reads how a repo came to hold its files: GitHub's push log of every branch,
// oldest first, and the file list at each pushed commit in that order.
//
// Reading stops as soon as every file that is looked for has been seen. A file
// can only be seen "for the first time" once, so later pushes change nothing.
// Because the pushes are read in order and on every branch, a file that was
// removed and put back, or first pushed to a side branch, is dated correctly.
//
// A file list is addressed by commit id, so it never changes: the browser and
// Cloudflare's edge keep it, and a second look at the same class costs nothing.

import { activityUrl, treeUrl, type ActivityEvent, type ActivityResponse } from '../../shared/api.ts'
import { ApiError } from '../api/client.ts'
import { digest, readLog, type Digest, type RepoHistory } from './first.ts'
import type { RepoFacts } from './run.ts'
import { askPatiently, askTree, type Get } from './trees.ts'
import type { RepoFiles } from './types.ts'

/** Histories wait behind everything else in the request queue. */
const PRIORITY = 3
/** 100 pushes a page. A repo with more is read up to here and says so. */
export const MAX_LOG_PAGES = 2
/** What one repo may cost. A student repo rarely has more pushes than this. */
export const MAX_SNAPSHOTS_PER_REPO = 40

/**
 * The shared budget of one comparison run. `take` answers false once it is
 * spent, and reading stops there until somebody asks again with a new one.
 */
export type Allowance = { take(): boolean }

export type HistoryLoader = {
  /**
   * Reads the repo's history far enough to have seen every content in `need`
   * arrive. Never fails: what could not be read is written into the answer.
   * A later call that needs more goes on where the last one stopped.
   */
  ensure(facts: RepoFacts, head: RepoFiles, need: ReadonlySet<string>, allowance: Allowance): Promise<RepoHistory>
  /** What is known so far, without asking for anything. */
  peek(repo: string, headOid: string): RepoHistory | undefined
}

type Entry = {
  facts: RepoFacts
  head: RepoFiles
  history: RepoHistory | null
  /** One file list per commit, however many pushes point at it. */
  byCommit: Map<string, Digest>
  /** Contents seen so far in the pushes read. */
  seen: Set<string>
  requests: number
  /** Calls for one repo run one after the other. */
  tail: Promise<unknown>
}

export function createHistoryLoader(
  get: Get,
  limits: { pages?: number; snapshots?: number } = {},
): HistoryLoader {
  const maxPages = limits.pages ?? MAX_LOG_PAGES
  const maxSnapshots = limits.snapshots ?? MAX_SNAPSHOTS_PER_REPO
  const entries = new Map<string, Entry>()

  async function readPushLog(facts: RepoFacts): Promise<RepoHistory> {
    const empty: RepoHistory = {
      repo: facts.repo,
      headOid: facts.headOid,
      log: 'failed',
      pushes: [],
      logComplete: false,
      startKnown: false,
      trusted: 0,
      scanned: 0,
      digests: [],
      stopped: null,
    }
    const events: ActivityEvent[] = []
    let after: string | undefined
    let complete = false
    let settled = true
    for (let page = 0; page < maxPages; page++) {
      let body: ActivityResponse
      try {
        // Spelled like the register's own first look at the log, so that one is shared.
        const url = activityUrl({ repo: facts.repo, v: facts.version, asc: true, after })
        body = await askPatiently<ActivityResponse>(get, url, PRIORITY)
        if (!body || !Array.isArray(body.events)) throw new ApiError(502, 'malformed', 'Unreadable push log.')
      } catch {
        if (page === 0) return empty
        // The pages read so far are still a true beginning of the log.
        break
      }
      events.push(...body.events)
      if (body.settled === false) settled = false
      if (!body.next) {
        complete = true
        break
      }
      after = body.next
    }
    // GitHub's log can lag a fresh push. An incomplete log proves nothing.
    if (!settled) return { ...empty, log: 'unsettled' }
    const read = readLog(events, facts)
    if (read.pushes.length === 0) return { ...empty, log: 'none', logComplete: complete }
    return { ...empty, log: 'ok', ...read, logComplete: complete }
  }

  async function advance(entry: Entry, need: ReadonlySet<string>, allowance: Allowance): Promise<RepoHistory> {
    const { facts, head } = entry
    // A log that failed, or was still settling, is asked for again.
    if (!entry.history || entry.history.log === 'failed' || entry.history.log === 'unsettled') {
      entry.history = await readPushLog(facts)
    }
    if (entry.history.log !== 'ok') return entry.history

    const { pushes, logComplete } = entry.history
    const digests = [...entry.history.digests]
    let stopped = entry.history.stopped
    // Too large, gone, or over the cap: asking again would end the same way.
    const final = stopped === 'too_large' || stopped === 'gone' || stopped === 'cap'
    const allSeen = () => {
      for (const sha of need) if (!entry.seen.has(sha)) return false
      return true
    }

    while (!final) {
      if (allSeen()) {
        stopped = 'all_seen'
        break
      }
      if (digests.length >= pushes.length) {
        stopped = logComplete ? 'end' : 'cap'
        break
      }
      const commit = pushes[digests.length].after
      let found = entry.byCommit.get(commit)
      if (!found) {
        if (entry.requests >= maxSnapshots) {
          stopped = 'cap'
          break
        }
        if (!allowance.take()) {
          stopped = 'budget'
          break
        }
        entry.requests++
        try {
          // The whole listing in one request, unfiltered: a file that once sat
          // in a folder the comparison skips was still there.
          const listing = await askTree(get, treeUrl({ repo: facts.repo, sha: commit }), PRIORITY)
          if (listing.tooLarge) {
            stopped = 'too_large'
            break
          }
          found = digest(listing.files, head)
          entry.byCommit.set(commit, found)
        } catch (error) {
          // A commit that a force push removed can disappear from GitHub.
          stopped = error instanceof ApiError && error.status === 404 ? 'gone' : 'failed'
          break
        }
      }
      digests.push(found)
      for (const sha of found.held) entry.seen.add(sha)
    }

    entry.history = { ...entry.history, scanned: digests.length, digests, stopped }
    return entry.history
  }

  function ensure(
    facts: RepoFacts,
    head: RepoFiles,
    need: ReadonlySet<string>,
    allowance: Allowance,
  ): Promise<RepoHistory> {
    const key = `${facts.repo}@${facts.headOid}`
    let entry = entries.get(key)
    if (!entry) {
      entry = { facts, head, history: null, byCommit: new Map(), seen: new Set(), requests: 0, tail: Promise.resolve() }
      entries.set(key, entry)
    }
    const current = entry
    const run = current.tail.then(() => advance(current, need, allowance))
    current.tail = run.catch(() => undefined)
    return run
  }

  return {
    ensure,
    peek: (repo, headOid) => entries.get(`${repo}@${headOid}`)?.history ?? undefined,
  }
}
