import { describe, expect, it } from 'vitest'
import { compareAll, comparePair, jaccard, pairCount, tier } from './compare.ts'
import type { FileTree, TreeMap } from './types.ts'

const A = 'a/repo'
const B = 'b/repo'
const C = 'c/repo'

const tree = (repo: string, paths: string[]): FileTree => ({
  repo,
  branch: 'main',
  headOid: 'a'.repeat(40),
  fetchedAt: '2026-10-04T00:00:00Z',
  paths,
})

describe('jaccard', () => {
  it('is 0 for empty sets', () => {
    expect(jaccard(0, 0)).toBe(0)
  })

  it('is 1 when both sets are identical', () => {
    expect(jaccard(3, 3)).toBe(1)
  })

  it('is 0 when sets are disjoint', () => {
    expect(jaccard(0, 5)).toBe(0)
  })

  it('matches the manual calculation', () => {
    // 2 of 4 unique
    expect(jaccard(2, 4)).toBe(0.5)
  })
})

describe('comparePair', () => {
  it('reports the overlap and the unique paths', () => {
    const pair = comparePair(
      A,
      'main',
      'aaa',
      ['README.md', 'src/main.js', 'src/util.js'],
      B,
      'main',
      'bbb',
      ['README.md', 'src/main.js', 'src/lib.js'],
    )
    expect(pair.overlap).toBe(2)
    expect(pair.union).toBe(4)
    expect(pair.score).toBe(0.5)
    expect(pair.shared).toEqual(['README.md', 'src/main.js'])
    expect(pair.onlyA).toEqual(['src/util.js'])
    expect(pair.onlyB).toEqual(['src/lib.js'])
  })

  it('is 1 when the paths are identical', () => {
    const pair = comparePair(A, 'main', 'a', ['x', 'y'], B, 'main', 'b', ['y', 'x'])
    expect(pair.score).toBe(1)
    expect(pair.shared).toEqual(['x', 'y'])
    expect(pair.onlyA).toEqual([])
    expect(pair.onlyB).toEqual([])
  })

  it('is 0 when nothing overlaps', () => {
    const pair = comparePair(A, 'main', 'a', ['x', 'y'], B, 'main', 'b', ['p', 'q'])
    expect(pair.score).toBe(0)
    expect(pair.shared).toEqual([])
    expect(pair.onlyA).toEqual(['x', 'y'])
    expect(pair.onlyB).toEqual(['p', 'q'])
  })

  it('handles empty repos on one side', () => {
    const pair = comparePair(A, 'main', 'a', ['x', 'y'], B, 'main', 'b', [])
    expect(pair.score).toBe(0)
    expect(pair.overlap).toBe(0)
    expect(pair.union).toBe(2)
  })

  it('handles empty repos on both sides', () => {
    const pair = comparePair(A, 'main', 'a', [], B, 'main', 'b', [])
    expect(pair.score).toBe(0)
    expect(pair.union).toBe(0)
  })

  it('deduplicates paths before comparing', () => {
    const pair = comparePair(A, 'main', 'a', ['x', 'x', 'y'], B, 'main', 'b', ['x', 'y'])
    expect(pair.overlap).toBe(2)
    expect(pair.union).toBe(2)
    expect(pair.score).toBe(1)
  })
})

