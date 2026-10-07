// The first push of each repo, for the download. The register does not need
// it, so it is read when the file is asked for: the push log as far as the
// person screen reads it, and the commits where the log cannot tell. Both are
// kept for the session, so a second download asks for nothing.

import { firstPush, type FirstPush } from '../logic/firstPush.ts'
import { apiRepoName } from '../logic/repoName.ts'
import { loadCommits } from './person.ts'
import { HISTORY_PAGES, loadActivity, repoFacts, type PersonRow } from './store.ts'

async function readFirstPush(key: string): Promise<FirstPush> {
  const known = firstPush(repoFacts(key), undefined)
  // A repo without work has no first push, and a log read to its end has named it.
  if (known.kind === 'none' || known.kind === 'recorded') return known

  await loadActivity(key, HISTORY_PAGES)
  // A refresh drops a log that is being read. It is asked for once more.
  if (!repoFacts(key).activity) await loadActivity(key, HISTORY_PAGES)
  const facts = repoFacts(key)
  const first = firstPush(facts, undefined)
  // Still waiting means the log cannot tell, and the oldest commit stands in.
  if (first.kind !== 'loading' || facts.meta?.state !== 'ok' || !facts.meta.headOid) return first
  const commits = await loadCommits(apiRepoName(facts.meta), facts.meta.headOid).catch(() => null)
  return firstPush(repoFacts(key), commits)
}

/**
 * The first push of every repo these people handed in, by repo. Never fails:
 * a time that could not be read says so itself.
 */
export async function loadFirstPushes(
  people: readonly PersonRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, FirstPush>> {
  const keys = new Set<string>()
  for (const { row } of people) if (row.link.ok) keys.add(row.link.key)

  const firsts = new Map<string, FirstPush>()
  onProgress?.(0, keys.size)
  await Promise.all(
    [...keys].map(async (key) => {
      firsts.set(key, await readFirstPush(key))
      onProgress?.(firsts.size, keys.size)
    }),
  )
  return firsts
}
