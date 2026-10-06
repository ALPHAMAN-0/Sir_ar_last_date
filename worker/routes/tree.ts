import type { TreeDir, TreeFile, TreeParams, TreeResponse } from '../../shared/api.ts'
import { isSha, splitRepoKey } from '../../shared/validate.ts'
import { rest } from '../github.ts'
import { ApiErr, CACHE, json } from '../http.ts'
import { readTextCapped } from '../readCapped.ts'

// About 4,000 files. A repo with `node_modules` committed can list 100,000;
// that body must never reach JSON.parse on the free plan's CPU budget.
const MAX_BODY_BYTES = 1_000_000

type RawEntry = { path?: string; type?: string; sha?: string; size?: number }
type RawTree = { tree?: RawEntry[]; truncated?: boolean }

const TOO_LARGE: TreeResponse = { files: [], dirs: [], tooLarge: true }

/**
 * The files of one repo at one commit: path, content hash and size. No content.
 * The browser cannot ask GitHub itself (the page's security policy allows only
 * its own origin), so it asks here and the Worker asks GitHub with the token.
 *
 * The answer is addressed by commit id, so it never changes and is cached long.
 * A listing that is too big is answered with `tooLarge`; the page then walks
 * the repo folder by folder with `flat`, skipping folders it does not need.
 */
export async function handleTree(env: Env, params: TreeParams): Promise<Response> {
  const { owner, name } = splitRepoKey(params.repo)
  const res = await rest(
    env,
    `/repos/${owner}/${name}/git/trees/${params.sha}${params.flat ? '' : '?recursive=1'}`,
  )
  // 404: no such repo. 422: no such commit. 409: the repo is empty.
  if (res.status === 404 || res.status === 422 || res.status === 409) {
    throw new ApiErr(404, 'repo_or_sha_not_found', 'Repo or commit not found.', {
      cache: CACHE.edge(60),
    })
  }
  if (!res.ok) throw new ApiErr(502, 'github_error', `GitHub answered with status ${res.status}.`)

  const text = await readTextCapped(res, MAX_BODY_BYTES)
  if (text === null) return json(TOO_LARGE, CACHE.immutable)

  let raw: RawTree
  try {
    raw = JSON.parse(text) as RawTree
  } catch {
    throw new ApiErr(502, 'github_error', 'GitHub sent an unreadable answer.')
  }
  if (!raw || !Array.isArray(raw.tree)) {
    throw new ApiErr(502, 'github_error', 'GitHub sent an unreadable answer.')
  }
  // GitHub cuts its own listing short past 100,000 entries.
  if (raw.truncated === true) return json(TOO_LARGE, CACHE.immutable)

  const files: TreeFile[] = []
  const dirs: TreeDir[] = []
  for (const entry of raw.tree) {
    if (typeof entry.path !== 'string' || typeof entry.sha !== 'string' || !isSha(entry.sha)) continue
    if (entry.type === 'blob') {
      const size = Number(entry.size ?? 0)
      files.push({ path: entry.path, sha: entry.sha, size: Number.isFinite(size) ? size : 0 })
    } else if (entry.type === 'tree' && params.flat) {
      dirs.push({ path: entry.path, sha: entry.sha })
    }
  }
  const body: TreeResponse = { files, dirs, tooLarge: false }
  return json(body, CACHE.immutable)
}
