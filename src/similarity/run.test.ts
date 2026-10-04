import { describe, expect, it, vi } from 'vitest'
import type { RepoOk } from '../../shared/api.ts'
import { runComparison, comparableRepos, treeInputs } from './run.ts'

const repo = (over: Partial<RepoOk> = {}): RepoOk => ({
  key: 'octocat/hello-world',
  state: 'ok',
  nameWithOwner: 'octocat/hello-world',
  isEmpty: false,
  isFork: false,
  isArchived: false,
  createdAt: '2026-10-01T00:00:00Z',
  pushedAt: '2026-10-05T09:05:11Z',
  defaultBranch: 'main',
  headOid: 'a'.repeat(40),
  headCommittedAt: '2026-10-05T09:05:00Z',
  totalCommits: 5,
  ...over,
})

describe('comparableRepos', () => {
  it('keeps only repos with a head and a default branch', () => {
    const good = repo()
    const noHead = repo({ key: 'octocat/no-head', headOid: null })
    const noBranch = repo({ key: 'octocat/no-branch', defaultBranch: null })
    expect(comparableRepos([good, noHead, noBranch])).toEqual([good])
  })

  it('returns an empty list when there is nothing to compare', () => {
    expect(comparableRepos([])).toEqual([])
    expect(comparableRepos([repo({ headOid: null })])).toEqual([])
  })
})

describe('treeInputs', () => {
  it('builds the inputs that fetchAll wants', () => {
    const inputs = treeInputs([
      repo({ key: 'a/x', defaultBranch: 'main', headOid: 'a'.repeat(40) }),
      repo({ key: 'b/y', defaultBranch: 'master', headOid: 'b'.repeat(40) }),
    ])
    expect(inputs).toEqual([
      { repo: 'a/x', headOid: 'a'.repeat(40), branch: 'main' },
      { repo: 'b/y', headOid: 'b'.repeat(40), branch: 'master' },
    ])
  })
})

describe('runComparison', () => {
  it('skips repos with no head, fetches the rest, and runs the comparison', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('octocat/hello-world')) {
        return new Response(
          JSON.stringify({
            tree: [
              { path: 'README.md', type: 'blob' },
              { path: 'src/main.js', type: 'blob' },
            ],
          }),
        )
      }
      if (url.includes('octocat/another')) {
        return new Response(
          JSON.stringify({
            tree: [
              { path: 'README.md', type: 'blob' },
              { path: 'src/main.js', type: 'blob' },
              { path: 'docs/index.md', type: 'blob' },
            ],
          }),
        )
      }
      return new Response('{}', { status: 404 })
    })

    const result = await runComparison(
      [
        repo({ key: 'octocat/hello-world' }),
        repo({ key: 'octocat/another', nameWithOwner: 'octocat/another' }),
        repo({ key: 'octocat/missing', headOid: null }),
      ],
      {
        concurrency: 1,
        fetchImpl,
        baseUrl: 'https://api.test',
      },
    )

    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]).toMatchObject({
      aKey: 'octocat/hello-world',
      bKey: 'octocat/another',
      overlap: 2,
      union: 3,
      score: 2 / 3,
    })
    expect(result.errors.size).toBe(0)
  })

  it('records per-repo errors without failing the whole run', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('octocat/good')) {
        return new Response(JSON.stringify({ tree: [{ path: 'a.txt', type: 'blob' }] }))
      }
      return new Response('{}', { status: 404 })
    })

    const result = await runComparison(
      [
        repo({ key: 'octocat/good' }),
        repo({ key: 'octocat/missing' }),
      ],
      { concurrency: 1, fetchImpl, baseUrl: 'https://api.test' },
    )

    expect(result.pairs).toEqual([])
    expect(result.errors.size).toBe(1)
    expect(result.errors.get('octocat/missing')?.kind).toBe('http')
  })

  it('uses an injected comparison function for tests', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ tree: [{ path: 'x', type: 'blob' }] }))
    const stub = vi.fn(() => [])

    const result = await runComparison(
      [repo({ key: 'a/x' }), repo({ key: 'b/y' })],
      {
        concurrency: 1,
        fetchImpl,
        baseUrl: 'https://api.test',
        compare: stub,
      },
    )

    expect(stub).toHaveBeenCalledOnce()
    expect(result.pairs).toEqual([])
  })
})