// The shared-code check: which repos hold the same code even where a copy was
// edited, so that no file is identical any more. Pure: no network, no DOM, safe
// in a Web Worker and in Node for tests.
//
// Every file's code is cut into fingerprints (codeText.ts). Two repos share code
// where they share fingerprints; the lines those fingerprints cover are the
// shared lines. Like a starter file, a fingerprint that MANY repos hold is not
// evidence: it is code that was handed out, shown in class or written by a
// generator. Such fingerprints are left out of both sides of every count.
//
// This is a pointer to where to look, never proof: two people can share code
// because both took it from the same place. It never says who copied.

import type { FilePrints } from './codeText.ts'

/** A pair is listed from this many shared lines on. Fewer is a common phrase or two. */
export const MIN_LISTED_LINES = 5
/**
 * From this many shared lines on, a pair is labelled by its share. Below it,
 * "a few lines": two people who both wrote a short, obvious loop share 100% of
 * very little.
 */
export const STRONG_LINES = 20

export type CodeFile = { path: string; sha: string; prints: FilePrints }
/** The files of one repo whose code was read. */
export type CodeRepo = { repo: string; files: CodeFile[] }

/** `thin`: shared lines exist, but too few to weigh by percentage. */
export type CodeTier = 'almost_all' | 'most' | 'part' | 'little' | 'thin'

/** One pair of repos that share code. Counts are lines of code, comments and blank lines left out. */
export type CodePair = {
  aKey: string
  bKey: string
  /** A's own lines that are also in B. */
  aShared: number
  /** A's own lines: its code outside what many repos have. */
  aOwn: number
  bShared: number
  bOwn: number
  /** aShared / aOwn and bShared / bOwn, in [0, 1]. */
  aShare: number
  bShare: number
  /** The larger of the two shares: how much of one repo's code is in the other. */
  score: number
  /** Files of A, and of B, that hold shared lines. */
  aFiles: number
  bFiles: number
  tier: CodeTier
}

export type CodeRepoStats = {
  repo: string
  /** Files whose code was read, each content once. */
  files: number
  /** Lines of code in them. */
  lines: number
  /** Of those, the lines outside what many repos have: what the shares are measured against. */
  own: number
}

export type CodeAnalysis = {
  /** A fingerprint found in more repos than this is not counted. */
  commonLimit: number
  repos: CodeRepoStats[]
  /** Pairs that share at least MIN_LISTED_LINES lines, strongest first. */
  pairs: CodePair[]
  /** The fingerprints that more repos hold than the limit allows. */
  common: number[]
}

export type LineRange = [first: number, last: number]

/**
 * The lines covered by the fingerprints `keep` accepts, as ranges in order.
 * Ranges that overlap or touch are joined.
 */
export function coveredRanges(prints: FilePrints, keep: (value: number) => boolean): LineRange[] {
  const ranges: LineRange[] = []
  for (let i = 0; i < prints.values.length; i++) {
    if (!keep(prints.values[i])) continue
    const first = prints.from[i]
    const last = prints.to[i]
    const open = ranges[ranges.length - 1]
    // Fingerprints come in the order of the text, so a range only ever grows at its end.
    if (open && first <= open[1] + 1) open[1] = Math.max(open[1], last)
    else ranges.push([first, last])
  }
  return ranges
}

/** How many of `lines` (ascending) fall inside `ranges` (ascending). Blank lines are not in `lines`. */
export function countLines(lines: readonly number[], ranges: readonly LineRange[]): number {
  let count = 0
  let at = 0
  for (const [first, last] of ranges) {
    while (at < lines.length && lines[at] < first) at++
    while (at < lines.length && lines[at] <= last) {
      count++
      at++
    }
  }
  return count
}

const linesWhere = (prints: FilePrints, keep: (value: number) => boolean) =>
  countLines(prints.lines, coveredRanges(prints, keep))

/** The label for a pair: by share when enough lines are shared, `thin` when not. */
export function codeTier(shared: number, score: number): CodeTier {
  if (shared < STRONG_LINES) return 'thin'
  if (score >= 0.8) return 'almost_all'
  if (score >= 0.5) return 'most'
  if (score >= 0.2) return 'part'
  return 'little'
}

const TIER_RANK: Record<CodeTier, number> = { almost_all: 0, most: 1, part: 2, little: 3, thin: 4 }

/** Each content once: a file kept in two folders is one piece of work. */
function distinctFiles(repo: CodeRepo): CodeFile[] {
  const seen = new Set<string>()
  const files: CodeFile[] = []
  for (const file of [...repo.files].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))) {
    if (seen.has(file.sha)) continue
    seen.add(file.sha)
    files.push(file)
  }
  return files
}

type Prepared = { repo: string; files: CodeFile[]; own: Set<number>; ownLines: number }

export type AnalyseCodeOptions = {
  /** Values below 2 are raised to 2: a pair must stay possible. */
  commonLimit: number
}

/** A's own lines that are also in B, and in how many files. */
function sharedWith(a: Prepared, b: Prepared): { lines: number; files: number } {
  let lines = 0
  let files = 0
  for (const file of a.files) {
    const count = linesWhere(file.prints, (value) => b.own.has(value))
    if (count > 0) {
      lines += count
      files++
    }
  }
  return { lines, files }
}

/**
 * Compares the code of every repo with every other. Only pairs that share code
 * are looked at closely, so a class of 200 does not cost 19,900 comparisons.
 */
