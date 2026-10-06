// Shared types for the similarity checker. Kept free of browser APIs so they
// can be imported from the page, the Web Worker and the tests alike.

import type { TreeFile } from '../../shared/api.ts'

/** Why a file is left out before anything is compared. See rules.ts. */
export type SkipReason = 'thirdParty' | 'tool' | 'binary' | 'tiny'
export type SkipCounts = Record<SkipReason, number>

/** The files of one repo that are worth comparing, plus what was left out. */
export type RepoFiles = {
  /** Canonical repo key: lowercase `owner/name`. */
  repo: string
  /** The default branch the files come from. */
  branch: string
  /** Head commit of that branch. */
  headOid: string
  /** Files that passed the fixed rules, sorted by path. */
  files: TreeFile[]
  /** How many files each rule left out. */
  skipped: SkipCounts
  /** Third-party folders of a very large repo that were never opened. */
  unopened: number
}

/**
 * `same_repo`: one repo handed in by several people, so every file is the same.
 * `thin`: identical files exist, but too few and too small to weigh by percentage.
 */
export type Tier = 'same_repo' | 'almost_all' | 'most' | 'part' | 'little' | 'thin'

/** One pair of repos that have something in common. */
export type PairSummary = {
  aKey: string
  bKey: string
  /** Files of A whose exact content is also somewhere in B. */
  aIdentical: number
  /** Files of B whose exact content is also somewhere in A. */
  bIdentical: number
  /** Different contents the two repos share. */
  identical: number
  /** Total size of those contents. */
  identicalBytes: number
  /** Files of each repo that count: after the fixed rules, without starter files. */
  aOwn: number
  bOwn: number
  /** aIdentical / aOwn and bIdentical / bOwn, in [0, 1]. */
  aShare: number
  bShare: number
  /** The larger of the two shares: how much of one repo is inside the other. */
  score: number
  /** Same path in both repos, different content, and not a path most repos use. */
  sameName: number
  /** Both repos are at the very same commit: one is a copy of the other's history. */
  sameCommit: boolean
  tier: Tier
}

export type RepoStats = {
  repo: string
  /** Files left after the fixed rules. */
  counted: number
  /** Of those, files that more repos share than the limit allows. */
  starter: number
  /** counted - starter: what the pair percentages are measured against. */
  own: number
}

/** A file content that so many repos have that it is treated as handed out. */
export type StarterFile = { sha: string; path: string; size: number; repos: number }

export type Analysis = {
  /** A content found in more repos than this is a starter file. */
  commonLimit: number
  repos: RepoStats[]
  /** Pairs that share at least one identical file, strongest first. */
  pairs: PairSummary[]
  /** All pairs the repos with files of their own can form: n(n-1)/2. */
  totalPairs: number
  /** Most widespread first. */
  starter: StarterFile[]
  /** File names used by more repos than the limit: no evidence of anything. */
  commonPaths: string[]
}

/** A file both repos hold with identical content. The two paths can differ. */
export type MatchedFile = { aPath: string; bPath: string; size: number }
export type RenamedFile = { path: string; aSize: number; bSize: number }

export type PairDetail = {
  identical: MatchedFile[]
  /** Same path, different content. */
  sameName: RenamedFile[]
  /** Counted files with no counterpart at all. */
  onlyA: number
  onlyB: number
  /** Starter files that both repos have. They are not counted. */
  starter: number
}
