// What the contribution tab shows: every repo of the sheet once, with the
// people who handed it in and each committer's share of its commits. A row
// without commits to count is kept with its reason, so nobody is silently
// missing. Pure functions, no browser APIs.
//
// The counting itself is the results report's (src/logic/commitShares.ts), so
// the screen and the "Commits by person" column can never say different things.

import { percentOf, type CommitShares } from '../logic/commitShares.ts'
import { apiRepoName } from '../logic/repoName.ts'
import { NOTE_TEXT } from '../logic/verdict.ts'
import { LINK_PROBLEM_TEXT } from '../sheet/parseRepoLink.ts'
import { LEFT_OUT_TEXT, type Person } from '../similarity/run.ts'
import type { PersonRow } from '../state/store.ts'

export type Contributor = {
  /** The GitHub login, or the name written in the commits, as the person page shows it. */
  who: string
  commits: number
  /** Of those commits, how many are merges. */
  merges: number
  /** This person's part of the counted commits, from 0 to 1. */
  share: number
  /** The share as the results report writes it: "67%", "<1%". */
  percent: string
  /** Whitespace-only and empty commits. Null when the repo's commits were not checked. */
  padding: number | null
}

export type RepoContribution = {
  /** The repo's current `owner/name`, lowercase. Two links to a renamed repo land here together. */
  repo: string
  /** As GitHub spells it, for display. */
  nameWithOwner: string
  isFork: boolean
  /** Everyone who handed this repo in, in sheet order. */
  members: Person[]
  /** `loading` until the commits were read, `failed` when they could not be. */
  state: 'loading' | 'failed' | 'counted'
  /** Commits counted, and whether they are only the newest part of a longer history. */
  total: number
  truncated: boolean
  /** The most commits first. */
  contributors: Contributor[]
}

export type NotCounted = {
  member: Person
  /** What the sheet's link cell holds. */
  rawLink: string
  reason: string
}

export type Contribution = {
  /** Repos with commits to count, in sheet order. */
  repos: RepoContribution[]
  notCounted: NotCounted[]
  /** Rows the register is still checking. */
  waiting: number
}

type Counted = Pick<RepoContribution, 'state' | 'total' | 'truncated' | 'contributors'>

function countedFrom(shares: CommitShares): Counted {
  if (shares.kind === 'failed') return { state: 'failed', total: 0, truncated: false, contributors: [] }
  if (shares.kind === 'none') return { state: 'counted', total: 0, truncated: false, contributors: [] }
  const { total, truncated, authors } = shares
  return {
    state: 'counted',
    total,
    truncated,
    contributors: authors.map((author) => ({
      who: author.who,
      commits: author.commits,
      merges: author.merges,
      share: author.commits / total,
      percent: percentOf(author.commits, total),
      padding: author.checked ? author.checked.whitespace + author.checked.empty : null,
    })),
  }
}

/**
 * @param shares who committed, by the link key of a sheet row, as
 *   `loadCommitShares` reads it. A repo that is missing is still being read.
 */
export function summariseContribution(
  people: readonly PersonRow[],
  shares: ReadonlyMap<string, CommitShares>,
): Contribution {
  const repos = new Map<string, RepoContribution>()
  const notCounted: NotCounted[] = []
  let waiting = 0

  for (const { row, meta, verdict } of people) {
    const member: Person = { rowId: row.rowId, rowNumber: row.rowNumber, id: row.id, name: row.name }
    const skip = (reason: string) => notCounted.push({ member, rawLink: row.rawLink, reason })

    if (!row.link.ok) {
      skip(LINK_PROBLEM_TEXT[row.link.reason])
    } else if (!meta) {
      waiting++
    } else if (meta.state === 'not_found') {
      skip(LEFT_OUT_TEXT.not_found)
    } else if (meta.state === 'error') {
      skip(LEFT_OUT_TEXT.check_failed)
    } else if (verdict.status === 'no_submission') {
      // A fork that was never pushed to holds commits, but none of its owner's.
      skip(verdict.notes.includes('fork_never_pushed') ? NOTE_TEXT.fork_never_pushed : LEFT_OUT_TEXT.empty)
    } else {
      const repo = apiRepoName(meta)
      let entry = repos.get(repo)
      if (!entry) {
        entry = {
          repo,
          nameWithOwner: meta.nameWithOwner,
          isFork: meta.isFork,
          members: [],
          state: 'loading',
          total: 0,
          truncated: false,
          contributors: [],
        }
        repos.set(repo, entry)
      }
      entry.members.push(member)
      // The old and the new link of a renamed repo are read apart: an answer under either counts.
      const read = shares.get(row.link.key)
      if (read && (entry.state === 'loading' || (entry.state === 'failed' && read.kind === 'counted'))) {
        Object.assign(entry, countedFrom(read))
      }
    }
  }
  return { repos: [...repos.values()], notCounted, waiting }
}

/** The repos that a search for an ID, a name, a repo or a committer leaves on screen. */
export function filterContribution(repos: readonly RepoContribution[], search: string): RepoContribution[] {
  const needle = search.trim().toLowerCase()
  if (!needle) return [...repos]
  return repos.filter((entry) =>
    [
      entry.nameWithOwner,
      ...entry.members.flatMap((member) => [member.id, member.name]),
      ...entry.contributors.map((contributor) => contributor.who),
    ].some((text) => text.toLowerCase().includes(needle)),
  )
}
