// Puts the plan, the loaded file lists and the comparison together into what
// the screen and the .xlsx both show. Pure, so the two can never disagree.

import { describeSkips } from './rules.ts'
import { groupLabel, personLabel, type Person, type Plan, type RepoGroup } from './run.ts'
import type { Loaded } from './trees.ts'
import type { Analysis, PairSummary, RepoFiles, RepoStats, Tier } from './types.ts'

export type PairRow = {
  /** 1 is the strongest pair. The report's file list refers to pairs by this number. */
  number: number
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
  /** The strongest pair this person's repo is part of. */
  closest: { label: string; score: number; tier: Tier } | null
  /** Pairs labelled "almost all" or "mostly" identical. */
  strongPairs: number
}

export type Summary = {
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

const isStrong = (tier: Tier) => tier === 'almost_all' || tier === 'most'

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

  const pairs: PairRow[] = []
  const closest = new Map<string, PersonLine['closest']>()
  const strong = new Map<string, number>()
  for (const summary of analysis.pairs) {
    const a = groups.get(summary.aKey)
    const b = groups.get(summary.bKey)
    if (!a || !b) continue
    pairs.push({ number: pairs.length + 1, summary, a, b })
    for (const [mine, other] of [[a, b], [b, a]] as const) {
      // Pairs arrive strongest first, so the first one seen is the closest.
      if (!closest.has(mine.repo)) {
        closest.set(mine.repo, { label: groupLabel(other), score: summary.score, tier: summary.tier })
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
        closest: closest.get(group.repo) ?? null,
        strongPairs: strong.get(group.repo) ?? 0,
      })
    }
  }
  people.sort((x, y) => x.person.rowNumber - y.person.rowNumber)

  return {
    pairs,
    sameRepo: plan.groups.filter((group) => group.people.length > 1),
    notCompared,
    people,
    compared,
    onlyStarter,
  }
}
