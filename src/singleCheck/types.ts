// Result and error shapes for a one-off repo inspection. Kept separate from
// the orchestrator so React components and tests can import just the types.

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
}

export type SingleCheckError =
  | { kind: 'bad_link'; reason: string }
  | { kind: 'not_found' }
  | { kind: 'repo_error'; code: string }
  | { kind: 'network' }

export type SingleCheckOutcome = SingleCheckResult | SingleCheckError
