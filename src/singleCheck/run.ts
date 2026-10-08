// One-off repo inspection: takes a pasted GitHub link, asks the Worker for the
// repo's facts, and joins them with the oldest push on the default branch,
// the files changed in the head commit, the repo's branches, and the
// contributors breakdown. The contributors breakdown reads one page of the
// default branch's history (the same source the results report and the
// PersonView use), so the wording matches the rest of the app. Pure
// TypeScript so a test can drive it with a stubbed `get` and the screen can
// pass the page-wide `client.get`.

import {
  activityUrl,
  commitUrl,
  commitsUrl,
  reposUrl,
  type ActivityResponse,
  type CommitFilesResponse,
  type CommitInfo,
  type CommitsResponse,
  type ReposResponse,
} from '../../shared/api.ts'
import type { ApiClient } from '../api/client.ts'
import { commitSharesText, countCommitShares } from '../logic/commitShares.ts'
import { client } from '../state/store.ts'
import { LINK_PROBLEM_TEXT, parseRepoLink } from '../sheet/parseRepoLink.ts'
import type { SingleCheckOutcome } from './types.ts'

/** The minimum surface `runSingleCheck` needs from the page-wide API client. */
type Getter = ApiClient['get']

/**
 * Inspects one GitHub repo and returns either a complete result or a
 * structured error. Never throws. Pass an explicit `get` to drive the function
 * with a stubbed client from a test; otherwise the page-wide singleton is used.
 */
export async function runSingleCheck(
  input: string,
  get: Getter = client.get,
): Promise<SingleCheckOutcome> {
  const link = parseRepoLink(input)
  if (!link.ok) return { kind: 'bad_link', reason: LINK_PROBLEM_TEXT[link.reason] }
  const key = link.key

  let repos: ReposResponse
  try {
    repos = await get<ReposResponse>(reposUrl([key]), 0)
  } catch {
    return { kind: 'network' }
  }
  const meta = repos.repos[0]
  if (!meta) return { kind: 'not_found' }
  if (meta.state === 'not_found') return { kind: 'not_found' }
  if (meta.state === 'error') return { kind: 'repo_error', code: meta.code }

  // From here `meta` is `RepoOk`.
  const branch = meta.defaultBranch ?? 'main'
  const headOid = meta.headOid ?? ''

  const [activityResult, filesResult, commitsResult] = await Promise.allSettled([
    get<ActivityResponse>(activityUrl({ repo: key, v: meta.createdAt, ref: branch, asc: true }), 0),
    headOid
      ? get<CommitFilesResponse>(commitUrl({ repo: key, sha: headOid }), 1)
      : Promise.resolve<CommitFilesResponse | null>(null),
    // The /commits route only accepts a SHA `ref` (the GraphQL variable is
    // `GitObjectID`, not `String`), so we ask for one page of history behind
    // the head OID. The dedup-by-oid fan-out we did before was rejected by
    // the Worker on every branch.
    headOid
      ? get<CommitsResponse>(commitsUrl({ repo: key, ref: headOid }), 0)
      : Promise.resolve<CommitsResponse | null>(null),
  ])

  // Activity is required: the spec lists "first push" as a core fact. A repo
  // that has no recorded activity is rare but possible, and we report that
  // honestly instead of hiding the failure behind a generic error.
  if (activityResult.status === 'rejected') return { kind: 'network' }
  const activity = activityResult.value
  const firstPushAt = activity.events[0]?.ts ?? null

  const files: CommitFilesResponse | null =
    filesResult.status === 'fulfilled' ? filesResult.value : null

  // Contributors: one page of the default branch's history. The dedup-by-oid
  // pass is now redundant (one call), but the variables keep the wording
  // uniform if we later add per-branch pages.
  const allCommits: CommitInfo[] = []
  const commits = commitsResult.status === 'fulfilled' ? commitsResult.value : null
  if (commits) {
    for (const commit of commits.commits) allCommits.push(commit)
  }
  const contributors = commits
    ? commitSharesText(
        countCommitShares({ commits: allCommits, truncated: commits.next !== null }),
      )
    : ''
  const contributorsFailed = headOid !== '' && commitsResult.status === 'rejected'

  return {
    key,
    nameWithOwner: meta.nameWithOwner,
    createdAt: meta.createdAt,
    pushedAt: meta.pushedAt,
    firstPushAt,
    defaultBranch: branch,
    headOid,
    files: (files?.files ?? []).map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    })),
    filesTruncated: files?.more ?? false,
    filesTooLarge: files?.tooLarge ?? false,
    branches: meta.branches ?? null,
    contributors,
    contributorsFailed,
  }
}
