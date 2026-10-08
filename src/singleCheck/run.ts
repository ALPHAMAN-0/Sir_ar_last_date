// One-off repo inspection: takes a pasted GitHub link, asks the Worker for the
// repo's facts, and joins them with the oldest push on the default branch,
// the files changed in the head commit, the repo's branches, and the
// contributors breakdown across every branch. Pure TypeScript so a test can
// drive it with a stubbed `get` and the screen can pass the page-wide
// `client.get`.

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
  // Fan the contributors fetch out across every branch the Worker reported,
  // so a commit that lands on two branches is still counted once. Fall back
  // to the default branch when the Worker did not say (older answer, or a
  // brand-new repo with no head yet).
  const branchNames = meta.branches?.names?.length ? meta.branches.names : [branch]

  const [activityResult, filesResult, commitsResult] = await Promise.allSettled([
    get<ActivityResponse>(activityUrl({ repo: key, v: meta.createdAt, ref: branch, asc: true }), 0),
    headOid
      ? get<CommitFilesResponse>(commitUrl({ repo: key, sha: headOid }), 1)
      : Promise.resolve<CommitFilesResponse | null>(null),
    headOid
      ? Promise.allSettled(
          branchNames.map((ref) => get<CommitsResponse>(commitsUrl({ repo: key, ref }), 0)),
        )
      : Promise.resolve<PromiseSettledResult<CommitsResponse>[]>([]),
  ])

  // Activity is required: the spec lists "first push" as a core fact. A repo
  // that has no recorded activity is rare but possible, and we report that
  // honestly instead of hiding the failure behind a generic error.
  if (activityResult.status === 'rejected') return { kind: 'network' }
  const activity = activityResult.value
  const firstPushAt = activity.events[0]?.ts ?? null

  const files: CommitFilesResponse | null =
    filesResult.status === 'fulfilled' ? filesResult.value : null

  // Dedup the contributors fan-out by commit oid: a commit that exists on
  // multiple branches is one commit, not two. An empty `commitsResult` means
  // the repo had no head (new repo, no work yet), which is success not
  // failure — leave the cell blank, and don't flag it as a load error.
  const seenOids = new Set<string>()
  const allCommits: CommitInfo[] = []
  const perBranchCommits = commitsResult.status === 'fulfilled' ? commitsResult.value : []
  let anyCommitOk = false
  let truncated = false
  for (const r of perBranchCommits) {
    if (r.status !== 'fulfilled') continue
    anyCommitOk = true
    if (r.value.next !== null) truncated = true
    for (const commit of r.value.commits) {
      if (seenOids.has(commit.oid)) continue
      seenOids.add(commit.oid)
      allCommits.push(commit)
    }
  }
  const contributors = anyCommitOk
    ? commitSharesText(countCommitShares({ commits: allCommits, truncated }))
    : ''
  const contributorsFailed =
    perBranchCommits.length > 0 && perBranchCommits.every((r) => r.status === 'rejected')

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
