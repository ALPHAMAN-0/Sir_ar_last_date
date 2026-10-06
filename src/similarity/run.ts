// Decides who takes part in the comparison. People are compared repo by repo,
// so the sheet's rows are first grouped by the repo they point to. A row that
// cannot take part is kept with its reason: the report accounts for every row.

import { apiRepoName } from '../logic/repoName.ts'
import { LINK_PROBLEM_TEXT } from '../sheet/parseRepoLink.ts'
import type { PersonRow } from '../state/store.ts'
import type { TreeInput } from './trees.ts'

export type Person = { rowId: string; rowNumber: number; id: string; name: string }

/** One repo and everybody who handed it in. More than one person is a finding of its own. */
export type RepoGroup = {
  /** The repo's current `owner/name`, lowercase. Two links to a renamed repo land here together. */
  repo: string
  /** As GitHub spells it, for display. */
  nameWithOwner: string
  isFork: boolean
  people: Person[]
}

export type LeftOut = {
  person: Person
  /** What the sheet's link cell holds. */
  rawLink: string
  reason: string
}

export type Plan = {
  /** Repos that can be compared, in sheet order. */
  groups: RepoGroup[]
  /** What to ask the file-list loader for: one entry per group. */
  inputs: TreeInput[]
  leftOut: LeftOut[]
  /** Rows the register is still checking. The comparison waits for them. */
  waiting: number
}

export const LEFT_OUT_TEXT = {
  not_found: 'Repo not found (private, deleted or mistyped)',
  check_failed: 'Could not be checked; press Refresh on the register',
  empty: 'The repo is empty',
} as const

export function planComparison(people: readonly PersonRow[]): Plan {
  const groups = new Map<string, RepoGroup>()
  const inputs: TreeInput[] = []
  const leftOut: LeftOut[] = []
  let waiting = 0

  for (const { row, meta } of people) {
    const person: Person = { rowId: row.rowId, rowNumber: row.rowNumber, id: row.id, name: row.name }
    const skip = (reason: string) => leftOut.push({ person, rawLink: row.rawLink, reason })

    if (!row.link.ok) {
      skip(LINK_PROBLEM_TEXT[row.link.reason])
    } else if (!meta) {
      waiting++
    } else if (meta.state === 'not_found') {
      skip(LEFT_OUT_TEXT.not_found)
    } else if (meta.state === 'error') {
      skip(LEFT_OUT_TEXT.check_failed)
    } else if (meta.isEmpty || !meta.headOid || !meta.defaultBranch) {
      skip(LEFT_OUT_TEXT.empty)
    } else {
      const repo = apiRepoName(meta)
      let group = groups.get(repo)
      if (!group) {
        group = { repo, nameWithOwner: meta.nameWithOwner, isFork: meta.isFork, people: [] }
        groups.set(repo, group)
        inputs.push({ repo, headOid: meta.headOid, branch: meta.defaultBranch })
      }
      group.people.push(person)
    }
  }
  return { groups: [...groups.values()], inputs, leftOut, waiting }
}

/** What GitHub says about one compared repo. Read when working out who had a file first. */
export type RepoFacts = {
  /** The repo's current `owner/name`, lowercase. */
  repo: string
  /** As GitHub spells it, for display. */
  nameWithOwner: string
  /** The account the repo belongs to, lowercase. */
  owner: string
  branch: string
  headOid: string
  createdAt: number
  pushedAt: number | null
  /** The `v` of the push-log address, spelled the way the register spells it. */
  version: string
  isFork: boolean
  /** Lowercase `owner/name` of the repo this one was forked from. Null: none, or hidden. Undefined: not said. */
  parent: string | null | undefined
  /** Lowercase `owner/name` of the template this repo was generated from. */
  template: string | null | undefined
  totalCommits: number
}

const lower = (name: string | null | undefined) => (typeof name === 'string' ? name.toLowerCase() : name)

/** The facts of every repo that takes part, by repo. Same choice of rows as `planComparison`. */
export function repoFacts(people: readonly PersonRow[]): Map<string, RepoFacts> {
  const facts = new Map<string, RepoFacts>()
  for (const { row, meta } of people) {
    if (!row.link.ok || !meta || meta.state !== 'ok') continue
    if (meta.isEmpty || !meta.headOid || !meta.defaultBranch) continue
    const repo = apiRepoName(meta)
    if (facts.has(repo)) continue
    const pushed = meta.pushedAt ? Date.parse(meta.pushedAt) : NaN
    facts.set(repo, {
      repo,
      nameWithOwner: meta.nameWithOwner,
      owner: repo.slice(0, repo.indexOf('/')),
      branch: meta.defaultBranch,
      headOid: meta.headOid,
      createdAt: Date.parse(meta.createdAt),
      pushedAt: Number.isNaN(pushed) ? null : pushed,
      version: meta.pushedAt ?? meta.createdAt,
      isFork: meta.isFork,
      parent: lower(meta.parent),
      template: lower(meta.template),
      totalCommits: meta.totalCommits,
    })
  }
  return facts
}

/** "22-46001-1 · Rahim Uddin", or the row number when the sheet gives neither. */
export function personLabel(person: Person): string {
  return [person.id, person.name].filter(Boolean).join(' · ') || `Row ${person.rowNumber}`
}

/** The people behind one repo: up to `max` by name, then "+3 more". */
export function groupLabel(group: RepoGroup, max = 2): string {
  const names = group.people.slice(0, max).map(personLabel)
  const rest = group.people.length - names.length
  return rest > 0 ? `${names.join(', ')} +${rest} more` : names.join(', ')
}
