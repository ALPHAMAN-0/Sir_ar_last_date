// The comparison itself. Pure: no network, no DOM, safe in a Web Worker and in
// Node for tests.
//
// Two files are "identical" when git gives them the same content hash. That is
// a byte-for-byte match, whatever the files are called. A renamed copy is still
// a match; a copy with one changed character is not.
//
// A content that MANY repos hold is not evidence: it was handed out by the
// teacher or written by a project generator. Those "starter files" are left
// out of both sides of every percentage.

import type { TreeFile } from '../../shared/api.ts'
import type {
  Analysis,
  PairDetail,
  PairSummary,
  RepoFiles,
  RepoStats,
  StarterFile,
  Tier,
} from './types.ts'

/**
 * A match counts as real material from 3 identical files, or 1 KB of identical
 * content, upwards. Below that it is "thin": two students who both left a
 * 300-byte template untouched share 100% of very little.
 */
export const STRONG_FILES = 3
export const STRONG_BYTES = 1024

/**
 * How many repos may share a content before it is treated as a starter file.
 * A fifth of the class, but never fewer than 4 (so a group of four copying one
 * solution is still caught) and never more than 10.
 */
export function defaultCommonLimit(repoCount: number): number {
  return Math.min(10, Math.max(4, Math.round(repoCount * 0.2)))
}

/** Total pair count for N repos. */
export function pairCount(repoCount: number): number {
  return repoCount < 2 ? 0 : (repoCount * (repoCount - 1)) / 2
}

type Evidence = Pick<PairSummary, 'identical' | 'identicalBytes' | 'score'>

/** The label for a pair: by share when there is real material, `thin` when there is not. */
export function tier({ identical, identicalBytes, score }: Evidence): Tier {
  if (identical < STRONG_FILES && identicalBytes < STRONG_BYTES) return 'thin'
  if (score >= 0.8) return 'almost_all'
  if (score >= 0.5) return 'most'
  if (score >= 0.2) return 'part'
  return 'little'
}

const TIER_RANK: Record<Tier, number> = { almost_all: 0, most: 1, part: 2, little: 3, thin: 4 }

/** One repo, with its starter files taken out and its own files indexed. */
type Prepared = {
  repo: RepoFiles
  own: TreeFile[]
  byContent: Map<string, TreeFile[]>
  byPath: Map<string, TreeFile>
  starter: number
}

function prepare(repo: RepoFiles, isStarter: (sha: string) => boolean): Prepared {
  const own: TreeFile[] = []
  const byContent = new Map<string, TreeFile[]>()
  const byPath = new Map<string, TreeFile>()
  let starter = 0
  for (const file of repo.files) {
    if (isStarter(file.sha)) {
      starter++
      continue
    }
    own.push(file)
    byPath.set(file.path, file)
    const same = byContent.get(file.sha)
    if (same) same.push(file)
    else byContent.set(file.sha, [file])
  }
  return { repo, own, byContent, byPath, starter }
}

type Measured = Pick<PairSummary, 'aIdentical' | 'bIdentical' | 'identical' | 'identicalBytes' | 'sameName'>

function measure(a: Prepared, b: Prepared, isCommonPath: (path: string) => boolean): Measured {
  let aIdentical = 0
  let sameName = 0
  let identicalBytes = 0
  const shared = new Set<string>()
  for (const file of a.own) {
    if (b.byContent.has(file.sha)) {
      aIdentical++
      if (!shared.has(file.sha)) {
        shared.add(file.sha)
        identicalBytes += file.size
      }
      continue
    }
    if (isCommonPath(file.path)) continue
    // Same place, other content. Not counted when B's file is simply A's file under another name.
    const there = b.byPath.get(file.path)
    if (there && !a.byContent.has(there.sha)) sameName++
  }
  let bIdentical = 0
  for (const file of b.own) if (a.byContent.has(file.sha)) bIdentical++
  return { aIdentical, bIdentical, identical: shared.size, identicalBytes, sameName }
}

