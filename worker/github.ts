// All traffic to GitHub goes through this file. It adds the token, keeps a
// reserve of the hourly quota, and backs off when GitHub says to slow down.

import type { QuotaInfo } from '../shared/api.ts'
import { ApiErr } from './http.ts'

const GITHUB_API = 'https://api.github.com'
const USER_AGENT = 'sir-ar-last-date'
const TIMEOUT_MS = 12_000
const SEED_INTERVAL_MS = 60_000
const MAX_THROTTLE_S = 900

/** Requests left per hour that the app never spends, so the token owner's own tools keep working. */
export const RESERVE = 500

type Resource = 'core' | 'graphql'
type Quota = { remaining: number; limit: number; resetAt: number }

// Best effort only: this memory belongs to one isolate, and Cloudflare runs many.
const state = {
  quota: { core: null, graphql: null } as Record<Resource, Quota | null>,
  seededAt: 0,
  throttledUntil: 0,
}

export function resetGitHubState(): void {
  state.quota.core = null
  state.quota.graphql = null
  state.seededAt = 0
  state.throttledUntil = 0
}

function requestHeaders(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  if (!env.GITHUB_TOKEN) {
    throw new ApiErr(500, 'misconfigured', 'The server has no GitHub token configured.')
  }
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'user-agent': USER_AGENT,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...extra,
  }
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    // Redirects are followed by hand so the token can never be sent to another host.
    return await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new ApiErr(502, 'github_error', 'Could not reach GitHub. Please try again.')
  }
}

function toQuota(raw: unknown): Quota | null {
  if (!raw || typeof raw !== 'object') return null
  const { remaining, limit, reset } = raw as Record<string, unknown>
  if (typeof remaining !== 'number' || typeof limit !== 'number' || typeof reset !== 'number') {
    return null
  }
  return { remaining, limit, resetAt: reset }
}

/** Asks GitHub for the current quota. This call itself is free. */
async function seed(env: Env): Promise<void> {
  const now = Date.now()
  if (now - state.seededAt < SEED_INTERVAL_MS) return
  state.seededAt = now
  const res = await send(`${GITHUB_API}/rate_limit`, { headers: requestHeaders(env) }).catch(
    () => null,
  )
  if (!res) return
  if (res.status === 401) throw authError()
  if (!res.ok) return
  const body = (await res.json().catch(() => null)) as { resources?: Record<string, unknown> } | null
  state.quota.core = toQuota(body?.resources?.core) ?? state.quota.core
  state.quota.graphql = toQuota(body?.resources?.graphql) ?? state.quota.graphql
}

function authError(): ApiErr {
  return new ApiErr(502, 'github_auth', 'The server GitHub token is missing, wrong or expired.')
}

function resetIso(quota: Quota): string {
  return new Date(quota.resetAt * 1000).toISOString()
}

function guard(resource: Resource): void {
  const now = Date.now()
  if (state.throttledUntil > now) {
    throw new ApiErr(503, 'github_throttled', 'GitHub asked the app to slow down.', {
      retryAfter: Math.ceil((state.throttledUntil - now) / 1000),
    })
  }
  const quota = state.quota[resource]
  if (quota && quota.resetAt * 1000 > now && quota.remaining <= RESERVE) {
    throw new ApiErr(503, 'quota_reserved', 'The shared GitHub limit is used up for this hour.', {
      resetAt: resetIso(quota),
    })
  }
}

function note(res: Response, fallback: Resource): void {
  const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? NaN)
  const limit = Number(res.headers.get('x-ratelimit-limit') ?? NaN)
  const reset = Number(res.headers.get('x-ratelimit-reset') ?? NaN)
  if (![remaining, limit, reset].every(Number.isFinite)) return
  const named = res.headers.get('x-ratelimit-resource')
  const resource: Resource = named === 'core' || named === 'graphql' ? named : fallback
  state.quota[resource] = { remaining, limit, resetAt: reset }
}

function checkThrottle(res: Response, resource: Resource): void {
  if (res.status !== 403 && res.status !== 429) return
  const retryAfter = Number(res.headers.get('retry-after') ?? NaN)
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    const wait = Math.min(retryAfter, MAX_THROTTLE_S)
    state.throttledUntil = Date.now() + wait * 1000
    throw new ApiErr(503, 'github_throttled', 'GitHub asked the app to slow down.', {
      retryAfter: wait,
    })
  }
  const quota = state.quota[resource]
  if (res.headers.get('x-ratelimit-remaining') === '0' && quota) {
    throw new ApiErr(503, 'quota_reserved', 'The shared GitHub limit is used up for this hour.', {
      resetAt: resetIso(quota),
    })
  }
  if (res.status === 429) {
    state.throttledUntil = Date.now() + 60_000
    throw new ApiErr(503, 'github_throttled', 'GitHub asked the app to slow down.', {
      retryAfter: 60,
    })
  }
}

/** GET a REST path such as `/repos/o/r/activity?per_page=100`. */
export async function rest(env: Env, path: string): Promise<Response> {
  await seed(env)
  guard('core')
  let url = `${GITHUB_API}${path}`
  for (let hop = 0; hop < 3; hop++) {
    const res = await send(url, { headers: requestHeaders(env) })
    note(res, 'core')
    checkThrottle(res, 'core')
    if (res.status === 401) throw authError()
    if (res.status < 300 || res.status >= 400) return res
    // A renamed repo answers 301 to api.github.com/repositories/<id>/...
    const location = res.headers.get('location')
    if (!location || !location.startsWith(`${GITHUB_API}/`)) break
    url = location
  }
  throw new ApiErr(502, 'github_error', 'GitHub sent an unexpected redirect.')
}

export type GraphQLError = { type?: string; path?: Array<string | number>; message?: string }

export async function graphql<T>(
  env: Env,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data: T | null; errors: GraphQLError[] }> {
  await seed(env)
  guard('graphql')
  const res = await send(`${GITHUB_API}/graphql`, {
    method: 'POST',
    headers: requestHeaders(env, { 'content-type': 'application/json' }),
    body: JSON.stringify({ query, variables }),
  })
  note(res, 'graphql')
  checkThrottle(res, 'graphql')
  if (res.status === 401) throw authError()
  if (!res.ok) throw new ApiErr(502, 'github_error', `GitHub answered with status ${res.status}.`)
  const body = (await res.json().catch(() => null)) as {
    data?: T | null
    errors?: GraphQLError[]
  } | null
  if (!body) throw new ApiErr(502, 'github_error', 'GitHub sent an unreadable answer.')
  const errors = body.errors ?? []
  // GraphQL reports an exhausted quota inside a normal 200 answer.
  if (errors.some((error) => error.type === 'RATE_LIMITED')) {
    const quota = state.quota.graphql
    throw new ApiErr(503, 'quota_reserved', 'The shared GitHub limit is used up for this hour.', {
      resetAt: quota ? resetIso(quota) : undefined,
    })
  }
  return { data: body.data ?? null, errors }
}

function toInfo(quota: Quota | null): QuotaInfo | null {
  return quota ? { remaining: quota.remaining, limit: quota.limit, resetAt: resetIso(quota) } : null
}

export async function quotaSnapshot(
  env: Env,
): Promise<{ core: QuotaInfo | null; graphql: QuotaInfo | null }> {
  await seed(env)
  return { core: toInfo(state.quota.core), graphql: toInfo(state.quota.graphql) }
}
