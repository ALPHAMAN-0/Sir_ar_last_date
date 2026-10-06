import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activityUrl, commitUrl, commitsUrl, reposUrl, treeUrl } from '../shared/api.ts'
import { resetGitHubState } from './github.ts'
import worker from './index.ts'

const TOKEN = 'github_pat_FAKE_TOKEN_FOR_TESTS_0123456789'
const SHA = 'a32ee2ab21ea1bf5434108126a9a6adc35121ffe'
const ORIGIN = 'https://app.example'

type Call = { url: string; init: RequestInit }
type Handler = (url: string, init: RequestInit) => Response

const limiter = (success: boolean): RateLimit => ({ limit: async () => ({ success }) })

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { GITHUB_TOKEN: TOKEN, RL_GRAPHQL: limiter(true), RL_REST: limiter(true), RL_TREE: limiter(true), ...overrides }
}

function quotaBody(remaining = 4000): string {
  const reset = Math.floor(Date.now() / 1000) + 1800
  const one = { limit: 5000, remaining, reset }
  return JSON.stringify({ resources: { core: one, graphql: one } })
}

/** Replaces global fetch. `/rate_limit` is answered automatically unless the handler takes it. */
function stubFetch(handler: Handler, remaining = 4000): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.endsWith('/rate_limit')) return new Response(quotaBody(remaining))
    return handler(url, init)
  })
  return calls
}

const githubCalls = (calls: Call[]) => calls.filter((call) => !call.url.endsWith('/rate_limit'))

async function get(path: string, env = makeEnv(), headers: Record<string, string> = {}) {
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { headers }) as never, env)
  const text = await res.text()
  // No response may ever contain the token.
  expect(text).not.toContain(TOKEN)
  for (const [, value] of res.headers) expect(value).not.toContain(TOKEN)
  return { res, body: text ? JSON.parse(text) : null }
}

const repoNode = (nameWithOwner: string) => ({
  nameWithOwner,
  isEmpty: false,
  isFork: false,
  isArchived: false,
  createdAt: '2026-09-01T00:00:00Z',
  pushedAt: '2026-09-25T09:05:11Z',
  defaultBranchRef: {
    name: 'main',
    target: { oid: SHA, committedDate: '2026-09-25T09:05:04Z', history: { totalCount: 38 } },
  },
})

beforeEach(() => resetGitHubState())
afterEach(() => vi.unstubAllGlobals())

