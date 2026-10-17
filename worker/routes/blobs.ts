import type { BlobText, BlobsParams, BlobsResponse } from '../../shared/api.ts'
import { splitRepoKey } from '../../shared/validate.ts'
import { graphql } from '../github.ts'
import { ApiErr, CACHE, json } from '../http.ts'
import { blobsDocument } from '../queries.ts'

// The page asks for about 200 KB of files at a time. Escaped as JSON that can
// grow, but never this far; past it the answer is not parsed (the free plan's
// CPU budget), and the page asks again for fewer files at a time.
export const MAX_BODY_BYTES = 1_000_000

type RawBlob = { isBinary?: boolean; isTruncated?: boolean; text?: string | null } | null

const TOO_LARGE: BlobsResponse = { blobs: [], tooLarge: true }

function toText(sha: string, raw: RawBlob | undefined): BlobText {
  if (!raw) return { sha, skipped: 'missing' }
  if (raw.isBinary) return { sha, skipped: 'binary' }
  if (raw.isTruncated) return { sha, skipped: 'too_large' }
  // An object that is no file (a folder, a commit) has no text.
  if (typeof raw.text !== 'string') return { sha, skipped: 'missing' }
  return { sha, text: raw.text }
}

/**
 * The text of up to 40 files of one repo, by content hash, in one GraphQL call.
 * For the similarity tab's shared-code check, which compares the code itself.
 * The answer is addressed by content, so it never changes and is cached long.
 */
export async function handleBlobs(env: Env, params: BlobsParams): Promise<Response> {
  const { owner, name } = splitRepoKey(params.repo)
  const variables: Record<string, string> = { owner, name }
  params.shas.forEach((sha, i) => {
    variables[`b${i}`] = sha
  })
  const { data, errors, tooLarge } = await graphql<{ repository: Record<string, RawBlob> | null }>(
    env,
    blobsDocument(params.shas.length),
    variables,
    { maxBytes: MAX_BODY_BYTES },
  )
  if (tooLarge) return json(TOO_LARGE, CACHE.immutable)
  if (data && !data.repository && errors.some((error) => error.type === 'NOT_FOUND')) {
    throw new ApiErr(404, 'repo_not_found', 'Repo not found.', { cache: CACHE.edge(60) })
  }
  // Any other error may have left a content out: a partial list must never be cached.
  if (!data?.repository || errors.length > 0) {
    throw new ApiErr(502, 'github_error', 'GitHub could not answer. Please try again.')
  }
  const repository = data.repository
  const blobs = params.shas.map((sha, i) => toText(sha, repository[`b${i}`]))
  const body: BlobsResponse = { blobs, tooLarge: false }
  const missing = blobs.some((blob) => 'skipped' in blob && blob.skipped === 'missing')
  return json(body, missing ? CACHE.edge(60) : CACHE.immutable)
}
