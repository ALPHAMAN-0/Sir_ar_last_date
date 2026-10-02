import type { ApiErrorBody } from '../shared/api.ts'

// Every response sets Cache-Control on purpose. With Workers Cache on, a 200
// without one would be cached for hours, and without s-maxage the edge would
// keep serving a stale copy whenever the Worker returns an error.
export const CACHE = {
  none: 'no-store',
  /** The edge keeps it for `seconds`; browsers always ask again. */
  edge: (seconds: number) => `public, max-age=0, s-maxage=${seconds}`,
  /** Addressed by commit id, so the content can never change. */
  immutable: 'public, max-age=604800, immutable',
  day: 'public, max-age=86400',
} as const

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'x-robots-tag': 'noindex',
}

export function json(
  body: unknown,
  cache: string,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, 'cache-control': cache, ...extra },
  })
}

type ErrExtra = { retryAfter?: number; resetAt?: string; cache?: string; allow?: string }

/** An error that is safe to show to the visitor. Never put raw exception text in one. */
export class ApiErr extends Error {
  readonly status: number
  readonly code: string
  readonly extra: ErrExtra

  constructor(status: number, code: string, message: string, extra: ErrExtra = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export function errorResponse(err: ApiErr): Response {
  const body: ApiErrorBody = { error: { code: err.code, message: err.message } }
  const headers: Record<string, string> = {}
  if (err.extra.retryAfter !== undefined) {
    body.error.retryAfter = err.extra.retryAfter
    headers['retry-after'] = String(err.extra.retryAfter)
  }
  if (err.extra.resetAt !== undefined) body.error.resetAt = err.extra.resetAt
  if (err.extra.allow !== undefined) headers.allow = err.extra.allow
  return json(body, err.extra.cache ?? CACHE.none, err.status, headers)
}

export const badRequest = () =>
  new ApiErr(400, 'bad_request', 'The request is not valid.')