export function analyseCode(repos: readonly CodeRepo[], options: AnalyseCodeOptions): CodeAnalysis {
  const commonLimit = Math.max(2, Math.floor(options.commonLimit))

  // In how many repos each fingerprint appears. A repo counts once, however often it holds one.
  const held = repos.map((repo) => {
    const files = distinctFiles(repo)
    const values = new Set<number>()
    for (const file of files) for (const value of file.prints.values) values.add(value)
    return { repo: repo.repo, files, values }
  })
  const holders = new Map<number, number>()
  for (const { values } of held) for (const value of values) holders.set(value, (holders.get(value) ?? 0) + 1)
  const isCommon = (value: number) => (holders.get(value) ?? 0) > commonLimit

  const prepared: Prepared[] = held.map(({ repo, files, values }) => {
    const own = new Set<number>()
    for (const value of values) if (!isCommon(value)) own.add(value)
    let ownLines = 0
    for (const file of files) ownLines += linesWhere(file.prints, (value) => own.has(value))
    return { repo, files, own, ownLines }
  })

  // Only repos that hold the same fingerprint can form a pair. Two in common is
  // the least that can cover MIN_LISTED_LINES lines in practice; one is a phrase.
  const count = prepared.length
  const byValue = new Map<number, number[]>()
  prepared.forEach((entry, index) => {
    for (const value of entry.own) {
      const list = byValue.get(value)
      if (list) list.push(index)
      else byValue.set(value, [index])
    }
  })
  const together = new Map<number, number>()
  for (const list of byValue.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const code = list[i] * count + list[j]
        together.set(code, (together.get(code) ?? 0) + 1)
      }
    }
  }

  const pairs: CodePair[] = []
  for (const [code, values] of together) {
    if (values < 2) continue
    const a = prepared[Math.floor(code / count)]
    const b = prepared[code % count]
    const fromA = sharedWith(a, b)
    const fromB = sharedWith(b, a)
    const shared = Math.max(fromA.lines, fromB.lines)
    if (shared < MIN_LISTED_LINES) continue
    const aShare = a.ownLines > 0 ? fromA.lines / a.ownLines : 0
    const bShare = b.ownLines > 0 ? fromB.lines / b.ownLines : 0
    const score = Math.max(aShare, bShare)
    pairs.push({
      aKey: a.repo,
      bKey: b.repo,
      aShared: fromA.lines,
      aOwn: a.ownLines,
      bShared: fromB.lines,
      bOwn: b.ownLines,
      aShare,
      bShare,
      score,
      aFiles: fromA.files,
      bFiles: fromB.files,
      tier: codeTier(shared, score),
    })
  }
  pairs.sort(
    (x, y) =>
      TIER_RANK[x.tier] - TIER_RANK[y.tier] ||
      y.score - x.score ||
      Math.max(y.aShared, y.bShared) - Math.max(x.aShared, x.bShared) ||
      x.aKey.localeCompare(y.aKey) ||
      x.bKey.localeCompare(y.bKey),
  )

  const common: number[] = []
  for (const [value, repoCount] of holders) if (repoCount > commonLimit) common.push(value)

  return {
    commonLimit,
    repos: prepared.map((entry) => ({
      repo: entry.repo,
      files: entry.files.length,
      lines: entry.files.reduce((sum, file) => sum + file.prints.lines.length, 0),
      own: entry.ownLines,
    })),
    pairs,
    common,
  }
}

/** One file of A and the file of B that shares the most of its code. */
export type CodeFileMatch = {
  aPath: string
  bPath: string
  /** Lines of A's file that are in B's file, and A's file's own lines. */
  aShared: number
  aOwn: number
  /** Where those lines are in A's file. */
  aRanges: LineRange[]
  bShared: number
  bOwn: number
  bRanges: LineRange[]
}

/**
 * The files behind one pair's numbers: for every file of A that shares code
 * with B, the file of B that shares the most, and the lines on both sides.
 * Worked out only when someone opens the pair.
 */
export function codePairDetail(a: CodeRepo, b: CodeRepo, common: ReadonlySet<number>): CodeFileMatch[] {
  const own = (value: number) => !common.has(value)
  const aFiles = distinctFiles(a)
  const bFiles = distinctFiles(b)
  const bValues = bFiles.map((file) => new Set(file.prints.values.filter(own)))
  const holding = new Map<number, number[]>()
  bValues.forEach((values, index) => {
    for (const value of values) {
      const list = holding.get(value)
      if (list) list.push(index)
      else holding.set(value, [index])
    }
  })

  const matches: CodeFileMatch[] = []
  for (const file of aFiles) {
    const values = new Set(file.prints.values.filter(own))
    const hits = new Map<number, number>()
    for (const value of values) for (const index of holding.get(value) ?? []) hits.set(index, (hits.get(index) ?? 0) + 1)
    if (hits.size === 0) continue
    // The file of B with the most fingerprints in common; at equal counts, the one at the same path.
    const best = [...hits].sort(
      ([x, xHits], [y, yHits]) =>
        yHits - xHits || Number(bFiles[y].path === file.path) - Number(bFiles[x].path === file.path) || x - y,
    )[0][0]
    const other = bFiles[best]
    const aRanges = coveredRanges(file.prints, (value) => bValues[best].has(value))
    const bRanges = coveredRanges(other.prints, (value) => own(value) && values.has(value))
    const aShared = countLines(file.prints.lines, aRanges)
    const bShared = countLines(other.prints.lines, bRanges)
    if (aShared === 0 && bShared === 0) continue
    matches.push({
      aPath: file.path,
      bPath: other.path,
      aShared,
      aOwn: linesWhere(file.prints, own),
      aRanges,
      bShared,
      bOwn: linesWhere(other.prints, own),
      bRanges,
    })
  }
  matches.sort((x, y) => y.aShared - x.aShared || x.aPath.localeCompare(y.aPath))
  return matches
}
