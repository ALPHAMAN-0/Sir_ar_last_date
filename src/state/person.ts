// Data for the person screen: the commit list and the files of each commit.
// Both are addressed by commit id, so they never change and are kept for the session.

import {
  commitsUrl,
  commitUrl,
  type CommitFilesResponse,
  type CommitInfo,
  type CommitsResponse,
  type FileChange,
} from '../../shared/api.ts'
import { client } from './store.ts'

/** 10 pages of 100. Longer histories show the newest 1,000 and say so. */
const MAX_COMMIT_PAGES = 10

export type CommitList = { commits: CommitInfo[]; truncated: boolean }

const commitLists = new Map<string, Promise<CommitList>>()

export function loadCommits(repo: string, headOid: string): Promise<CommitList> {
  const cacheKey = `${repo}@${headOid}`
  let list = commitLists.get(cacheKey)
  if (!list) {
    list = (async () => {
      const commits: CommitInfo[] = []
      let after: string | undefined
      for (let page = 0; page < MAX_COMMIT_PAGES; page++) {
        const response = await client.get<CommitsResponse>(
          commitsUrl({ repo, ref: headOid, after }),
          1,
        )
        commits.push(...response.commits)
        if (!response.next) return { commits, truncated: false }
        after = response.next
      }
      return { commits, truncated: true }
    })()
    // A failed load must not be remembered, so the next visit tries again.
    list.catch(() => commitLists.delete(cacheKey))
    commitLists.set(cacheKey, list)
  }
  return list
}

export type FileEntry = FileChange & {
  /** GitHub's anchor for this file inside the commit page: "diff-<sha256 of the path>". */
  anchor: string
}
export type FilePage = Omit<CommitFilesResponse, 'files'> & { files: FileEntry[] }

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const filePages = new Map<string, Promise<FilePage>>()

/** @param priority where the request waits in the queue; the first caller's choice holds for a page already on its way */
export function loadFiles(repo: string, sha: string, page = 1, priority = 2): Promise<FilePage> {
  const cacheKey = `${repo}@${sha}#${page}`
  let result = filePages.get(cacheKey)
  if (!result) {
    result = (async () => {
      const response = await client.get<CommitFilesResponse>(commitUrl({ repo, sha, page }), priority)
      const files = await Promise.all(
        response.files.map(async (file) => ({
          ...file,
          anchor: `diff-${await sha256Hex(file.path)}`,
        })),
      )
      return { ...response, files }
    })()
    result.catch(() => filePages.delete(cacheKey))
    filePages.set(cacheKey, result)
  }
  return result
}
