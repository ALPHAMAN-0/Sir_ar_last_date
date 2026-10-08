// Turning judged rows into what the table shows: labels, order, filtering and
// the rows of the Excel download. Pure functions, no browser APIs.

import type { RepoOk } from '../../shared/api.ts'
import { LINK_PROBLEM_TEXT } from '../sheet/parseRepoLink.ts'
import type { ExportRow } from '../sheet/exportXlsx.ts'
import type { PersonRow, Sort } from '../state/store.ts'
import type { CommitShares } from './commitShares.ts'
import { firstPush, type FirstPush } from './firstPush.ts'
import { apiRepoName } from './repoName.ts'
import { formatDuration } from './time.ts'
import { NOTE_TEXT, type Status, type Verdict } from './verdict.ts'

export type Tone = 'good' | 'warn' | 'bad' | 'muted' | 'info' | 'busy'

export const STATUS_TONE: Record<Status, Tone> = {
  on_time: 'good',
  submitted: 'info',
  changed_after: 'warn',
  late: 'bad',
  no_submission: 'bad',
  not_found: 'muted',
  invalid_link: 'muted',
  check_failed: 'muted',
  checking: 'busy',
}

/** Problems first: this is the order used when sorting by status and for the filter chips. */
export const STATUS_ORDER: readonly Status[] = [
  'late',
  'changed_after',
  'no_submission',
  'not_found',
  'invalid_link',
  'check_failed',
  'checking',
  'on_time',
  'submitted',
]

/** Before the deadline has passed nobody is late yet, so the wording is softer. */
export function statusLabel(status: Status, deadlinePassed: boolean): string {
  switch (status) {
    case 'on_time':
      return deadlinePassed ? 'On time' : 'Submitted'
    case 'no_submission':
      return deadlinePassed ? 'No submission' : 'Nothing yet'
    case 'submitted':
      return 'Has work'
    case 'changed_after':
      return 'Changed after deadline'
    case 'late':
      return 'Late'
    case 'not_found':
      return 'Not found'
    case 'invalid_link':
      return 'Invalid link'
    case 'check_failed':
      return 'Check failed'
    case 'checking':
      return 'Checking'
  }
}

export const okMeta = (person: PersonRow): RepoOk | null =>
  person.meta?.state === 'ok' ? person.meta : null

/** "by 3h 20m" for late rows, "last change 9h after" for changed rows. */
export function latenessText(verdict: Verdict): string {
  if (verdict.lateByMs === null) return ''
  return formatDuration(verdict.lateByMs)
}

export function noteTexts(person: PersonRow): string[] {
  const texts = person.verdict.notes.map((note) => NOTE_TEXT[note])
  const { verdict } = person
  if (verdict.linkProblem) texts.unshift(LINK_PROBLEM_TEXT[verdict.linkProblem])
  if (verdict.status === 'not_found') texts.push('Private, deleted or mistyped')
  if (verdict.status === 'check_failed') texts.push('Could not check right now; press Refresh')
  if (verdict.forcePushed) texts.push('History was rewritten (force push) after the deadline')
  if (verdict.needsReview) texts.push('Please look at this repo yourself')
  return texts
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
const instant = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null)

function sortValue(person: PersonRow, column: Sort['column']): string | number | null {
  const meta = okMeta(person)
  switch (column) {
    case 'row':
      return person.row.rowNumber
    case 'id':
      return person.row.id || null
    case 'name':
      return person.row.name || null
    case 'repo':
      return person.row.link.ok ? person.row.link.key : null
    case 'status':
      return STATUS_ORDER.indexOf(person.verdict.status)
    case 'lateBy':
      return person.verdict.lateByMs
    case 'createdAt':
      return instant(meta?.createdAt)
    case 'pushedAt':
      return instant(meta?.pushedAt)
    case 'committedAt':
      return instant(meta?.headCommittedAt)
    case 'commits':
      return meta && !meta.isEmpty ? meta.totalCommits : null
  }
}

/** Sorts a copy. Rows with no value for the column always go last; ties keep sheet order. */
export function sortPeople(people: readonly PersonRow[], sort: Sort): PersonRow[] {
  const direction = sort.descending ? -1 : 1
  return [...people].sort((a, b) => {
    const left = sortValue(a, sort.column)
    const right = sortValue(b, sort.column)
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1
    } else {
      const order =
        typeof left === 'string' || typeof right === 'string'
          ? collator.compare(String(left), String(right))
          : left - right
      if (order !== 0) return order * direction
    }
    return a.row.rowNumber - b.row.rowNumber
  })
}

export function filterPeople(
  people: readonly PersonRow[],
  statusFilter: Status | 'all',
  search: string,
): PersonRow[] {
  const needle = search.trim().toLowerCase()
  return people.filter((person) => {
    if (statusFilter !== 'all' && person.verdict.status !== statusFilter) return false
    if (!needle) return true
    const { row } = person
    return [row.id, row.name, row.rawLink].some((text) => text.toLowerCase().includes(needle))
  })
}

export function countByStatus(people: readonly PersonRow[]): Map<Status, number> {
  const counts = new Map<Status, number>()
  for (const person of people) {
    counts.set(person.verdict.status, (counts.get(person.verdict.status) ?? 0) + 1)
  }
  return counts
}

export const repoUrl = (repoKey: string) => `https://github.com/${repoKey}`

/** Only names that passed validation are ever turned into a link. */
export function repoLinkFor(person: PersonRow): string {
  const meta = okMeta(person)
  if (meta) return repoUrl(apiRepoName(meta))
  return person.row.link.ok ? repoUrl(person.row.link.key) : ''
}

/**
 * @param firstPushes by repo, read for the download. A repo that is missing
 *   gets what the register itself knows, which is the first push of a late row.
 * @param commitShares by repo, read for the download. A repo with work that is
 *   missing is written as not loaded: the file is finished, nothing more is read.
 */
export function toExportRows(
  people: readonly PersonRow[],
  deadlinePassed: boolean,
  firstPushes: ReadonlyMap<string, FirstPush> = new Map(),
  commitShares: ReadonlyMap<string, CommitShares> = new Map(),
): ExportRow[] {
  return people.map((person) => {
    const meta = okMeta(person)
    const { verdict, row } = person
    const hasWork = meta !== null && !meta.isEmpty
    const url = repoLinkFor(person)
    const shares: CommitShares =
      (row.link.ok ? commitShares.get(row.link.key) : undefined) ??
      (meta !== null && verdict.status !== 'no_submission' ? { kind: 'failed' } : { kind: 'none' })
    return {
      rowNumber: row.rowNumber,
      id: row.id,
      name: row.name,
      repoName: meta ? meta.nameWithOwner : row.link.ok ? row.link.key : row.rawLink,
      repoUrl: url || null,
      status: statusLabel(verdict.status, deadlinePassed),
      statusKey: verdict.status,
      needsReview: verdict.needsReview,
      lateBy: latenessText(verdict),
      lateMinutes: verdict.lateByMs === null ? null : Math.floor(verdict.lateByMs / 60_000),
      repoCreatedAt: meta?.createdAt ?? null,
      firstPush: (row.link.ok ? firstPushes.get(row.link.key) : undefined) ?? firstPush(person, undefined),
      lastPushAt: hasWork ? (meta.pushedAt ?? null) : null,
      lastOnTimePushAt: verdict.lastOnTimePushAt,
      lastCommitAt: meta?.headCommittedAt ?? null,
      commits: hasWork ? meta.totalCommits : null,
      branch: meta?.defaultBranch ?? '',
      commitShares: shares,
    }
  })
}
