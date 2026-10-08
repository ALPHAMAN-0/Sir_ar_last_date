// The contract between the browser and the Worker: routes, canonical URLs and
// response shapes. Both sides build URLs with these functions so that every
// request has exactly one spelling, which keeps the edge cache key stable.

import {
  isActivityCursor,
  isBranchName,
  isCommitCursor,
  isIsoTime,
  isRepoKey,
  isSha,
} from './validate.ts'

export const API_BASE = '/api/v1'
export const MAX_REPOS_PER_CALL = 20
export const MAX_FILE_PAGE = 30

export type RepoOk = {
  key: string
  state: 'ok'
  nameWithOwner: string
  isEmpty: boolean
  isFork: boolean
  isArchived: boolean
  createdAt: string
  pushedAt: string | null
  defaultBranch: string | null
  headOid: string | null
  headCommittedAt: string | null
  totalCommits: number
  /**
   * The repo this one was forked from, as GitHub spells it. Null when it is no
   * fork or GitHub hides the parent; missing when an older answer did not say.
   */
  parent?: string | null
  /** The template repo this one was generated from, if any. */
  template?: string | null
}
export type RepoMeta =
  | RepoOk
  | { key: string; state: 'not_found' }
  | { key: string; state: 'error'; code: string }
export type ReposResponse = { fetchedAt: string; repos: RepoMeta[] }

export type ActivityEvent = {
  ts: string
  type: string
  ref: string
  before: string
  after: string
  actor: string | null
}
export type ActivityResponse = {
  fetchedAt: string
  /** False while the push is so recent that GitHub's log may still be catching up. */
  settled: boolean
  events: ActivityEvent[]
  next: string | null
}

export type CommitInfo = {
  oid: string
  committedAt: string
  authoredAt: string
  headline: string
  parents: string[]
  authorName: string | null
  authorLogin: string | null
}
export type CommitsResponse = { commits: CommitInfo[]; next: string | null }

export type FileChange = {
  path: string
  status: string
  additions: number
  deletions: number
  previousPath?: string
  /**
   * True when the file's text changed beyond whitespace; false when only
   * whitespace, or nothing, changed (a pure rename included). Missing when the
   * Worker cannot tell: a binary file, or a diff GitHub left out.
   */
  realChange?: boolean
}
export type CommitFilesResponse = {
  sha: string
  stats: { additions: number; deletions: number } | null
  files: FileChange[]
  /** More files exist on a further page. */
  more: boolean
  /** The commit is too big to list here; open it on GitHub instead. */
  tooLarge: boolean
}

export type QuotaInfo = { remaining: number; limit: number; resetAt: string }
export type StatusResponse = {
  fetchedAt: string
  core: QuotaInfo | null
  graphql: QuotaInfo | null
  reserve: number
}

export type ApiErrorBody = {
  error: { code: string; message: string; retryAfter?: number; resetAt?: string }
}

export type ActivityParams = {
  repo: string
  /** The repo's pushedAt, used as a version so the answer can be cached. */
  v: string
  /** Branch name. Omitted for the all-branches probe. */
  ref?: string
  /** Oldest first. Default is newest first. */
  asc?: boolean
  after?: string
}
export type CommitsParams = { repo: string; ref: string; after?: string }
export type CommitParams = { repo: string; sha: string; page?: number }
export type TreeParams = {
  repo: string
  /** A commit id, or the id of one folder inside it. */
  sha: string
  /** List one folder level only, with its sub-folders. Default is every file below. */
  flat?: boolean
}
/** One file. `sha` is git's hash of the content: equal content, equal hash, in any repo. */
export type TreeFile = { path: string; sha: string; size: number }
export type TreeDir = { path: string; sha: string }
export type TreeResponse = {
  files: TreeFile[]
  /** Sub-folders. Filled only for a flat request. */
  dirs: TreeDir[]
  /** Too many files for one answer. Ask again folder by folder, with `flat`. */
  tooLarge: boolean
}

const enc = encodeURIComponent

function join(parts: Array<string | null>): string {
  return parts.filter((part): part is string => part !== null).join('&')
}

export function canonicalRepoKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)].sort()
}

export function reposQuery(keys: readonly string[]): string {
  return canonicalRepoKeys(keys)
    .map((key) => `r=${enc(key)}`)
    .join('&')
}

export function activityQuery(p: ActivityParams): string {
  return join([
    `repo=${enc(p.repo)}`,
    `v=${enc(p.v)}`,
    p.ref !== undefined ? `ref=${enc(p.ref)}` : null,
    p.asc ? 'dir=asc' : null,
    p.after !== undefined ? `after=${enc(p.after)}` : null,
  ])
}

export function commitsQuery(p: CommitsParams): string {
  return join([
    `repo=${enc(p.repo)}`,
    `ref=${enc(p.ref)}`,
    p.after !== undefined ? `after=${enc(p.after)}` : null,
  ])
}

