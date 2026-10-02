import type { CommitFilesResponse, CommitParams, FileChange } from '../../shared/api.ts'
import { splitRepoKey } from '../../shared/validate.ts'
import { rest } from '../github.ts'
import { ApiErr, CACHE, json } from '../http.ts'
import { readTextCapped } from '../readCapped.ts'

const FILES_PER_PAGE = 30
// GitHub includes the full diff text of every file. Bodies above this size are
// not parsed, to stay inside the free plan's CPU budget.
const MAX_BODY_BYTES = 1_000_000

type RawFile = {
  filename?: string
  status?: string
  additions?: number
  deletions?: number
  previous_filename?: string
}
type RawCommit = { stats?: { additions?: number; deletions?: number }; files?: RawFile[] }

/** The files changed by one commit: path, kind of change and line counts. No diff text. */
export async function handleCommit(env: Env, params: CommitParams): Promise<Response> {
  const { owner, name } = splitRepoKey(params.repo)
  const page = params.page ?? 1
  const res = await rest(
    env,
    `/repos/${owner}/${name}/commits/${params.sha}?per_page=${FILES_PER_PAGE}&page=${page}`,
  )
  if (res.status === 404 || res.status === 422) {
    throw new ApiErr(404, 'commit_not_found', 'This commit was not found.', {
      cache: CACHE.edge(60),
    })
  }
  const tooLarge: CommitFilesResponse = {
    sha: params.sha,
    stats: null,
    files: [],
    more: false,
    tooLarge: true,
  }
  // GitHub documents that very large diffs can time out with a 5xx.
  if (res.status >= 500) return json(tooLarge, CACHE.edge(600))
  if (!res.ok) throw new ApiErr(502, 'github_error', `GitHub answered with status ${res.status}.`)

  const more = /rel="next"/.test(res.headers.get('link') ?? '')
  const text = await readTextCapped(res, MAX_BODY_BYTES)
  if (text === null) return json(tooLarge, CACHE.immutable)

  let raw: RawCommit
  try {
    raw = JSON.parse(text) as RawCommit
  } catch {
    throw new ApiErr(502, 'github_error', 'GitHub sent an unreadable answer.')
  }

  const files: FileChange[] = []
  for (const file of raw.files ?? []) {
    if (typeof file.filename !== 'string') continue
    const change: FileChange = {
      path: file.filename,
      status: String(file.status ?? 'modified'),
      additions: Number(file.additions ?? 0),
      deletions: Number(file.deletions ?? 0),
    }
    if (typeof file.previous_filename === 'string') change.previousPath = file.previous_filename
    files.push(change)
  }
  const body: CommitFilesResponse = {
    sha: params.sha,
    stats: raw.stats
      ? { additions: Number(raw.stats.additions ?? 0), deletions: Number(raw.stats.deletions ?? 0) }
      : null,
    files,
    more,
    tooLarge: false,
  }
  return json(body, CACHE.immutable)
}
