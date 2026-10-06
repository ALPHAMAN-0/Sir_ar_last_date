// The words for "who had the files first". Pure, no DOM. The screen and the
// .xlsx both read from here, so the two can never say different things.
//
// The two repos of a pair are called A and B, as the table's columns are.

import { formatDateTimeShort, formatDuration } from '../logic/time.ts'
import type { PairEvidence, SideEvidence } from './first.ts'
import type { FirstState } from './firstRun.ts'
import type { Tier } from './types.ts'

/** Shown under every result that names a repo. */
export const FIRST_NOTE =
  'This shows who had the files on GitHub first. It cannot see files passed on outside GitHub, or both taking them from somewhere else.'

/** For a row that has no direction at all: one repo handed in by several people. */
export const NO_FIRST = '–'

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`

/** True when the result names one repo as the first. */
export function isNamed(evidence: PairEvidence): boolean {
  return evidence.verdict === 'a_first' || evidence.verdict === 'b_first'
}

/** The short text of the table cell. */
export function firstLabel(state: FirstState | undefined): string {
  if (!state) return NO_FIRST
  if (state.state === 'waiting') return 'Open to check'
  if (state.state === 'checking') return 'Checking…'
  switch (state.evidence.verdict) {
    case 'a_first':
      return 'A first'
    case 'b_first':
      return 'B first'
    case 'mixed':
      return 'Each had some first'
    case 'common_source':
      return 'Same source'
    case 'unknown':
      return 'Cannot tell'
  }
}

/** A named repo stands out; everything else stays quiet. */
export function firstTone(state: FirstState | undefined): 'warn' | 'info' | 'muted' {
  if (state?.state !== 'ready') return 'muted'
  if (isNamed(state.evidence)) return 'warn'
  return state.evidence.verdict === 'unknown' ? 'muted' : 'info'
}

/** Where a repo comes from, when it was not started empty. */
function sourceOf(side: SideEvidence, name: string): string | null {
  if (side.isFork) {
    return side.parent
      ? `${name}'s repo is a fork of ${side.parent}`
      : `${name}'s repo is a fork, and GitHub does not show of what`
  }
  return side.template ? `${name}'s repo was generated from ${side.template}` : null
}

/**
 * The result in one sentence. "Likely copied" is said only of a pair that is
 * mostly identical: a few shared files can come from anywhere, so for a weaker
 * match the sentence stays with what was seen.
 */
export function resultLine(evidence: PairEvidence, tier: Tier): string {
  const { verdict, reason, a, b } = evidence
  const strong = tier === 'almost_all' || tier === 'most'
  if (verdict === 'a_first') return strong ? 'B likely copied from A' : 'A had these files first'
  if (verdict === 'b_first') return strong ? 'A likely copied from B' : 'B had these files first'
  if (verdict === 'mixed') {
    return `Cannot tell. Each had some of the files first (A ${a.first}, B ${b.first}).`
  }
  if (verdict === 'common_source') {
    if (evidence.thirdAuthor) {
      return `Cannot tell. Both repos contain commits written by ${evidence.thirdAuthor}, so both may come from a third repo.`
    }
    return a.parent && a.parent === b.parent
      ? `Cannot tell. Both repos are forks of ${a.parent}, so the files may come from there.`
      : `Cannot tell. Both repos were generated from ${a.template}, so the files may come from there.`
  }

  // Which side the push times pointed to, before something spoke against it.
  const [early, late] = a.first > 0 ? ['A', 'B'] : ['B', 'A']
  switch (reason) {
    case 'same_owner':
      return 'Cannot tell. Both repos belong to the same GitHub account.'
    case 'outside_source':
      return `Cannot tell. ${sourceOf(a, 'A') ?? sourceOf(b, 'B') ?? 'One of the repos is a copy of another repo'}, so the files may come from there.`
    case 'too_close':
      return 'Cannot tell. The two pushed these files within an hour of each other.'
    case 'third_repo':
      return 'Cannot tell. Another repo of this sheet may have had these files before both.'
    case 'mostly_unobserved':
      return `Cannot tell. Only ${a.first + b.first} of the ${evidence.shared} files could be dated.`
    case 'commits_unread':
      return 'Cannot tell. The commit history could not be read. Try again later.'
    case 'conflict':
      switch (evidence.conflict) {
        case 'earlier_versions':
          return `Cannot tell. ${early} had the files first, but ${late}'s repo held earlier versions of them.`
        case 'commits_by_later_owner':
          return `Cannot tell. ${early} had the files first, but ${early}'s repo contains commits written by ${late}'s account.`
        default:
          return `Cannot tell. ${early} pushed the files first, but ${late}'s own commits are dated earlier. Commit dates are set by the author.`
      }
    default:
      return 'Cannot tell. GitHub does not show enough of what happened.'
  }
}

