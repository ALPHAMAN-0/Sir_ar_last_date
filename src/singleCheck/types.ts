// Result and error shapes for a one-off repo inspection. Kept separate from
// the orchestrator so React components and tests can import just the types.

import type { RepoBranches } from '../../shared/api.ts'

export type SingleCheckFile = {
  path: string
  additions: number
  deletions: number
}

export type SingleCheckResult = {
  key: string
  nameWithOwner: string
  createdAt: string
  pushedAt: string | null
  firstPushAt: string | null
  defaultBranch: string
  headOid: string
  files: SingleCheckFile[]
  filesTruncated: boolean
  filesTooLarge: boolean
  /**
   * The repo's branches A to Z (first 100), or null when the Worker did not
   * say. The default branch is listed first; `total` may be larger than
   * `names.length` when the repo has more.
   */
  branches: RepoBranches | null
  /**
   * Pre-formatted "person N (P%, M merges)" text across every branch, or ''
   * when no commits could be read. Built by `commitSharesText` so the
   * SingleCheck panel uses the same wording as the report.
   */
  contributors: string
  /**
   * True when every per-branch /commits call rejected. The panel then shows
   * a "Could not be loaded" hint next to Contributors instead of an empty
   * cell. False when there were no branches to ask, or some calls succeeded.
   */
  contributorsFailed: boolean
}

export type SingleCheckError =
  | { kind: 'bad_link'; reason: string }
  | { kind: 'not_found' }
  | { kind: 'repo_error'; code: string }
  | { kind: 'network' }

export type SingleCheckOutcome = SingleCheckResult | SingleCheckError
