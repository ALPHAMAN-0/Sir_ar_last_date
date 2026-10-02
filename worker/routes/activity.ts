import type { ActivityEvent, ActivityParams, ActivityResponse } from '../../shared/api.ts'
import { isActivityCursor, splitRepoKey } from '../../shared/validate.ts'
import { rest } from '../github.ts'
import { ApiErr, CACHE, json } from '../http.ts'

/** GitHub's own log can lag a fresh push by a few seconds, so do not cache it long yet. */
const SETTLE_MS = 10 * 60 * 1000

type RawEvent = {
  timestamp?: string
  activity_type?: string
  ref?: string
  before?: string
  after?: string
  actor?: { login?: string } | null
}

/** Takes only the cursor value from GitHub's Link header, never the URL itself. */
export function nextCursor(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part)
    if (!match) continue
    try {
      const cursor = new URL(match[1]).searchParams.get('after')
      return cursor && isActivityCursor(cursor) ? cursor : null
    } catch {
      return null
    }
  }
  return null
}

/** Push events as recorded by GitHub's servers. These times cannot be faked by the author. */
export async function handleActivity(env: Env, params: ActivityParams): Promise<Response> {
  const { owner, name } = splitRepoKey(params.repo)
  const query = new URLSearchParams({
    per_page: '100',
    direction: params.asc ? 'asc' : 'desc',
  })
  if (params.ref !== undefined) query.set('ref', `refs/heads/${params.ref}`)
  if (params.after !== undefined) query.set('after', params.after)

  const res = await rest(env, `/repos/${owner}/${name}/activity?${query}`)
  if (res.status === 404) {
    throw new ApiErr(404, 'repo_not_found', 'This repo was not found.', { cache: CACHE.edge(60) })
  }
  if (!res.ok) throw new ApiErr(502, 'github_error', `GitHub answered with status ${res.status}.`)

  const raw = (await res.json().catch(() => null)) as RawEvent[] | null
  if (!Array.isArray(raw)) throw new ApiErr(502, 'github_error', 'GitHub sent an unreadable answer.')

  const events: ActivityEvent[] = []
  for (const item of raw) {
    if (typeof item.timestamp !== 'string' || typeof item.ref !== 'string') continue
    events.push({
      ts: item.timestamp,
      type: String(item.activity_type ?? ''),
      ref: item.ref,
      before: String(item.before ?? ''),
      after: String(item.after ?? ''),
      actor: item.actor?.login ?? null,
    })
  }

  const settled = Date.now() - Date.parse(params.v) >= SETTLE_MS
  const body: ActivityResponse = {
    fetchedAt: new Date().toISOString(),
    settled,
    events,
    next: nextCursor(res.headers.get('link')),
  }
  return json(body, settled ? CACHE.day : CACHE.edge(60))
}
