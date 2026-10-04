// Shared types for the similarity checker. Kept pure so they can be
// imported from both the page and the Web Worker without dragging in
// any browser APIs.

/** The set of file paths in one repo, plus enough context to identify it. */
export type FileTree = {
  /** Canonical repo key: lowercase `owner/name`. */
  repo: string
  /** The default branch the paths come from. */
  branch: string
  /** Head commit of that branch at fetch time. */
  headOid: string
  /** ISO timestamp from the GitHub API. */
  fetchedAt: string
  /** Unique file paths, sorted. Includes every blob, not directories. */
  paths: string[]
}

/** The input shape for `compareAll`. */
export type TreeMap = Map<string, FileTree>

/** One compared pair. Score is Jaccard overlap of paths. */
export type Pair = {
  aKey: string
  bKey: string
  aBranch: string
  bBranch: string
  aHeadOid: string
  bHeadOid: string
  /** |A ∩ B|, the number of paths in both repos. */
  overlap: number
  /** |A ∪ B|, the number of unique paths across both repos. */
  union: number
  /** Jaccard similarity, overlap / union, in [0, 1]. */
  score: number
  /** Paths present in both A and B, sorted. */
  shared: string[]
  /** Paths only in A, sorted. */
  onlyA: string[]
  /** Paths only in B, sorted. */
  onlyB: string[]
}

/** Human-friendly tier labels, derived from `score`. */
export type Tier = 'very_similar' | 'similar' | 'some_overlap' | 'different'

/** Progress event from the Web Worker. */
export type CompareProgress = {
  done: number
  total: number
  current?: string
}