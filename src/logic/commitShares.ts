// Who made the commits on a repo's main branch, for the results report: each
// person's commits and their share of all of them. People are told apart as the
// person screen names them: by GitHub account, or by the name written in the
// commit when GitHub cannot tell whose it is. Pure functions, no browser APIs.

import type { CommitInfo } from '../../shared/api.ts'
import type { CommitList } from '../state/person.ts'

export type CommitAuthor = {
  /** The GitHub login, or the name written in the commit, as the person page shows it. */
  who: string
  /** The GitHub login in lower case, when a commit's email is linked to an account. */
  login: string | null
  commits: number
  /** Of those commits, how many have more than one parent. */
  merges: number
}

export type CommitShares =
  /** The commits were read. `total` is how many were counted. */
  | { kind: 'counted'; total: number; truncated: boolean; authors: CommitAuthor[] }
  /** The commits could not be loaded. */
  | { kind: 'failed' }
  /** Nothing to count: no work, or no repo. */
  | { kind: 'none' }

/** People named in one cell at most; the rest are counted. Keeps the cell inside Excel's limit. */
export const MAX_LISTED_AUTHORS = 50

const UNKNOWN = 'Unknown author'
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

const loginOf = (commit: CommitInfo) => commit.authorLogin?.trim() || null
const nameOf = (commit: CommitInfo) => commit.authorName?.trim() || null

/**
 * Each person's commits on the main branch, the most commits first, ties by
 * name. A login is one account whatever its case, and a commit signed with a
 * name that spells someone's login is theirs too.
 */
export function countCommitShares(list: CommitList): CommitShares {
  const authors = new Map<string, CommitAuthor>()
  for (const commit of list.commits) {
    const login = loginOf(commit)
    const who = login ?? nameOf(commit) ?? UNKNOWN
    const key = who.toLowerCase()
    let author = authors.get(key)
    if (!author) {
      author = { who, login: null, commits: 0, merges: 0 }
      authors.set(key, author)
    }
    if (login && !author.login) author.login = login.toLowerCase()
    author.commits++
    if (commit.parents.length > 1) author.merges++
  }
  return {
    kind: 'counted',
    total: list.commits.length,
    truncated: list.truncated,
    authors: [...authors.values()].sort((a, b) => b.commits - a.commits || collator.compare(a.who, b.who)),
  }
}

/** "67%", or "<1%" for a share too small to round to a whole percent. */
function percentOf(commits: number, total: number): string {
  const pct = Math.round((commits / total) * 100)
  return pct === 0 ? '<1%' : `${pct}%`
}

/** "rahim 8 (67%, 2 merges); nusrat 4 (33%)". A list that is missing is explained in words. */
export function commitSharesText(shares: CommitShares): string {
  switch (shares.kind) {
    case 'none':
      return ''
    case 'failed':
      return 'Could not be loaded'
    case 'counted': {
      const { total, truncated, authors } = shares
      if (total === 0) return ''
      const parts = authors.slice(0, MAX_LISTED_AUTHORS).map((author) => {
        const merges =
          author.merges === 0 ? '' : `, ${author.merges} ${author.merges === 1 ? 'merge' : 'merges'}`
        return `${author.who} ${author.commits.toLocaleString('en')} (${percentOf(author.commits, total)}${merges})`
      })
      if (authors.length > MAX_LISTED_AUTHORS) parts.push(`and ${authors.length - MAX_LISTED_AUTHORS} more`)
      const list = parts.join('; ')
      return truncated ? `${list} (of the newest ${total.toLocaleString('en')} commits)` : list
    }
  }
}