describe('compareAll', () => {
  it('returns an empty list for fewer than two trees', () => {
    expect(compareAll(new Map())).toEqual([])
    const one = new Map([[A, tree(A, ['x'])]])
    expect(compareAll(one)).toEqual([])
  })

  it('returns exactly one pair for two trees', () => {
    const trees: TreeMap = new Map([
      [A, tree(A, ['x'])],
      [B, tree(B, ['x'])],
    ])
    const pairs = compareAll(trees)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ aKey: A, bKey: B, score: 1 })
  })

  it('returns N(N-1)/2 pairs in a deterministic order', () => {
    const trees: TreeMap = new Map([
      [A, tree(A, ['x'])],
      [B, tree(B, ['y'])],
      [C, tree(C, ['z'])],
    ])
    const pairs = compareAll(trees)
    expect(pairs).toHaveLength(3)
    expect(pairs.map((p) => [p.aKey, p.bKey])).toEqual([
      [A, B],
      [A, C],
      [B, C],
    ])
  })

  it('scales to a 100-repo class in well under 50ms', () => {
    const trees: TreeMap = new Map()
    for (let i = 0; i < 100; i++) {
      const repo = `u/r${i}`
      const paths = Array.from({ length: 30 }, (_, k) => `src/file-${k % 10}.js`)
      trees.set(repo, tree(repo, paths))
    }
    const start = performance.now()
    const pairs = compareAll(trees)
    const took = performance.now() - start
    expect(pairs).toHaveLength(4950)
    expect(took).toBeLessThan(50)
  })
})

describe('pairCount', () => {
  it('is 0 for 0 or 1 trees', () => {
    expect(pairCount(0)).toBe(0)
    expect(pairCount(1)).toBe(0)
  })

  it('is N(N-1)/2', () => {
    expect(pairCount(2)).toBe(1)
    expect(pairCount(30)).toBe(435)
    expect(pairCount(200)).toBe(19900)
  })
})

describe('tier', () => {
  it('matches the documented boundaries', () => {
    expect(tier(0)).toBe('different')
    expect(tier(0.19)).toBe('different')
    expect(tier(0.2)).toBe('some_overlap')
    expect(tier(0.49)).toBe('some_overlap')
    expect(tier(0.5)).toBe('similar')
    expect(tier(0.79)).toBe('similar')
    expect(tier(0.8)).toBe('very_similar')
    expect(tier(1)).toBe('very_similar')
  })
})

/**
 * User journey: an instructor uploads a sheet, clicks "Similarity", and the
 * table shows the right pair at the top, with the right percentage. This test
 * pins that single user-visible promise end-to-end so a refactor of `compareAll`
 * can't silently change which pair the UI calls out as the most-similar one.
 */
describe('user journey: which two repos match, and by what %', () => {
  const trees: TreeMap = new Map([
    [A, tree(A, ['index.html', 'style.css', 'app.js', 'README.md'])],
    // B is a verbatim copy of A: identical paths -> 100%.
    [B, tree(B, ['index.html', 'style.css', 'app.js', 'README.md'])],
    // C overlaps with A on 2 of 6 unique paths -> overlap=2, union=6, score=1/3.
    [C, tree(C, ['index.html', 'style.css', 'main.go', 'go.mod'])],
  ])

  it('puts the verbatim-copy pair at the top of the report', () => {
    const pairs = compareAll(trees).slice().sort((p, q) => q.score - p.score)
    expect(pairs[0].aKey).toBe(A)
    expect(pairs[0].bKey).toBe(B)
    expect(pairs[0].score).toBe(1)
    expect(pairs[0].shared).toEqual(['README.md', 'app.js', 'index.html', 'style.css'])
  })

  it('reports the A-C overlap as one-third, not as a copy', () => {
    const pair = compareAll(trees).find((p) =>
      (p.aKey === A && p.bKey === C) || (p.aKey === C && p.bKey === A),
    )
    expect(pair?.score).toBeCloseTo(1 / 3, 5)
    expect(pair?.overlap).toBe(2)
    expect(pair?.union).toBe(6)
    expect(tier(pair!.score)).toBe('some_overlap')
  })

  it('lists every unique pair and no duplicates', () => {
    const pairs = compareAll(trees)
    expect(pairs).toHaveLength(3) // N=3 -> 3*2/2
    const keys = pairs.map((p) => [p.aKey, p.bKey].sort().join('|')).sort()
    expect(keys).toEqual([
      [A, B].sort().join('|'),
      [A, C].sort().join('|'),
      [B, C].sort().join('|'),
    ])
  })
})