// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { statusUrl } from '../../shared/api.ts'
import { formatTime } from '../logic/time.ts'

/** A fresh store whose next request is answered with `status` and `error`. */
async function setup(status: number, error: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ error }), { status })),
  )
  vi.resetModules()
  const store = await import('../state/store.ts')
  const { PauseNotice } = await import('./PauseNotice.tsx')
  render(<PauseNotice />)
  return store
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PauseNotice', () => {
  it('shows nothing while requests run normally', async () => {
    await setup(200, {})
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says when checking goes on after too many requests', async () => {
    const store = await setup(429, { code: 'rate_limited', message: 'Slow down.', retryAfter: 600 })
    // The request is retried after the wait, so it is left pending here.
    void store.client.get(statusUrl())
    const notice = await screen.findByRole('status')
    const until = store.getState().pause?.until as number
    expect(notice.textContent).toBe(
      `Too many requests at once. Checking continues by itself at ${formatTime(until)}.`,
    )
  })

  it('says when to press Refresh once the shared hourly limit is used up', async () => {
    // Always ahead of the clock: a reset time in the past ends the pause at once.
    const resetAt = new Date(Date.now() + 30 * 60_000).toISOString()
    const store = await setup(503, { code: 'quota_reserved', message: 'Used up.', resetAt })
    await expect(store.client.get(statusUrl())).rejects.toThrow('Used up.')
    expect((await screen.findByRole('status')).textContent).toBe(
      'The GitHub limit shared by everyone using this page is used up for this hour. ' +
        `Press Refresh after ${formatTime(resetAt)}.`,
    )
  })
})
