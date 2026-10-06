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
