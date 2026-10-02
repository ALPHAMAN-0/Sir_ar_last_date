// A small request queue for the page. It limits how many requests run at once,
// retries temporary failures, and stops politely when a limit is reached.

import type { ApiErrorBody } from '../../shared/api.ts'

export type PauseReason = 'rate_limited' | 'quota_reserved' | 'github_throttled'
export type Pause = { until: number; reason: PauseReason }

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfter: number | null
  readonly resetAt: string | null

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { retryAfter?: number; resetAt?: string } = {},
  ) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfter = extra.retryAfter ?? null
    this.resetAt = extra.resetAt ?? null
  }
}

export type ClientOptions = {
  concurrency?: number
  fetchImpl?: typeof fetch
  now?: () => number
  /** Schedules `run` after `ms`. Replaced in tests. */
  schedule?: (run: () => void, ms: number) => void
  onPause?: (pause: Pause | null) => void
}

type Job = {
  url: string
  priority: number
  attempts: number
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

const MAX_ATTEMPTS = 3
const BACKOFF_MS = [1_000, 3_000]
const DEFAULT_RETRY_S = 30

export type ApiClient = {
  /** GET a same-origin API URL. Lower `priority` runs first. Identical URLs share one request. */
  get<T>(url: string, priority?: number): Promise<T>
  pause(): Pause | null
}

export function createClient(options: ClientOptions = {}): ApiClient {
  const concurrency = options.concurrency ?? 6
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? ((run, ms) => void setTimeout(run, ms))

  const queue: Job[] = []
  const inFlight = new Map<string, Promise<unknown>>()
  let active = 0
  let pause: Pause | null = null

  const currentPause = (): Pause | null => {
    if (pause && pause.until <= now()) {
      pause = null
      options.onPause?.(null)
    }
    return pause
  }

  const setPause = (reason: PauseReason, until: number) => {
    if (pause && pause.until >= until) return
    pause = { reason, until }
    options.onPause?.(pause)
    schedule(pump, Math.max(0, until - now()) + 50)
  }

  const enqueue = (job: Job) => {
    // Keep the queue ordered by priority; first come, first served within one.
    let index = queue.length
    while (index > 0 && queue[index - 1].priority > job.priority) index--
    queue.splice(index, 0, job)
    pump()
  }

  const retryLater = (job: Job, delayMs: number) => {
    job.attempts++
    schedule(() => enqueue(job), delayMs)
  }

  async function run(job: Job): Promise<void> {
    let res: Response
    try {
      res = await fetchImpl(job.url, { headers: { accept: 'application/json' } })
    } catch {
      if (job.attempts < BACKOFF_MS.length) return retryLater(job, BACKOFF_MS[job.attempts])
      return job.reject(new ApiError(0, 'network', 'No connection to the server.'))
    }

    // Cloudflare's own error pages are HTML, not JSON.
    const body = (await res.json().catch(() => null)) as unknown
    if (res.ok && body !== null) return job.resolve(body)

    const detail = (body as ApiErrorBody | null)?.error
    const code = detail?.code ?? 'platform_error'
    const message = detail?.message ?? 'The server is not available right now.'
    const headerRetry = Number(res.headers.get('retry-after') ?? NaN)
    const retryAfter = detail?.retryAfter ?? (Number.isFinite(headerRetry) ? headerRetry : undefined)
    const error = new ApiError(res.status, code, message, { retryAfter, resetAt: detail?.resetAt })

    if (res.status === 429 || code === 'github_throttled') {
      // A short wait: hold the whole queue, then try this request again.
      const reason: PauseReason = res.status === 429 ? 'rate_limited' : 'github_throttled'
      const waitMs = (retryAfter ?? DEFAULT_RETRY_S) * 1000
      setPause(reason, now() + waitMs)
      if (job.attempts < MAX_ATTEMPTS - 1) return retryLater(job, waitMs + 100)
      return job.reject(error)
    }
    if (code === 'quota_reserved') {
      // The hourly limit is gone. Waiting could take most of an hour, so fail
      // everything now and let the page say when to come back.
      const until = detail?.resetAt ? Date.parse(detail.resetAt) : now() + 15 * 60_000
      setPause('quota_reserved', until)
      for (const waiting of queue.splice(0)) waiting.reject(error)
      return job.reject(error)
    }
    if (res.status >= 500 && job.attempts < BACKOFF_MS.length) {
      return retryLater(job, BACKOFF_MS[job.attempts])
    }
    job.reject(error)
  }

  function pump(): void {
    if (currentPause()) return
    while (active < concurrency && queue.length > 0) {
      const job = queue.shift() as Job
      active++
      void run(job).finally(() => {
        active--
        pump()
      })
    }
  }

  return {
    get<T>(url: string, priority = 1): Promise<T> {
      const existing = inFlight.get(url)
      if (existing) return existing as Promise<T>
      const blocked = currentPause()
      if (blocked?.reason === 'quota_reserved') {
        return Promise.reject(
          new ApiError(503, 'quota_reserved', 'The shared GitHub limit is used up for this hour.', {
            resetAt: new Date(blocked.until).toISOString(),
          }),
        )
      }
      const promise = new Promise<unknown>((resolve, reject) => {
        enqueue({ url, priority, attempts: 0, resolve, reject })
      }).finally(() => inFlight.delete(url))
      inFlight.set(url, promise)
      return promise as Promise<T>
    },
    pause: currentPause,
  }
}
