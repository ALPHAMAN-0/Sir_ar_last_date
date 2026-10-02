// Works out when each commit reached GitHub, by walking the commit graph from
// every push event. The order of the commit list is not used: it follows dates
// that the author controls.

import type { ActivityEvent, CommitInfo } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'

export type PushInfo = {
  /** When GitHub first received this commit on the branch. null if unknown. */
  pushedAt: string | null
  /** When pushedAt is unknown: the commit was already there before this time. */
  knownBefore: string | null
}

/**
 * @param commits the branch history (any order), each with its parents
 * @param events push events for the same branch (any order)
 */
export function attributePushes(
  commits: readonly CommitInfo[],
  events: readonly ActivityEvent[],
): Map<string, PushInfo> {
  const byOid = new Map(commits.map((commit) => [commit.oid, commit]))
  const result = new Map<string, PushInfo>()

  const walk = (start: string, info: PushInfo) => {
    const stack = [start]
    while (stack.length > 0) {
      const oid = stack.pop() as string
      if (result.has(oid)) continue
      const commit = byOid.get(oid)
      if (!commit) continue
      result.set(oid, info)
      stack.push(...commit.parents)
    }
  }

  const oldestFirst = events
    .filter((event) => event.after !== ZERO_OID)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))

  // Whatever the branch held before the first known event was pushed earlier.
  const oldest = oldestFirst[0]
  if (oldest && oldest.before !== ZERO_OID) {
    walk(oldest.before, { pushedAt: null, knownBefore: oldest.ts })
  }
  // Each commit belongs to the earliest push that contained it.
  for (const event of oldestFirst) {
    walk(event.after, { pushedAt: event.ts, knownBefore: null })
  }
  return result
}

/** True when the commit reached GitHub after the deadline. null when it cannot be known. */
export function arrivedLate(info: PushInfo | undefined, deadline: number | null): boolean | null {
  if (deadline === null || !info) return null
  if (info.pushedAt !== null) return Date.parse(info.pushedAt) > deadline
  if (info.knownBefore !== null && Date.parse(info.knownBefore) <= deadline) return false
  return null
}
