// Puts the plan, the loaded file lists and the comparison together into what
// the screen and the .xlsx both show. Pure, so the two can never disagree.

import { describeSkips } from './rules.ts'
import { groupLabel, personLabel, type Person, type Plan, type RepoGroup } from './run.ts'
import type { Loaded } from './trees.ts'
import type { Analysis, PairSummary, RepoFiles, RepoStats, Tier } from './types.ts'

export type PairRow = {
  /** 1 is the strongest pair. The report's file list refers to pairs by this number. */
  number: number
  /**
   * `same_repo`: one repo that several people handed in. `a` and `b` are then the
   * same group, and the match is 100% whatever the files are.
   * `repos`: two different repos that hold identical files.
   */
  kind: 'same_repo' | 'repos'
  summary: PairSummary
  a: RepoGroup
  b: RepoGroup
}

export type NotCompared = {
  /** The people concerned. */
  label: string
  /** `owner/name`, when the row points at a real repo. */
  repo: string | null
  reason: string
}

export type PersonLine = {
  person: Person
  repo: string | null
  /** What the sheet's link cell holds. */
  rawLink: string
  compared: boolean
  /** Why not, or what else is worth knowing about this row. */
  note: string
  stats: RepoStats | null
  /** Files the fixed rules left out. */
  skipped: number | null
  /** The strongest match of this person: who, in which repo, and how much. */
  closest: { label: string; repo: string; score: number; tier: Tier } | null
  /** Pairs labelled "almost all" or "mostly" identical. */
  strongPairs: number
}

export type Summary = {
  /** Repos handed in by several people first (100%), then pairs of different repos, strongest first. */
  pairs: PairRow[]
  /** Repos that more than one person handed in. */
  sameRepo: RepoGroup[]
  notCompared: NotCompared[]
  /** One line per sheet row, in sheet order. */
  people: PersonLine[]
  /** Repos that took part. */
  compared: number
  /**
   * Repos left with nothing but files that many others have. One or two is a
   * student who added nothing; many at once is one solution going round.
   */
  onlyStarter: number
}

/** For a repo in which the fixed rules left no file to compare. */
export function nothingLeft(tree: RepoFiles | undefined): string {
  const leftOut = tree ? describeSkips(tree.skipped) : ''
  return leftOut ? `Nothing left to compare. Left out: ${leftOut}` : 'Nothing to compare: no files were found'
}
export const ONLY_STARTER = 'Every file is also in many other repos (starter files, or one solution many share)'

const isStrong = (tier: Tier) => tier === 'same_repo' || tier === 'almost_all' || tier === 'most'

/** One repo handed in by several people: every file it has is in "both". */
export function sameRepoSummary(group: RepoGroup, tree: RepoFiles | undefined): PairSummary {
  const files = tree?.files.length ?? 0
  const bytes = tree?.files.reduce((sum, file) => sum + file.size, 0) ?? 0
  return {
    aKey: group.repo,
    bKey: group.repo,
    aIdentical: files,
    bIdentical: files,
    identical: files,
    identicalBytes: bytes,
    aOwn: files,
    bOwn: files,
    aShare: 1,
    bShare: 1,
    score: 1,
    sameName: 0,
    sameCommit: true,
    tier: 'same_repo',
  }
}

/** "Same repo as 22-46004-1 · Farhana Akter, 22-46007-1 · Arif Rahman +2 more" */
function sameRepoLabel(group: RepoGroup, person: Person, max = 2): string {
  const others = group.people.filter((other) => other !== person)
  return `Same repo as ${groupLabel({ ...group, people: others }, max)}`
}

export function summarise(plan: Plan, loaded: Loaded, analysis: Analysis): Summary {
  const groups = new Map(plan.groups.map((group) => [group.repo, group]))
  const stats = new Map(analysis.repos.map((entry) => [entry.repo, entry]))

  /** Why a repo could not take part, or null when it did. */
  const problem = (repo: string): string | null => {
    const error = loaded.errors.get(repo)
    if (error) return error.message
    const entry = stats.get(repo)
    if (!entry) return 'The file list could not be loaded.'
    if (entry.counted === 0) return nothingLeft(loaded.trees.get(repo))
    if (entry.own === 0) return ONLY_STARTER
    return null
  }

  const sameRepo = plan.groups
    .filter((group) => group.people.length > 1)
    .sort((x, y) => y.people.length - x.people.length || x.repo.localeCompare(y.repo))

  // The same repo handed in twice is the strongest match there is, so it comes first.
  const pairs: PairRow[] = sameRepo.map((group, index) => ({
    number: index + 1,
    kind: 'same_repo',
    summary: sameRepoSummary(group, loaded.trees.get(group.repo)),
    a: group,
    b: group,
  }))
  const closest = new Map<string, PersonLine['closest']>()
  const strong = new Map<string, number>()
  for (const group of sameRepo) strong.set(group.repo, 1)
  for (const summary of analysis.pairs) {
    const a = groups.get(summary.aKey)
    const b = groups.get(summary.bKey)
    if (!a || !b) continue
    pairs.push({ number: pairs.length + 1, kind: 'repos', summary, a, b })
    for (const [mine, other] of [[a, b], [b, a]] as const) {
      // Pairs arrive strongest first, so the first one seen is the closest.
      if (!closest.has(mine.repo)) {
        closest.set(mine.repo, {
          label: groupLabel(other),
          repo: other.repo,
          score: summary.score,
          tier: summary.tier,
        })
      }
      if (isStrong(summary.tier)) strong.set(mine.repo, (strong.get(mine.repo) ?? 0) + 1)
    }
  }

  const notCompared: NotCompared[] = plan.leftOut.map((entry) => ({
    label: personLabel(entry.person),
    repo: null,
    reason: entry.reason,
  }))
  const people: PersonLine[] = plan.leftOut.map((entry) => ({
    person: entry.person,
    repo: null,
    rawLink: entry.rawLink,
    compared: false,
    note: entry.reason,
    stats: null,
    skipped: null,
    closest: null,
    strongPairs: 0,
  }))

  let compared = 0
  let onlyStarter = 0
  for (const group of plan.groups) {
    const reason = problem(group.repo)
    if (reason === null) compared++
    else notCompared.push({ label: groupLabel(group, 3), repo: group.repo, reason })
    if (reason === ONLY_STARTER) onlyStarter++

    const tree = loaded.trees.get(group.repo)
    const skipped = tree
      ? tree.skipped.thirdParty + tree.skipped.tool + tree.skipped.binary + tree.skipped.tiny
      : null
    for (const person of group.people) {
      const others = group.people.filter((other) => other !== person).map((other) => other.rowNumber)
      const notes: string[] = []
      if (others.length > 0) notes.push(`Same repo as row${others.length === 1 ? '' : 's'} ${others.join(', ')}`)
      if (reason !== null) notes.push(reason)
      people.push({
        person,
        repo: group.repo,
        rawLink: '',
        compared: reason === null,
        note: notes.join('; '),
        stats: stats.get(group.repo) ?? null,
        skipped,
        closest:
          group.people.length > 1
            ? { label: sameRepoLabel(group, person), repo: group.repo, score: 1, tier: 'same_repo' }
            : (closest.get(group.repo) ?? null),
        strongPairs: strong.get(group.repo) ?? 0,
      })
    }
  }
  people.sort((x, y) => x.person.rowNumber - y.person.rowNumber)

  return {
    pairs,
    sameRepo,
    notCompared,
    people,
    compared,
    onlyStarter,
  }
}