describe('request checks happen before any GitHub call', () => {
  it('rejects non-canonical queries with 400', async () => {
    const calls = stubFetch(() => new Response('{}'))
    for (const path of [
      '/api/v1/repos',
      '/api/v1/repos?r=Octocat%2FHello-World',
      '/api/v1/repos?r=b%2Fy&r=a%2Fx',
      '/api/v1/repos?r=a%2Fx&debug=1',
      '/api/v1/commit?repo=a%2Fx&sha=main',
      '/api/v1/status?x=1',
    ]) {
      const { res, body } = await get(path)
      expect(res.status, path).toBe(400)
      expect(body.error.code).toBe('bad_request')
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
    expect(calls).toHaveLength(0)
  })

  it('rejects other methods, other sites and unknown routes', async () => {
    const calls = stubFetch(() => new Response('{}'))
    const post = await worker.fetch(
      new Request(`${ORIGIN}/api/v1/status`, { method: 'POST' }) as never,
      makeEnv(),
    )
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')

    const cross = await get('/api/v1/status', makeEnv(), { 'sec-fetch-site': 'cross-site' })
    expect(cross.res.status).toBe(403)
    const sameSite = await get('/api/v1/status', makeEnv(), { 'sec-fetch-site': 'same-site' })
    expect(sameSite.res.status).toBe(403)

    const unknown = await get('/api/v1/nope')
    expect(unknown.res.status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('answers 429 when the visitor limit is hit', async () => {
    const calls = stubFetch(() => new Response('{}'))
    const { res, body } = await get(reposUrl(['a/x']), makeEnv({ RL_GRAPHQL: limiter(false) }))
    expect(res.status).toBe(429)
    expect(body.error.code).toBe('rate_limited')
    expect(res.headers.get('retry-after')).toBe('30')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(calls).toHaveLength(0)
  })
})

describe('/repos', () => {
  it('sends the token only to GitHub and returns repo facts', async () => {
    const calls = stubFetch(() =>
      Response.json({ data: { r0: repoNode('octocat/Hello-World') } }),
    )
    const { res, body } = await get(reposUrl(['octocat/hello-world']), makeEnv(), {
      'sec-fetch-site': 'same-origin',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=60')
    expect(body.repos).toEqual([
      {
        key: 'octocat/hello-world',
        state: 'ok',
        nameWithOwner: 'octocat/Hello-World',
        isEmpty: false,
        isFork: false,
        isArchived: false,
        createdAt: '2026-09-01T00:00:00Z',
        pushedAt: '2026-09-25T09:05:11Z',
        defaultBranch: 'main',
        headOid: SHA,
        headCommittedAt: '2026-09-25T09:05:04Z',
        totalCommits: 38,
      },
    ])

    const [call] = githubCalls(calls)
    expect(call.url).toBe('https://api.github.com/graphql')
    expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(new Headers(call.init.headers).get('user-agent')).toBeTruthy()
    expect(call.init.redirect).toBe('manual')
    // Repo names travel as variables, never inside the query text.
    const sent = JSON.parse(String(call.init.body))
    expect(sent.variables).toEqual({ o0: 'octocat', n0: 'hello-world' })
    expect(sent.query).not.toContain('octocat')
  })

  it('maps NOT_FOUND to not_found and other failures to a retryable error', async () => {
    stubFetch(() =>
      Response.json({
        data: { r0: repoNode('a/x'), r1: null, r2: null },
        errors: [
          { type: 'NOT_FOUND', path: ['r1'], message: 'Could not resolve' },
          { type: 'FORBIDDEN', path: ['r2'], message: 'nope' },
        ],
      }),
    )
    const { res, body } = await get(reposUrl(['a/x', 'a/y', 'a/z']))
    expect(body.repos.map((repo: { state: string }) => repo.state)).toEqual([
      'ok',
      'not_found',
      'error',
    ])
    expect(body.repos[2].code).toBe('forbidden')
    // A partial failure is cached only briefly.
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=10')
  })

  it('treats a GraphQL RATE_LIMITED answer (HTTP 200) as quota exhaustion', async () => {
    stubFetch(() =>
      Response.json({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }),
    )
    const { res, body } = await get(reposUrl(['a/x']))
    expect(res.status).toBe(503)
    expect(body.error.code).toBe('quota_reserved')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses to spend the reserve', async () => {
    const calls = stubFetch(() => Response.json({ data: { r0: repoNode('a/x') } }), 400)
    const { res, body } = await get(reposUrl(['a/x']))
    expect(res.status).toBe(503)
    expect(body.error.code).toBe('quota_reserved')
    expect(Date.parse(body.error.resetAt)).toBeGreaterThan(Date.now())
    expect(githubCalls(calls)).toHaveLength(0)
  })

  it('reports a bad token without leaking it', async () => {
    stubFetch(() => new Response('{"message":"Bad credentials"}', { status: 401 }))
    const { res, body } = await get(reposUrl(['a/x']))
    expect(res.status).toBe(502)
    expect(body.error.code).toBe('github_auth')
  })
})

describe('GitHub back-pressure', () => {
  it('stops calling GitHub while a retry-after is in force', async () => {
    const calls = stubFetch(
      () => new Response('{"message":"secondary rate limit"}', { status: 403, headers: { 'retry-after': '45' } }),
    )
    const path = commitUrl({ repo: 'a/x', sha: SHA })
    const first = await get(path)
    expect(first.res.status).toBe(503)
    expect(first.body.error).toMatchObject({ code: 'github_throttled', retryAfter: 45 })

    const before = githubCalls(calls).length
    const second = await get(path)
    expect(second.res.status).toBe(503)
    expect(second.body.error.code).toBe('github_throttled')
    expect(githubCalls(calls)).toHaveLength(before)
  })

  it('follows a redirect inside api.github.com but never to another host', async () => {
    const calls = stubFetch((url) =>
      url.includes('/repos/a/x/')
        ? new Response(null, {
            status: 301,
            headers: { location: 'https://api.github.com/repositories/42/activity?per_page=100' },
          })
        : Response.json([]),
    )
    const ok = await get(activityUrl({ repo: 'a/x', v: '2026-01-01T00:00:00Z' }))
    expect(ok.res.status).toBe(200)
    expect(githubCalls(calls).map((call) => call.url)).toContain(
      'https://api.github.com/repositories/42/activity?per_page=100',
    )

    resetGitHubState()
    const evil = stubFetch(
      () => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }),
    )
    const refused = await get(activityUrl({ repo: 'a/y', v: '2026-01-01T00:00:00Z' }))
    expect(refused.res.status).toBe(502)
    expect(evil.some((call) => call.url.includes('evil.example'))).toBe(false)
  })
})

describe('/activity', () => {
  const events = [
    {
      id: 1,
      timestamp: '2026-09-25T09:05:11Z',
      activity_type: 'push',
      ref: 'refs/heads/main',
      before: 'b'.repeat(40),
      after: SHA,
      actor: { login: 'someone', id: 7 },
    },
  ]

  it('slims events, extracts only the cursor, and caches settled answers for a day', async () => {
    const calls = stubFetch(
      () =>
        new Response(JSON.stringify(events), {
          headers: {
            link: '<https://api.github.com/repositories/1/activity?per_page=100&after=Y3Vyc29yOnYy>; rel="next"',
          },
        }),
    )
    const { res, body } = await get(
      activityUrl({ repo: 'a/x', v: '2026-01-01T00:00:00Z', ref: 'main' }),
    )
    expect(body.events).toEqual([
      {
        ts: '2026-09-25T09:05:11Z',
        type: 'push',
        ref: 'refs/heads/main',
        before: 'b'.repeat(40),
        after: SHA,
        actor: 'someone',
      },
    ])
    expect(body.next).toBe('Y3Vyc29yOnYy')
    expect(body.settled).toBe(true)
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(githubCalls(calls)[0].url).toBe(
      'https://api.github.com/repos/a/x/activity?per_page=100&direction=desc&ref=refs%2Fheads%2Fmain',
    )
  })

  it('caches only briefly while the push is fresh', async () => {
    stubFetch(() => Response.json(events))
    const fresh = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    const { res, body } = await get(activityUrl({ repo: 'a/x', v: fresh }))
    expect(body.settled).toBe(false)
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=60')
  })

  it('maps a missing repo to a short-lived 404', async () => {
    stubFetch(() => new Response('{"message":"Not Found"}', { status: 404 }))
    const { res, body } = await get(activityUrl({ repo: 'a/x', v: '2026-01-01T00:00:00Z' }))
    expect(res.status).toBe(404)
    expect(body.error.code).toBe('repo_not_found')
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=60')
  })
})

describe('/commits', () => {
  it('returns commits with parents and the next cursor', async () => {
    stubFetch(() =>
      Response.json({
        data: {
          repository: {
            object: {
              history: {
                pageInfo: { hasNextPage: true, endCursor: `${SHA} 99` },
                nodes: [
                  {
                    oid: SHA,
                    committedDate: '2026-09-25T09:05:04Z',
                    authoredDate: '2026-09-25T09:05:04Z',
                    messageHeadline: 'fix bug',
                    parents: { nodes: [{ oid: 'b'.repeat(40) }] },
                    author: { name: 'Karim', user: { login: 'karim' } },
                  },
                ],
              },
            },
          },
        },
      }),
    )
    const { res, body } = await get(commitsUrl({ repo: 'a/x', ref: SHA }))
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800, immutable')
    expect(body).toEqual({
      commits: [
        {
          oid: SHA,
          committedAt: '2026-09-25T09:05:04Z',
          authoredAt: '2026-09-25T09:05:04Z',
          headline: 'fix bug',
          parents: ['b'.repeat(40)],
          authorName: 'Karim',
          authorLogin: 'karim',
        },
      ],
      next: `${SHA} 99`,
    })
  })

  it('answers 404 for an unknown commit', async () => {
    stubFetch(() => Response.json({ data: { repository: { object: null } } }))
    const { res, body } = await get(commitsUrl({ repo: 'a/x', ref: SHA }))
    expect(res.status).toBe(404)
    expect(body.error.code).toBe('commit_not_found')
  })
})

describe('/commit', () => {
  const commitBody = (patch: string) =>
    JSON.stringify({
      sha: SHA,
      commit: { author: { email: 'secret@example.com' } },
      stats: { total: 14, additions: 12, deletions: 2 },
      files: [
        { filename: 'src/app.js', status: 'modified', additions: 12, deletions: 2, patch },
        {
          filename: 'docs/new.md',
          status: 'renamed',
          additions: 0,
          deletions: 0,
          previous_filename: 'docs/old.md',
        },
      ],
    })

  it('returns paths and counts but never diff text or emails', async () => {
    const calls = stubFetch(
      () => new Response(commitBody('@@ -1 +1 @@ SECRET-DIFF'), { headers: { link: '<x>; rel="next"' } }),
    )
    const { res, body } = await get(commitUrl({ repo: 'a/x', sha: SHA }))
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800, immutable')
    expect(body).toEqual({
      sha: SHA,
      stats: { additions: 12, deletions: 2 },
      files: [
        { path: 'src/app.js', status: 'modified', additions: 12, deletions: 2 },
        {
          path: 'docs/new.md',
          status: 'renamed',
          additions: 0,
          deletions: 0,
          previousPath: 'docs/old.md',
        },
      ],
      more: true,
      tooLarge: false,
    })
    expect(JSON.stringify(body)).not.toMatch(/SECRET-DIFF|secret@example\.com/)
    expect(githubCalls(calls)[0].url).toBe(
      `https://api.github.com/repos/a/x/commits/${SHA}?per_page=30&page=1`,
    )
  })

  it('does not parse an oversized body', async () => {
    stubFetch(() => new Response(commitBody('x'.repeat(1_100_000))))
    const { body } = await get(commitUrl({ repo: 'a/x', sha: SHA }))
    expect(body).toEqual({ sha: SHA, stats: null, files: [], more: false, tooLarge: true })
  })

  it('turns a GitHub timeout on a huge diff into a short-lived marker', async () => {
    stubFetch(() => new Response('upstream timeout', { status: 502 }))
    const { res, body } = await get(commitUrl({ repo: 'a/x', sha: SHA, page: 2 }))
    expect(res.status).toBe(200)
    expect(body.tooLarge).toBe(true)
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=600')
  })
})

describe('/status', () => {
  it('reports the quota from the free rate_limit call', async () => {
    const calls = stubFetch(() => new Response('{}'), 3210)
    const { res, body } = await get('/api/v1/status')
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=30')
    expect(body.core.remaining).toBe(3210)
    expect(body.graphql.limit).toBe(5000)
    expect(body.reserve).toBe(500)
    expect(calls.every((call) => call.url.endsWith('/rate_limit'))).toBe(true)
  })

  it('says so when the server has no token', async () => {
    stubFetch(() => new Response('{}'))
    const { res, body } = await get('/api/v1/status', makeEnv({ GITHUB_TOKEN: '' }))
    expect(res.status).toBe(500)
    expect(body.error.code).toBe('misconfigured')
  })
})

describe('/tree', () => {
  const BLOB = 'b'.repeat(40)
  const DIR = 'd'.repeat(40)
  const treeBody = (extra: object[] = [], truncated = false) =>
    JSON.stringify({
      sha: SHA,
      tree: [
        { path: 'README.md', mode: '100644', type: 'blob', sha: BLOB, size: 120, url: 'https://api.github.com/x' },
        { path: 'src', mode: '040000', type: 'tree', sha: DIR, url: 'https://api.github.com/y' },
        { path: 'src/main.js', mode: '100644', type: 'blob', sha: 'c'.repeat(40), size: 900 },
        ...extra,
      ],
      truncated,
    })

  it('sends the token to GitHub and returns each file with its content hash and size', async () => {
    const calls = stubFetch(() => new Response(treeBody()))
    const { res, body } = await get(treeUrl({ repo: 'octocat/hello-world', sha: SHA }))
    expect(res.status).toBe(200)
    expect(body).toEqual({
      files: [
        { path: 'README.md', sha: BLOB, size: 120 },
        { path: 'src/main.js', sha: 'c'.repeat(40), size: 900 },
      ],
      dirs: [],
      tooLarge: false,
    })
    const [call] = githubCalls(calls)
    expect(call.url).toBe(`https://api.github.com/repos/octocat/hello-world/git/trees/${SHA}?recursive=1`)
    expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
  })

  it('caches the answer long, because a commit id never points at other files', async () => {
    stubFetch(() => new Response(treeBody()))
    const { res } = await get(treeUrl({ repo: 'octocat/hello-world', sha: SHA }))
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800, immutable')
  })

  it('lists one folder level, with its sub-folders, for a flat request', async () => {
    const calls = stubFetch(() => new Response(treeBody()))
    const { body } = await get(treeUrl({ repo: 'octocat/hello-world', sha: SHA, flat: true }))
    expect(githubCalls(calls)[0].url).toBe(
      `https://api.github.com/repos/octocat/hello-world/git/trees/${SHA}`,
    )
    expect(body.dirs).toEqual([{ path: 'src', sha: DIR }])
    expect(body.files.map((file: { path: string }) => file.path)).toContain('README.md')
  })

  it('leaves out submodules and entries without a usable hash', async () => {
    stubFetch(() =>
      new Response(
        treeBody([
          { path: 'vendor/lib', type: 'commit', sha: 'e'.repeat(40) },
          { path: 'broken.txt', type: 'blob', sha: 'not-a-hash', size: 5 },
          { path: 'nosize.txt', type: 'blob', sha: 'f'.repeat(40) },
        ]),
      ),
    )
    const { body } = await get(treeUrl({ repo: 'octocat/hello-world', sha: SHA }))
    expect(body.files.map((file: { path: string }) => file.path)).toEqual([
      'README.md',
      'src/main.js',
      'nosize.txt',
    ])
    expect(body.files[2].size).toBe(0)
  })

  it('does not parse an oversized listing and says so instead', async () => {
    const many = Array.from({ length: 6000 }, (_, i) => ({
      path: `node_modules/pkg-${i}/index.js`,
      mode: '100644',
      type: 'blob',
      sha: String(i).padStart(40, '0'),
      size: 10,
      url: `https://api.github.com/repos/octocat/hello-world/git/blobs/${String(i).padStart(40, '0')}`,
    }))
    stubFetch(() => new Response(treeBody(many)))
    const { res, body } = await get(treeUrl({ repo: 'octocat/hello-world', sha: SHA }))
    expect(res.status).toBe(200)
    expect(body).toEqual({ files: [], dirs: [], tooLarge: true })
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800, immutable')
  })

  it('treats a listing that GitHub cut short as too large, never as complete', async () => {
    stubFetch(() => new Response(treeBody([], true)))
    const { body } = await get(treeUrl({ repo: 'octocat/hello-world', sha: SHA }))
    expect(body).toEqual({ files: [], dirs: [], tooLarge: true })
  })

  it('answers a short-lived 404 for a missing repo, an unknown commit or an empty repo', async () => {
    for (const status of [404, 422, 409]) {
      stubFetch(() => new Response('{}', { status }))
      const { res, body } = await get(treeUrl({ repo: 'octocat/hello-world', sha: SHA }))
      expect(res.status, String(status)).toBe(404)
      expect(body.error.code).toBe('repo_or_sha_not_found')
      expect(res.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=60')
    }
  })

  it('answers 502 when GitHub sends something that is not a file list', async () => {
    stubFetch(() => new Response('<html>oops</html>'))
    const { res, body } = await get(treeUrl({ repo: 'octocat/hello-world', sha: SHA }))
    expect(res.status).toBe(502)
    expect(body.error.code).toBe('github_error')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects malformed queries with 400 and never calls GitHub', async () => {
    const calls = stubFetch(() => new Response('{}'))
    for (const path of [
      '/api/v1/tree',
      '/api/v1/tree?repo=Octocat%2FHello-World&sha=' + SHA,
      '/api/v1/tree?repo=octocat%2Fhello-world',
      '/api/v1/tree?repo=octocat%2Fhello-world&sha=not-a-sha',
      `/api/v1/tree?repo=octocat%2Fhello-world&sha=${SHA}&flat=0`,
      `/api/v1/tree?repo=octocat%2Fhello-world&sha=${SHA}&flat=true`,
      `/api/v1/tree?flat=1&repo=octocat%2Fhello-world&sha=${SHA}`,
      `/api/v1/tree?repo=octocat%2Fhello-world&sha=${SHA}&recursive=1`,
    ]) {
      const { res, body } = await get(path)
      expect(res.status, path).toBe(400)
      expect(body.error.code).toBe('bad_request')
    }
    expect(calls).toHaveLength(0)
  })

  it('counts against RL_TREE, not RL_REST', async () => {
    stubFetch(() => new Response(treeBody()))
    const { res, body } = await get(
      treeUrl({ repo: 'octocat/hello-world', sha: SHA }),
      makeEnv({ RL_TREE: limiter(false) }),
    )
    expect(res.status).toBe(429)
    expect(body.error.code).toBe('rate_limited')
    expect(res.headers.get('retry-after')).toBe('30')
  })
})
