// Tests for the Single Check orchestrator. The fake API in `src/test/fakeApi.ts`
// answers the same /api/v1/* paths the real Worker does, so a pure call into
// the orchestrator exercises the same URL builders and parsers the screen will
// hit, without standing up a network.

import { describe, expect, it } from 'vitest'
import type {
  ActivityEvent,
  CommitFilesResponse,
  FileChange,
  RepoOk,
} from '../../shared/api.ts'
import { okRepo, stubApi } from '../test/fakeApi.ts'
import { runSingleCheck } from './run.ts'
import type { SingleCheckError, SingleCheckResult } from './types.ts'

// `parseRepoLink` lowercases the repo name, so the canonical key the orchestrator
// uses is `octocat/hello-world`. The fake's lookup table is keyed by what the URL
// builder sends, so seed the fake with the lowercased key.
const HEAD = 'aaaaaaaaaaaa0000000000000000000000000000'
const KEY = 'octocat/hello-world'
const REPO: RepoOk = okRepo(KEY, {
  nameWithOwner: 'octocat/Hello-World',
  defaultBranch: 'main',
  headOid: HEAD,
  createdAt: '2026-09-01T08:00:00Z',
  pushedAt: '2026-10-01T08:00:00Z',
})

const FILES: FileChange[] = [
  { path: 'src/app.js', status: 'modified', additions: 12, deletions: 4 },
  { path: 'README.md', status: 'modified', additions: 1, deletions: 1 },
]

const FILES_RESPONSE: CommitFilesResponse = {
  sha: HEAD,
  stats: { additions: 13, deletions: 5 },
  files: FILES,
  more: false,
  tooLarge: false,
}

/** Newest first, as the Worker sends them by default. */
const ACTIVITY_NEWEST_FIRST: ActivityEvent[] = [
  { ts: '2026-10-01T08:00:00Z', type: 'PushEvent', ref: 'refs/heads/main', before: '0', after: '1', actor: 'octocat' },
  { ts: '2026-09-15T12:00:00Z', type: 'PushEvent', ref: 'refs/heads/main', before: '0', after: '1', actor: 'octocat' },
  { ts: '2026-09-01T08:00:00Z', type: 'PushEvent', ref: 'refs/heads/main', before: '0', after: '1', actor: 'octocat' },
]
/** Activity events keyed by canonical (lowercased) repo key. */
const ACTIVITY_BY_KEY: Record<string, ActivityEvent[]> = {
  [KEY]: ACTIVITY_NEWEST_FIRST,
}

const isResult = (value: SingleCheckResult | SingleCheckError): value is SingleCheckResult =>
  !('kind' in value)

describe('runSingleCheck', () => {
  it('returns the repo facts and the oldest push on the default branch', async () => {
    stubApi({
      repos: { [KEY]: REPO },
      activity: ACTIVITY_BY_KEY,
      files: { [HEAD]: FILES_RESPONSE },
    })

    const result = await runSingleCheck('octocat/Hello-World')
    if (!isResult(result)) throw new Error(`expected a result, got ${result.kind}`)

    expect(result.key).toBe(KEY)
    expect(result.nameWithOwner).toBe('octocat/Hello-World')
    expect(result.createdAt).toBe('2026-09-01T08:00:00Z')
    expect(result.pushedAt).toBe('2026-10-01T08:00:00Z')
    // Oldest event: createdAt, when the repo was first pushed.
    expect(result.firstPushAt).toBe('2026-09-01T08:00:00Z')
    expect(result.defaultBranch).toBe('main')
    expect(result.headOid).toBe(HEAD)
    expect(result.files).toEqual([
      { path: 'src/app.js', additions: 12, deletions: 4 },
      { path: 'README.md', additions: 1, deletions: 1 },
    ])
    expect(result.filesTruncated).toBe(false)
    expect(result.filesTooLarge).toBe(false)
  })

  it('accepts a full https URL and reaches the same answer', async () => {
    stubApi({
      repos: { [KEY]: REPO },
      activity: ACTIVITY_BY_KEY,
      files: { [HEAD]: FILES_RESPONSE },
    })

    const result = await runSingleCheck('https://github.com/octocat/Hello-World')
    expect(isResult(result)).toBe(true)
  })

  it('reports a bad link without hitting the network', async () => {
    const { fetch } = stubApi()
    const result = await runSingleCheck('not a link')
    expect(result).toEqual({ kind: 'bad_link', reason: 'Link could not be read' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a GitHub-pages link as a bad link', async () => {
    const { fetch } = stubApi()
    const result = await runSingleCheck('https://octocat.github.io/')
    expect(result).toEqual({ kind: 'bad_link', reason: 'Website link (github.io), not a repo' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports not_found when the Worker does not know the repo', async () => {
    stubApi({ repos: {} })
    const result = await runSingleCheck('octocat/Hello-World')
    expect(result).toEqual({ kind: 'not_found' })
  })

  it('returns firstPushAt as null when there is no activity yet', async () => {
    stubApi({
      repos: { [KEY]: REPO },
      activity: { [KEY]: [] },
      files: { [HEAD]: FILES_RESPONSE },
    })

    const result = await runSingleCheck('octocat/Hello-World')
    if (!isResult(result)) throw new Error(`expected a result, got ${result.kind}`)
    expect(result.firstPushAt).toBeNull()
  })

  it('returns an empty file list when the head commit has no files', async () => {
    const empty: CommitFilesResponse = {
      sha: HEAD,
      stats: null,
      files: [],
      more: false,
      tooLarge: false,
    }
    stubApi({
      repos: { [KEY]: REPO },
      activity: ACTIVITY_BY_KEY,
      files: { [HEAD]: empty },
    })

    const result = await runSingleCheck('octocat/Hello-World')
    if (!isResult(result)) throw new Error(`expected a result, got ${result.kind}`)
    expect(result.files).toEqual([])
    expect(result.filesTruncated).toBe(false)
  })

  it('flags filesTruncated when the Worker says more files exist', async () => {
    const truncated: CommitFilesResponse = { ...FILES_RESPONSE, more: true }
    stubApi({
      repos: { [KEY]: REPO },
      activity: ACTIVITY_BY_KEY,
      files: { [HEAD]: truncated },
    })

    const result = await runSingleCheck('octocat/Hello-World')
    if (!isResult(result)) throw new Error(`expected a result, got ${result.kind}`)
    expect(result.filesTruncated).toBe(true)
  })
})
