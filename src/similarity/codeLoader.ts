// Reads the code of each repo for the shared-code check: the text of every code
// file through the Worker's `/api/v1/blobs`, 40 files a call, turned into
// fingerprints at once. Only the fingerprints are kept, not the text.
//
// A text is addressed by its content hash, so it never changes: the browser and
// Cloudflare's edge keep each answer, and a second look at a class costs nothing.

import { MAX_BLOBS_PER_CALL, blobsUrl, type BlobsResponse, type TreeFile } from '../../shared/api.ts'
import { ApiError } from '../api/client.ts'
import { codeOf, isReadable, langOf, printText, type FilePrints } from './codeText.ts'
import type { CodeFile, CodeRepo } from './sharedCode.ts'
import { askPatiently, type Get, type Progress, type TreeError } from './trees.ts'
import type { RepoFiles } from './types.ts'

/** Like the file lists: before the histories that "who had it first" reads. */
const PRIORITY = 2
/**
 * Bytes of files asked for in one call. GitHub escapes every < and > in HTML as
 * six characters, so the answer can be several times bigger.
 */
export const MAX_BATCH_BYTES = 150_000
/** More code files than this is not one person's course work, and would take long to read. */
export const MAX_CODE_FILES = 500

/** One repo's code, and how many of its code files could not be read. */
export type LoadedCode = { code: CodeRepo; unread: number }
export type CodeLoaded = { repos: Map<string, LoadedCode>; errors: Map<string, TreeError> }

export type CodeLoader = {
  /** The code of one repo. Asked once per commit, however often it is called. */
  load(tree: RepoFiles): Promise<LoadedCode>
  /** Reads many repos. A repo that fails lands in `errors`; the others still load. */
  loadAll(trees: ReadonlyMap<string, RepoFiles>, onProgress?: Progress): Promise<CodeLoaded>
}

class TooManyFiles extends Error {}

function toCodeError(error: unknown): TreeError {
  if (error instanceof TooManyFiles) {
    return { kind: 'too_large', message: `More than ${MAX_CODE_FILES} files of code: too many to read.` }
  }
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return { kind: 'not_found', message: 'GitHub no longer shows this repo. It may be private or deleted now.' }
    }
    if (error.code === 'quota_reserved') return { kind: 'limit', message: error.message }
    if (error.code === 'rate_limited' || error.code === 'github_throttled') {
      return { kind: 'limit', message: 'Too many requests for now. Press Try again in a minute.' }
    }
  }
  return { kind: 'unavailable', message: 'The code could not be read. Press Try again.' }
}

/**
 * The questions for one repo's files: each content once, A to Z, at most 40
 * and about MAX_BATCH_BYTES a time. The same files always give the same
 * questions, so the cached answers are found again.
 */
export function batches(files: readonly Pick<TreeFile, 'sha' | 'size'>[]): string[][] {
  const sizes = new Map<string, number>()
  for (const file of files) sizes.set(file.sha, file.size)
  const all: string[][] = []
  let batch: string[] = []
  let bytes = 0
  for (const sha of [...sizes.keys()].sort()) {
    const size = sizes.get(sha) ?? 0
    if (batch.length > 0 && (batch.length >= MAX_BLOBS_PER_CALL || bytes + size > MAX_BATCH_BYTES)) {
      all.push(batch)
      batch = []
      bytes = 0
    }
    batch.push(sha)
    bytes += size
  }
  if (batch.length > 0) all.push(batch)
  return all
}

export function createCodeLoader(get: Get): CodeLoader {
  /** Fingerprints by content and language; null for a text that could not be read. */
  const prints = new Map<string, FilePrints | null>()
  const repos = new Map<string, Promise<LoadedCode>>()
  const keyOf = (file: TreeFile) => `${file.sha}|${langOf(file.path)}`

  /** The texts of `shas`, asking again for half as many when one answer would be too big. */
  async function texts(repo: string, shas: string[]): Promise<Map<string, string | null>> {
    const body = await askPatiently<BlobsResponse>(get, blobsUrl({ repo, shas }), PRIORITY)
    if (!body || !Array.isArray(body.blobs)) throw new ApiError(502, 'malformed', 'The server sent unreadable file texts.')
    if (body.tooLarge) {
      if (shas.length === 1) return new Map([[shas[0], null]])
      const half = Math.ceil(shas.length / 2)
      const [first, second] = await Promise.all([texts(repo, shas.slice(0, half)), texts(repo, shas.slice(half))])
      return new Map([...first, ...second])
    }
    const found = new Map<string, string | null>()
    for (const blob of body.blobs) found.set(blob.sha, 'text' in blob ? blob.text : null)
    return found
  }

  async function read(tree: RepoFiles): Promise<LoadedCode> {
    const files = tree.files.filter(isReadable)
    if (files.length > MAX_CODE_FILES) throw new TooManyFiles()
    for (const shas of batches(files)) {
      const wanted = files.filter((file) => shas.includes(file.sha))
      // Another repo already brought every one of these: nothing to ask.
      if (wanted.every((file) => prints.has(keyOf(file)))) continue
      const found = await texts(tree.repo, shas)
      for (const file of wanted) {
        const key = keyOf(file)
        if (prints.has(key)) continue
        const text = found.get(file.sha)
        const code = typeof text === 'string' ? codeOf(file.path, text) : null
        prints.set(key, code === null ? null : printText(code))
      }
    }
    const code: CodeFile[] = []
    let unread = 0
    for (const file of files) {
      const printed = prints.get(keyOf(file))
      if (printed) code.push({ path: file.path, sha: file.sha, prints: printed })
      else unread++
    }
    return { code: { repo: tree.repo, files: code }, unread }
  }

  function load(tree: RepoFiles): Promise<LoadedCode> {
    const key = `${tree.repo}@${tree.headOid}`
    let pending = repos.get(key)
    if (!pending) {
      pending = read(tree)
      // A failed load must not be remembered, so the next try asks again.
      pending.catch(() => repos.delete(key))
      repos.set(key, pending)
    }
    return pending
  }

  async function loadAll(trees: ReadonlyMap<string, RepoFiles>, onProgress?: Progress): Promise<CodeLoaded> {
    const loaded = new Map<string, LoadedCode>()
    const errors = new Map<string, TreeError>()
    let done = 0
    // All at once: the request queue itself lets only a few run at a time.
    await Promise.all(
      [...trees.values()].map(async (tree) => {
        try {
          loaded.set(tree.repo, await load(tree))
        } catch (error) {
          errors.set(tree.repo, toCodeError(error))
        }
        onProgress?.(++done, trees.size, tree.repo)
      }),
    )
    // Keep sheet order, whatever order the answers came in.
    const ordered = new Map<string, LoadedCode>()
    for (const repo of trees.keys()) {
      const entry = loaded.get(repo)
      if (entry) ordered.set(repo, entry)
    }
    return { repos: ordered, errors }
  }

  return { load, loadAll }
}
