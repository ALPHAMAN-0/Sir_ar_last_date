// Who committed on each repo, for the download. The register does not need
// it, so it is read when the file is asked for: the same commit lists the
// person screen reads, kept for the session, so a second download asks for nothing.

import { countCommitShares, type CommitShares } from '../logic/commitShares.ts'
import { apiRepoName } from '../logic/repoName.ts'
import { loadCommits } from './person.ts'
import { repoFacts, type PersonRow } from './store.ts'

async function readCommitShares(key: string): Promise<CommitShares> {
  const { meta, verdict } = repoFacts(key)
  // As for the first push: no work, not found, or not checked means nobody's commits to count.
  if (meta?.state !== 'ok' || verdict.status === 'no_submission' || !meta.headOid) return { kind: 'none' }
  try {
    return countCommitShares(await loadCommits(apiRepoName(meta), meta.headOid))
  } catch {
    return { kind: 'failed' }
  }
}

/**
 * Who committed on every repo these people handed in, by repo. Never fails:
 * a list that could not be read says so itself.
 */
export async function loadCommitShares(
  people: readonly PersonRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, CommitShares>> {
  const keys = new Set<string>()
  for (const { row } of people) if (row.link.ok) keys.add(row.link.key)

  const shares = new Map<string, CommitShares>()
  onProgress?.(0, keys.size)
  await Promise.all(
    [...keys].map(async (key) => {
      shares.set(key, await readCommitShares(key))
      onProgress?.(shares.size, keys.size)
    }),
  )
  return shares
}
