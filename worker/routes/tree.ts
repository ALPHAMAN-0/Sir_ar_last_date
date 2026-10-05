import type { TreeParams, TreeResponse } from '../../shared/api.ts'
import { splitRepoKey } from '../../shared/validate.ts'
import { rest } from '../github.ts'
import { ApiErr, CACHE, json } from '../http.ts'

type RawTreeEntry = { path?: string; type?: string }
type RawTree = { tree?: RawTreeEntry[]; truncated?: boolean }

/**
 * Returns just the blob paths of one repo at one commit. The browser used to
 * fetch `git/trees/{sha}?recursive=1` directly, but GitHub's CORS rules reject
 * the preflight for non-GitHub origins. This route is the in-between: the
 * browser calls `/api/v1/tree` on its own origin, and the Worker hits GitHub
 * with the shared token. The 60 s edge cache keeps the cost negligible for
 * repeat visits to the same sheet.
 */
export async function handleTree(env: Env, params: TreeParams): Promise<Response> {
  const { owner, name } = splitRepoKey(params.repo)
  const res = await rest(env, `/repos/${owner}/${name}/git/trees/${params.sha}?recursive=1`)

  if (res.status === 404) {
    throw new ApiErr(404, 'repo_or_sha_not_found', 'Repo or commit not found.', { cache: CACHE.edge(60) })
  }
  if (!res.ok) {
    throw new ApiErr(502, 'github_error', `GitHub answered with status ${res.status}.`)
  }

  const raw = (await res.json().catch(() => null)) as RawTree | null
  if (!raw || !Array.isArray(raw.tree)) {
    throw new ApiErr(502, 'github_error', 'GitHub sent an unreadable answer.')
  }

  const seen = new Set<string>()
  for (const entry of raw.tree) {
    if (entry.type === 'blob' && typeof entry.path === 'string') seen.add(entry.path)
  }
  const body: TreeResponse = {
    fetchedAt: new Date().toISOString(),
    paths: [...seen].sort(),
    truncated: raw.truncated === true,
  }
  return json(body, CACHE.edge(60))
}