export function commitQuery(p: CommitParams): string {
  return join([
    `repo=${enc(p.repo)}`,
    `sha=${enc(p.sha)}`,
    p.page !== undefined && p.page > 1 ? `page=${p.page}` : null,
  ])
}

export function treeQuery(p: TreeParams): string {
  return join([`repo=${enc(p.repo)}`, `sha=${enc(p.sha)}`, p.flat ? 'flat=1' : null])
}

export const reposUrl = (keys: readonly string[]) => `${API_BASE}/repos?${reposQuery(keys)}`
export const activityUrl = (p: ActivityParams) => `${API_BASE}/activity?${activityQuery(p)}`
export const commitsUrl = (p: CommitsParams) => `${API_BASE}/commits?${commitsQuery(p)}`
export const commitUrl = (p: CommitParams) => `${API_BASE}/commit?${commitQuery(p)}`
export const treeUrl = (p: TreeParams) => `${API_BASE}/tree?${treeQuery(p)}`
export const statusUrl = () => `${API_BASE}/status`

// Parsers used by the Worker. Each returns null unless every value is valid AND
// the query string is spelled exactly the way the builders above spell it.

function only(params: URLSearchParams, allowed: readonly string[]): boolean {
  for (const name of params.keys()) if (!allowed.includes(name)) return false
  return true
}

function single(params: URLSearchParams, name: string): string | undefined | null {
  const all = params.getAll(name)
  if (all.length === 0) return undefined
  return all.length === 1 ? all[0] : null
}

export function parseReposQuery(search: string): string[] | null {
  const params = new URLSearchParams(search)
  if (!only(params, ['r'])) return null
  const keys = params.getAll('r')
  if (keys.length === 0 || keys.length > MAX_REPOS_PER_CALL) return null
  if (!keys.every(isRepoKey)) return null
  return `?${reposQuery(keys)}` === search && canonicalRepoKeys(keys).length === keys.length
    ? keys
    : null
}

export function parseActivityQuery(search: string): ActivityParams | null {
  const params = new URLSearchParams(search)
  if (!only(params, ['repo', 'v', 'ref', 'dir', 'after'])) return null
  const repo = single(params, 'repo')
  const v = single(params, 'v')
  const ref = single(params, 'ref')
  const dir = single(params, 'dir')
  const after = single(params, 'after')
  if (!repo || !isRepoKey(repo) || !v || !isIsoTime(v)) return null
  if (ref === null || (ref !== undefined && !isBranchName(ref))) return null
  if (dir === null || (dir !== undefined && dir !== 'asc')) return null
  if (after === null || (after !== undefined && !isActivityCursor(after))) return null
  const parsed: ActivityParams = { repo, v }
  if (ref !== undefined) parsed.ref = ref
  if (dir === 'asc') parsed.asc = true
  if (after !== undefined) parsed.after = after
  return `?${activityQuery(parsed)}` === search ? parsed : null
}

export function parseCommitsQuery(search: string): CommitsParams | null {
  const params = new URLSearchParams(search)
  if (!only(params, ['repo', 'ref', 'after'])) return null
  const repo = single(params, 'repo')
  const ref = single(params, 'ref')
  const after = single(params, 'after')
  if (!repo || !isRepoKey(repo) || !ref || !isSha(ref)) return null
  if (after === null || (after !== undefined && !isCommitCursor(after, ref))) return null
  const parsed: CommitsParams = { repo, ref }
  if (after !== undefined) parsed.after = after
  return `?${commitsQuery(parsed)}` === search ? parsed : null
}

export function parseCommitQuery(search: string): CommitParams | null {
  const params = new URLSearchParams(search)
  if (!only(params, ['repo', 'sha', 'page'])) return null
  const repo = single(params, 'repo')
  const sha = single(params, 'sha')
  const pageText = single(params, 'page')
  if (!repo || !isRepoKey(repo) || !sha || !isSha(sha)) return null
  if (pageText === null) return null
  const parsed: CommitParams = { repo, sha }
  if (pageText !== undefined) {
    if (!/^[1-9]\d?$/.test(pageText)) return null
    const page = Number(pageText)
    if (page < 2 || page > MAX_FILE_PAGE) return null
    parsed.page = page
  }
  return `?${commitQuery(parsed)}` === search ? parsed : null
}

export function parseTreeQuery(search: string): TreeParams | null {
  const params = new URLSearchParams(search)
  if (!only(params, ['repo', 'sha', 'flat'])) return null
  const repo = single(params, 'repo')
  const sha = single(params, 'sha')
  const flat = single(params, 'flat')
  if (!repo || !isRepoKey(repo) || !sha || !isSha(sha)) return null
  if (flat === null || (flat !== undefined && flat !== '1')) return null
  const parsed: TreeParams = { repo, sha }
  if (flat === '1') parsed.flat = true
  return `?${treeQuery(parsed)}` === search ? parsed : null
}
