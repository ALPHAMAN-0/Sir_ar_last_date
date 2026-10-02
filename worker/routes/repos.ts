import type { RepoMeta, ReposResponse } from '../../shared/api.ts'
import { splitRepoKey } from '../../shared/validate.ts'
import { graphql } from '../github.ts'
import { ApiErr, CACHE, json } from '../http.ts'
import { reposDocument } from '../queries.ts'

type RawRepo = {
  nameWithOwner: string
  isEmpty: boolean
  isFork: boolean
  isArchived: boolean
  createdAt: string
  pushedAt: string | null
  defaultBranchRef: {
    name: string
    target: { oid?: string; committedDate?: string; history?: { totalCount: number } } | null
  } | null
}

function toMeta(key: string, raw: RawRepo): RepoMeta {
  const head = raw.defaultBranchRef?.target ?? null
  return {
    key,
    state: 'ok',
    nameWithOwner: raw.nameWithOwner,
    isEmpty: raw.isEmpty,
    isFork: raw.isFork,
    isArchived: raw.isArchived,
    createdAt: raw.createdAt,
    pushedAt: raw.pushedAt ?? null,
    defaultBranch: raw.defaultBranchRef?.name ?? null,
    headOid: head?.oid ?? null,
    headCommittedAt: head?.committedDate ?? null,
    totalCommits: head?.history?.totalCount ?? 0,
  }
}

/** Basic facts for up to 20 repos in one GraphQL call (one quota point). */
export async function handleRepos(env: Env, keys: string[]): Promise<Response> {
  const variables: Record<string, string> = {}
  keys.forEach((key, i) => {
    const { owner, name } = splitRepoKey(key)
    variables[`o${i}`] = owner
    variables[`n${i}`] = name
  })

  const { data, errors } = await graphql<Record<string, RawRepo | null>>(
    env,
    reposDocument(keys.length),
    variables,
  )
  if (!data) throw new ApiErr(502, 'github_error', 'GitHub could not answer. Please try again.')

  const errorType = new Map<string, string>()
  for (const error of errors) {
    const alias = error.path?.[0]
    if (typeof alias === 'string') errorType.set(alias, error.type ?? 'UNKNOWN')
  }

  const repos = keys.map((key, i): RepoMeta => {
    const alias = `r${i}`
    const raw = data[alias]
    if (raw) return toMeta(key, raw)
    // Only a real NOT_FOUND may be shown as "Not found"; anything else is a
    // temporary failure and must be retried, not blamed on the student.
    const type = errorType.get(alias)
    return type === 'NOT_FOUND'
      ? { key, state: 'not_found' }
      : { key, state: 'error', code: (type ?? 'unknown').toLowerCase() }
  })

  const body: ReposResponse = { fetchedAt: new Date().toISOString(), repos }
  const hasError = repos.some((repo) => repo.state === 'error')
  return json(body, CACHE.edge(hasError ? 10 : 60))
}
