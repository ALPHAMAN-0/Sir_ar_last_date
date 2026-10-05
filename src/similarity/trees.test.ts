import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearCache, fetchAll, fetchTree } from './trees.ts'

const REPO = 'octocat/hello-world'
const SHA = 'a'.repeat(40)

/** A minimal in-memory `sessionStorage` for tests. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage
}

let calls: string[]
let handler: (url: string) => Response
let storage: Storage

beforeEach(() => {
  calls = []
  storage = memoryStorage()
  handler = () => new Response('{}')
})

afterEach(() => {
  clearCache(storage)
})

describe('fetchTree', () => {
  it('hits the Worker /api/v1/tree and reads pre-cleaned paths', async () => {
    handler = () =>
      new Response(
        JSON.stringify({
          fetchedAt: '2026-10-05T00:00:00Z',
          paths: ['README.md', 'src/main.js'],
          truncated: false,
        }),
      )
    const result = await fetchTree(REPO, SHA, 'main', {
      fetchImpl: async (input) => {
        calls.push(String(input))
        return handler(String(input))
      },
      storage,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.fromCache).toBe(false)
    expect(result.tree.paths).toEqual(['README.md', 'src/main.js'])
    expect(result.tree.branch).toBe('main')
    expect(result.tree.fetchedAt).toBe('2026-10-05T00:00:00Z')
    expect(calls).toEqual([`/api/v1/tree?repo=${encodeURIComponent(REPO)}&sha=${SHA}`])
  })

  it('returns blob paths sorted and unique', async () => {
    handler = () =>
      new Response(
        JSON.stringify({
          fetchedAt: '2026-10-05T00:00:00Z',
          paths: ['README.md', 'src/main.js'],
          truncated: false,
        }),
      )
    const result = await fetchTree(REPO, SHA, 'main', {
      fetchImpl: async () => handler(''),
      storage,
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.tree.paths).toEqual(['README.md', 'src/main.js'])
  })

  it('serves the second call from sessionStorage without a network hit', async () => {
    handler = () =>
      new Response(
        JSON.stringify({
          fetchedAt: '2026-10-05T00:00:00Z',
          paths: ['a.txt'],
          truncated: false,
        }),
      )
    const first = await fetchTree(REPO, SHA, 'main', {
      fetchImpl: async () => {
        calls.push('net')
        return handler('')
      },
      storage,
    })
    const second = await fetchTree(REPO, SHA, 'main', {
      fetchImpl: async () => {
        calls.push('net')
        return handler('')
      },
      storage,
    })
    expect(first.ok && first.fromCache).toBe(false)
    expect(second.ok && second.fromCache).toBe(true)
    expect(calls).toEqual(['net'])
  })

  it('honours the cache TTL', async () => {
    let now = 1_000_000
    handler = () =>
      new Response(
        JSON.stringify({
          fetchedAt: '2026-10-05T00:00:00Z',
          paths: ['a.txt'],
          truncated: false,
        }),
      )
    const fetchImpl = async () => {
      calls.push('net')
      return handler('')
    }
    await fetchTree(REPO, SHA, 'main', { fetchImpl, storage, now: () => now })
    now += 60 * 60 * 1000 + 1
    await fetchTree(REPO, SHA, 'main', { fetchImpl, storage, now: () => now })
    expect(calls).toEqual(['net', 'net'])
  })

  it('treats a truncated tree as an error, not a partial success', async () => {
    handler = () =>
      new Response(
        JSON.stringify({
          fetchedAt: '2026-10-05T00:00:00Z',
          paths: ['a.txt'],
          truncated: true,
        }),
      )
    const result = await fetchTree(REPO, SHA, 'main', {
      fetchImpl: async () => handler(''),
      storage,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('truncated')
  })

  it('maps 429 to a friendly rate-limit message', async () => {
    handler = () => new Response('{}', { status: 429 })
    const result = await fetchTree(REPO, SHA, 'main', {
      fetchImpl: async () => handler(''),
      storage,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('http')
    if (result.error.kind !== 'http') return
    expect(result.error.status).toBe(429)
    expect(result.error.message).toMatch(/wait/i)
  })

  it('maps 404 to a not-found error', async () => {
    handler = () => new Response('{}', { status: 404 })
    const result = await fetchTree(REPO, SHA, 'main', {
      fetchImpl: async () => handler(''),
      storage,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('http')
    if (result.error.kind !== 'http') return
    expect(result.error.status).toBe(404)
  })

  it('maps a network failure', async () => {
    const result = await fetchTree(REPO, SHA, 'main', {
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
      storage,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('network')
  })

  it('maps a malformed JSON body', async () => {
    handler = () => new Response('not json', { status: 200 })
    const result = await fetchTree(REPO, SHA, 'main', {
      fetchImpl: async () => handler(''),
      storage,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('malformed')
  })
})

describe('fetchAll', () => {
  it('deduplicates by repo@headOid and caps concurrency', async () => {
    let running = 0
    let peak = 0
    const inputs = Array.from({ length: 12 }, (_, i) => ({
      repo: `octocat/repo-${i}`,
      headOid: SHA,
      branch: 'main',
    }))
    inputs.push({ repo: 'octocat/repo-0', headOid: SHA, branch: 'main' })

    handler = () =>
      new Response(
        JSON.stringify({
          fetchedAt: '2026-10-05T00:00:00Z',
          paths: ['a.txt'],
          truncated: false,
        }),
      )
    const result = await fetchAll(inputs, {
      concurrency: 4,
      storage,
      fetchImpl: async () => {
        running++
        peak = Math.max(peak, running)
        await Promise.resolve()
        running--
        return handler('')
      },
    })

    expect(result.trees.size).toBe(12)
    expect(result.errors.size).toBe(0)
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  it('reports progress and records per-repo errors', async () => {
    handler = (url) => {
      if (url.includes('repo-1')) return new Response('{}', { status: 404 })
      return new Response(
        JSON.stringify({
          fetchedAt: '2026-10-05T00:00:00Z',
          paths: ['a.txt'],
          truncated: false,
        }),
      )
    }
    const events: Array<{ done: number; total: number; current: string }> = []
    const result = await fetchAll(
      [
        { repo: 'octocat/repo-0', headOid: SHA, branch: 'main' },
        { repo: 'octocat/repo-1', headOid: SHA, branch: 'main' },
      ],
      {
        concurrency: 1,
        storage,
        fetchImpl: async (input) => handler(String(input)),
        onProgress: (done, total, current) => events.push({ done, total, current }),
      },
    )
    expect(result.trees.size).toBe(1)
    expect(result.errors.size).toBe(1)
    expect(result.errors.get('octocat/repo-1')?.kind).toBe('http')
    expect(events.at(-1)).toEqual({ done: 2, total: 2, current: 'octocat/repo-1' })
  })
})

describe('clearCache', () => {
  it('removes only the tree cache keys', () => {
    storage.setItem('sirar:tree:a/b@c', JSON.stringify({ paths: [], fetchedAt: '', branch: '' }))
    storage.setItem('sirar:v1', 'other')
    clearCache(storage)
    expect(storage.getItem('sirar:tree:a/b@c')).toBeNull()
    expect(storage.getItem('sirar:v1')).not.toBeNull()
  })
})