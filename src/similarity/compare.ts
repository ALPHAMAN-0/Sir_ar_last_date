// Pure comparison logic: for every pair of repos, compute Jaccard
// similarity of their file-path sets. No I/O, no DOM. Safe to run in a
// Web Worker or in Node for tests.

import type { Pair, TreeMap } from './types.ts'

/** Jaccard similarity of two path sets. 0 when union is 0. */
export function jaccard(overlap: number, union: number): number {
  return union === 0 ? 0 : overlap / union
}

/**
 * Build a sorted, unique copy of the input paths. Used to make sure the
 * inputs are well-formed even when they come from outside this package.
 */
function uniqueSorted(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const path of paths) seen.add(path)
  return [...seen].sort()
}

/**
 * Compare one pair. Inputs are assumed already-deduplicated and sorted,
 * but this function tolerates unsorted input too.
 */
export function comparePair(
  aRepo: string,
  aBranch: string,
  aHead: string,
  aPaths: readonly string[],
  bRepo: string,
  bBranch: string,
  bHead: string,
  bPaths: readonly string[],
): Pair {
  const a = new Set(uniqueSorted(aPaths))
  const b = new Set(uniqueSorted(bPaths))
  const shared: string[] = []
  const onlyA: string[] = []
  for (const path of a) {
    if (b.has(path)) shared.push(path)
    else onlyA.push(path)
  }
  const onlyB: string[] = []
  for (const path of b) {
    if (!a.has(path)) onlyB.push(path)
  }
  const overlap = shared.length
  const union = a.size + b.size - overlap
  return {
    aKey: aRepo,
    bKey: bRepo,
    aBranch,
    bBranch,
    aHeadOid: aHead,
    bHeadOid: bHead,
    overlap,
    union,
    score: jaccard(overlap, union),
    shared,
    onlyA,
    onlyB,
  }
}

/**
 * Every unique pair of trees in the map. The order is deterministic: by
 * the insertion order of the input map, so two runs with the same input
 * produce the same pair list.
 */
export function compareAll(trees: TreeMap): Pair[] {
  const list = [...trees.values()]
  const pairs: Pair[] = []
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      pairs.push(comparePair(a.repo, a.branch, a.headOid, a.paths, b.repo, b.branch, b.headOid, b.paths))
    }
  }
  return pairs
}

/** Total pair count for N trees. */
export function pairCount(treeCount: number): number {
  return treeCount < 2 ? 0 : (treeCount * (treeCount - 1)) / 2
}

/** Tier label for a score. Boundaries match the plan. */
export function tier(score: number): 'very_similar' | 'similar' | 'some_overlap' | 'different' {
  if (score >= 0.8) return 'very_similar'
  if (score >= 0.5) return 'similar'
  if (score >= 0.2) return 'some_overlap'
  return 'different'
}