/** What could not be seen of one repo. */
function gaps(side: SideEvidence, name: string): string[] {
  const lines: string[] = []
  if (side.log === 'none') lines.push(`GitHub has no push log for ${name}'s repo`)
  if (side.log === 'failed') lines.push(`The push log of ${name}'s repo could not be loaded`)
  if (side.log === 'unsettled') lines.push(`${name}'s repo was pushed minutes ago; check again shortly`)
  if (side.log !== 'ok') return lines

  if (side.stopped === 'cap') lines.push(`Only the first ${plural(side.scanned, 'push', 'pushes')} of ${name}'s repo were read`)
  if (side.stopped === 'too_large') lines.push(`${name}'s repo is too large to look back in time`)
  if (side.stopped === 'gone') lines.push(`An older state of ${name}'s repo can no longer be read`)
  if (side.stopped === 'failed') lines.push(`Reading ${name}'s repo stopped at an error; try again`)
  // For a fork or a template copy the source line already says why.
  if (!side.startKnown && !side.isFork && !side.template) {
    lines.push(`GitHub's push log does not show how ${name}'s repo began`)
  }
  return lines
}

/**
 * Everything that was observed about a pair, one fact per line, in the order
 * a reader asks: where the repos come from, when each had the files, how the
 * files arrived, who wrote the commits, and what could not be seen.
 */
export function evidenceLines(evidence: PairEvidence, now: number = Date.now()): string[] {
  const { a, b } = evidence
  const when = (instant: number) => formatDateTimeShort(instant, now)
  const lines: string[] = []
  const sides = [
    ['A', a, b],
    ['B', b, a],
  ] as const

  if (evidence.basis === 'fork') {
    lines.push(evidence.verdict === 'a_first' ? "B's repo is a GitHub fork of A's repo" : "A's repo is a GitHub fork of B's repo")
  } else {
    for (const [name, side] of sides) {
      const source = sourceOf(side, name)
      if (source) lines.push(source)
    }
  }

  for (const [name, side, other] of sides) {
    if (side.seen === 0) {
      lines.push(`${name} had them by ${when(side.end)}; when exactly cannot be seen`)
    } else if (side.arrivalPushes === 1) {
      const which = side.unseen > 0 ? `${side.seen} of them` : 'them'
      lines.push(`${name} pushed ${which} ${when(side.firstAt as number)}`)
    } else {
      lines.push(
        `In ${name}'s repo they arrived over ${side.arrivalPushes} pushes, ${when(side.firstAt as number)} to ${when(side.lastAt as number)}`,
      )
    }
    // Worth saying only when the other repo was already there with the files.
    if ((other.firstAt ?? other.end) < side.createdAt) {
      lines.push(`${name}'s repo did not exist until ${when(side.createdAt)}`)
    }
  }

  if (isNamed(evidence) && evidence.gapMs !== null) {
    const late = evidence.verdict === 'a_first' ? 'B' : 'A'
    lines.push(
      evidence.basis === 'created_after'
        ? `${late}'s repo was created ${formatDuration(evidence.gapMs)} after the other had them`
        : `${late} got them ${formatDuration(evidence.gapMs)} later`,
    )
  }

  // "All at once" says something only next to a repo in which they came bit by bit.
  for (const [name, side, other] of sides) {
    if (side.arrivalPushes === 1 && side.seen > 1 && other.arrivalPushes > 1) {
      lines.push(`In ${name}'s repo all ${side.seen} of these files arrived in one push`)
    }
  }
  if (a.grew > 0 && b.grew > 0) {
    lines.push(`Both repos held earlier versions of some of these files (A ${a.grew}, B ${b.grew})`)
  } else {
    for (const [name, side, other] of sides) {
      if (side.grew === 0) continue
      const rest = other.seen > 0 ? `; in ${name === 'A' ? 'B' : 'A'}'s they arrived complete` : ''
      lines.push(`${name}'s repo held earlier versions of ${side.grew} of these files${rest}`)
    }
  }

  lines.push(`A's repo has ${plural(a.totalCommits, 'commit')} in all, B's has ${b.totalCommits.toLocaleString('en')}`)
  for (const [name, side] of sides) {
    if (side.commitsByOther) {
      const other = name === 'A' ? 'B' : 'A'
      lines.push(`${plural(side.commitsByOther, 'commit')} in ${name}'s repo ${side.commitsByOther === 1 ? 'is' : 'are'} written by ${other}'s GitHub account`)
    }
  }
  if (evidence.sharedCommits) {
    const by = evidence.thirdAuthor ? `, written by the account ${evidence.thirdAuthor}` : ''
    lines.push(`The two repos share ${plural(evidence.sharedCommits, 'commit')}${by}`)
  }
  if (evidence.elsewhere > 0) {
    lines.push(
      `${evidence.elsewhere} of these files ${evidence.elsewhere === 1 ? 'is' : 'are'} also in ${plural(evidence.otherRepos, 'other repo')} of this sheet`,
    )
  }

  for (const [name, side] of sides) lines.push(...gaps(side, name))
  return lines
}
