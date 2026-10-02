import { describe, expect, it } from 'vitest'
import { ApiError, createClient, type Pause } from './client.ts'

type Reply = { status?: number; body?: unknown; html?: boolean; headers?: Record<string, string> }
type Answer = Reply | Error

/** A fake server plus a fake clock: scheduled work runs only when `advance` is called. */
function harness(answer: (url: string, call: number) => Answer, concurrency = 2) {
  let time = 1_000_000
  const timers: Array<{ at: number; run: () => void }> = []
  const calls: string[] = []
  const pauses: Array<Pause | null> = []
  let running = 0
  let peak = 0
  const gates: Array<() => void> = []
  let gated = false

  const client = createClient({
    concurrency,
    now: () => time,
    schedule: (run, ms) => void timers.push({ at: time + ms, run }),
    onPause: (pause) => void pauses.push(pause),
    fetchImpl: async (input) => {
      const url = String(input)
      calls.push(url)
      running++
      peak = Math.max(peak, running)
      if (gated) await new Promise<void>((open) => gates.push(open))
      running--
      const reply = answer(url, calls.filter((seen) => seen === url).length)
      if (reply instanceof Error) throw reply
      return new Response(reply.html ? '<html>error</html>' : JSON.stringify(reply.body ?? {}), {
        status: reply.status ?? 200,
        headers: reply.headers,
      })
    },
  })

  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  return {
    client,
    calls,
    pauses,
    peak: () => peak,
    hold: () => void (gated = true),
    release: async () => {
      gated = false
      for (const open of gates.splice(0)) open()
      await settle()
    },
    settle,
    advance: async (ms: number) => {
      time += ms
      for (const timer of timers.splice(0)) {
        if (timer.at <= time) timer.run()
        else timers.push(timer)
      }
      await settle()
    },
  }
}

const failure = (code: string, extra: Record<string, unknown> = {}) => ({
  error: { code, message: `${code} happened`, ...extra },
})

describe('api client', () => {
  it('returns the JSON body', async () => {
    const h = harness(() => ({ body: { ok: 1 } }))
    await expect(h.client.get('/api/v1/status')).resolves.toEqual({ ok: 1 })
  })

  it('shares one request between identical URLs', async () => {
    const h = harness(() => ({ body: { ok: 1 } }))
    const [a, b] = await Promise.all([h.client.get('/x'), h.client.get('/x')])
    expect(a).toBe(b)
    expect(h.calls).toEqual(['/x'])
  })

  it('never runs more than the allowed number at once, lowest priority number first', async () => {
    const h = harness(() => ({ body: {} }), 2)
    h.hold()
    const all = Promise.all([
      h.client.get('/a', 1),
      h.client.get('/b', 1),
      h.client.get('/files', 2),
      h.client.get('/repos', 0),
    ])
    await h.settle()
    expect(h.calls).toEqual(['/a', '/b'])
    await h.release()
    await all
    expect(h.peak()).toBe(2)
    expect(h.calls).toEqual(['/a', '/b', '/repos', '/files'])
  })

  it('gives the server error code and message on a plain failure', async () => {
    const h = harness(() => ({ status: 400, body: failure('bad_request') }))
    const error = await h.client.get('/x').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, code: 'bad_request', message: 'bad_request happened' })
    expect(h.calls).toHaveLength(1)
  })

  it('understands an HTML error page from the platform', async () => {
    const h = harness(() => ({ status: 429, html: true, headers: { 'retry-after': '5' } }))
    const pending = h.client.get('/x').catch((caught: unknown) => caught)
    await h.settle()
    await h.advance(6_000)
    await h.advance(6_000)
    expect(await pending).toMatchObject({ status: 429, code: 'platform_error' })
  })

  it('waits and retries after a 429, then succeeds', async () => {
    const h = harness((_url, call) =>
      call === 1
        ? { status: 429, body: failure('rate_limited', { retryAfter: 30 }) }
        : { body: { ok: 1 } },
    )
    const pending = h.client.get('/x')
    await h.settle()
    expect(h.pauses[0]).toMatchObject({ reason: 'rate_limited' })
    expect(h.client.pause()?.reason).toBe('rate_limited')

    await h.advance(10_000)
    expect(h.calls).toHaveLength(1) // still waiting

    await h.advance(21_000)
    await expect(pending).resolves.toEqual({ ok: 1 })
    expect(h.calls).toHaveLength(2)
    expect(h.client.pause()).toBeNull()
  })

  it('gives up after three rate-limited attempts', async () => {
    const h = harness(() => ({ status: 429, body: failure('rate_limited', { retryAfter: 1 }) }))
    const pending = h.client.get('/x').catch((caught: unknown) => caught)
    for (let i = 0; i < 5; i++) await h.advance(2_000)
    expect(await pending).toMatchObject({ code: 'rate_limited' })
    expect(h.calls).toHaveLength(3)
  })

  it('fails everything at once when the hourly GitHub limit is gone', async () => {
    const resetAt = new Date(1_000_000 + 40 * 60_000).toISOString()
    const h = harness(() => ({ status: 503, body: failure('quota_reserved', { resetAt }) }), 1)
    const first = h.client.get('/a').catch((caught: unknown) => caught)
    const queued = h.client.get('/b').catch((caught: unknown) => caught)
    await h.settle()
    expect(await first).toMatchObject({ code: 'quota_reserved', resetAt })
    expect(await queued).toMatchObject({ code: 'quota_reserved' })
    expect(h.calls).toEqual(['/a']) // /b was never sent

    // New requests are refused locally until the reset time.
    const refused = await h.client.get('/c').catch((caught: unknown) => caught)
    expect(refused).toMatchObject({ code: 'quota_reserved' })
    expect(h.calls).toEqual(['/a'])
    expect(h.client.pause()).toMatchObject({ reason: 'quota_reserved', until: Date.parse(resetAt) })
  })

  it('retries server errors and network failures twice with a growing delay', async () => {
    const h = harness((_url, call) =>
      call < 3 ? { status: 502, body: failure('github_error') } : { body: { ok: 1 } },
    )
    const pending = h.client.get('/x')
    await h.settle()
    await h.advance(1_000)
    await h.advance(3_000)
    await expect(pending).resolves.toEqual({ ok: 1 })
    expect(h.calls).toHaveLength(3)

    const offline = harness(() => new TypeError('Failed to fetch'))
    const failed = offline.client.get('/x').catch((caught: unknown) => caught)
    await offline.settle()
    await offline.advance(1_000)
    await offline.advance(3_000)
    expect(await failed).toMatchObject({ status: 0, code: 'network' })
    expect(offline.calls).toHaveLength(3)
  })
})