/** In how many repos each value appears. A repo counts once, however often it holds the value. */
function countRepos(repos: readonly RepoFiles[], pick: (file: TreeFile) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const repo of repos) {
    const seen = new Set<string>()
    for (const file of repo.files) {
      const value = pick(file)
      if (seen.has(value)) continue
      seen.add(value)
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  return counts
}

export type AnalyseOptions = {
  /** Overrides `defaultCommonLimit`. Values below 2 are raised to 2: a pair must stay possible. */
  commonLimit?: number
}

/**
 * Compares every repo with every other. Only pairs that share something are
 * returned, so a class of 200 does not produce 19,900 rows of zeros.
 */
export function analyse(repos: readonly RepoFiles[], options: AnalyseOptions = {}): Analysis {
  const commonLimit = Math.max(2, Math.floor(options.commonLimit ?? defaultCommonLimit(repos.length)))
  const contentRepos = countRepos(repos, (file) => file.sha)
  const pathRepos = countRepos(repos, (file) => file.path)
  const isStarter = (sha: string) => (contentRepos.get(sha) ?? 0) > commonLimit
  const isCommonPath = (path: string) => (pathRepos.get(path) ?? 0) > commonLimit

  const prepared = repos.map((repo) => prepare(repo, isStarter))

  // Only repos that hold the same content can form a pair. Looking them up by
  // content, instead of trying all n(n-1)/2 pairs, keeps a class of 200 fast.
  const count = prepared.length
  const holders = new Map<string, number[]>()
  prepared.forEach((entry, index) => {
    for (const sha of entry.byContent.keys()) {
      const list = holders.get(sha)
      if (list) list.push(index)
      else holders.set(sha, [index])
    }
  })
  const candidates = new Set<number>()
  for (const list of holders.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) candidates.add(list[i] * count + list[j])
    }
  }

  const pairs: PairSummary[] = []
  for (const code of candidates) {
    const a = prepared[Math.floor(code / count)]
    const b = prepared[code % count]
    const measured = measure(a, b, isCommonPath)
    const aOwn = a.own.length
    const bOwn = b.own.length
    const aShare = measured.aIdentical / aOwn
    const bShare = measured.bIdentical / bOwn
    const score = Math.max(aShare, bShare)
    pairs.push({
      aKey: a.repo.repo,
      bKey: b.repo.repo,
      ...measured,
      aOwn,
      bOwn,
      aShare,
      bShare,
      score,
      sameCommit: a.repo.headOid === b.repo.headOid,
      tier: tier({ ...measured, score }),
    })
  }
  pairs.sort(
    (x, y) =>
      TIER_RANK[x.tier] - TIER_RANK[y.tier] ||
      y.score - x.score ||
      y.identical - x.identical ||
      y.sameName - x.sameName ||
      x.aKey.localeCompare(y.aKey) ||
      x.bKey.localeCompare(y.bKey),
  )

  const stats: RepoStats[] = prepared.map((entry) => ({
    repo: entry.repo.repo,
    counted: entry.repo.files.length,
    starter: entry.starter,
    own: entry.own.length,
  }))

  // One line per starter content, under the name most repos give it.
  const starterNames = new Map<string, { size: number; names: Map<string, number> }>()
  for (const repo of repos) {
    for (const file of repo.files) {
      if (!isStarter(file.sha)) continue
      let entry = starterNames.get(file.sha)
      if (!entry) starterNames.set(file.sha, (entry = { size: file.size, names: new Map() }))
      entry.names.set(file.path, (entry.names.get(file.path) ?? 0) + 1)
    }
  }
  const starter: StarterFile[] = [...starterNames].map(([sha, entry]) => ({
    sha,
    path: [...entry.names].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0],
    size: entry.size,
    repos: contentRepos.get(sha) ?? 0,
  }))
  starter.sort((x, y) => y.repos - x.repos || x.path.localeCompare(y.path))

  const commonPaths = [...pathRepos].filter(([, repoCount]) => repoCount > commonLimit).map(([path]) => path)

  // A repo with nothing of its own left cannot be part of any pair.
  const comparable = prepared.filter((entry) => entry.own.length > 0).length
  return { commonLimit, repos: stats, pairs, totalPairs: pairCount(comparable), starter, commonPaths }
}

export type Shared = { starter: ReadonlySet<string>; commonPaths: ReadonlySet<string> }

/** The two lookups `pairDetail` needs, built once per analysis. */
export function sharedSets(analysis: Pick<Analysis, 'starter' | 'commonPaths'>): Shared {
  return {
    starter: new Set(analysis.starter.map((file) => file.sha)),
    commonPaths: new Set(analysis.commonPaths),
  }
}

/** The files behind one pair's numbers. Worked out only when someone opens the pair. */
export function pairDetail(a: RepoFiles, b: RepoFiles, shared: Shared): PairDetail {
  const isStarter = (sha: string) => shared.starter.has(sha)
  const left = prepare(a, isStarter)
  const right = prepare(b, isStarter)
  const detail: PairDetail = { identical: [], sameName: [], onlyA: 0, onlyB: 0, starter: 0 }

  for (const file of left.own) {
    const twins = right.byContent.get(file.sha)
    if (twins) {
      // Prefer the twin at the same path, so an unmoved file reads as unmoved.
      const twin = twins.find((other) => other.path === file.path) ?? twins[0]
      detail.identical.push({ aPath: file.path, bPath: twin.path, size: file.size })
      continue
    }
    const there = shared.commonPaths.has(file.path) ? undefined : right.byPath.get(file.path)
    if (there && !left.byContent.has(there.sha)) {
      detail.sameName.push({ path: file.path, aSize: file.size, bSize: there.size })
    } else {
      detail.onlyA++
    }
  }
  const renamed = new Set(detail.sameName.map((file) => file.path))
  for (const file of right.own) {
    if (!left.byContent.has(file.sha) && !renamed.has(file.path)) detail.onlyB++
  }

  const starterOfB = new Set(b.files.filter((file) => isStarter(file.sha)).map((file) => file.sha))
  detail.starter = new Set(
    a.files.filter((file) => starterOfB.has(file.sha)).map((file) => file.sha),
  ).size

  detail.identical.sort((x, y) => y.size - x.size || x.aPath.localeCompare(y.aPath))
  detail.sameName.sort((x, y) => x.path.localeCompare(y.path))
  return detail
}
