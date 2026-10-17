// A lab sheet's repo holds one folder per term (Mid, Final), each with that
// term's lab tasks. A term is judged by its own folder only: pushing Final
// work after the Mid deadline does not make Mid late or changed.
//
// The whole-repo verdict (verdict.ts) is worked out first, against the term's
// deadline. This module then looks at the term folder's fingerprint (the git
// hash of the folder, which changes whenever anything inside it changes) at
// the head commit, at the commit of the deadline and, when needed, at a few
// pushes after the deadline, found by halving. Pure: the listings come in
// through `lookup`, and a missing one is asked for through `need`.

import type { ActivityEvent, RepoMeta, TreeDir, TreeFile } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import type { ActivityData, Note, Verdict } from './verdict.ts'

export type Term = 'mid' | 'final'
export const TERMS: readonly Term[] = ['mid', 'final']
export const TERM_LABEL: Record<Term, string> = { mid: 'Mid term', final: 'Final term' }

/** One level of a folder: its sub-folders and its files. */
export type Listing = { dirs: TreeDir[]; files: TreeFile[] }
export type ListingState = Listing | 'failed'
/** A listing by commit or folder hash. Undefined while it has not been read. */
export type Lookup = (sha: string) => ListingState | undefined

export type TermJudgement = {
  verdict: Verdict
  /** The commit (or folder) whose listing is needed before the answer is final. */
  need: string | null
  /** The term's folder at the head commit, once known. */
  folder: TreeDir | null
}

const PATTERNS: Record<Term, RegExp> = {
  // "mid", "Mid Term", "mid-term", "midterm", "mid_labs", "midsem"; not "middle".
  mid: /^mid(?![a-z])|^mid(term|sem)/,
  // "final", "Final Term", "finalterm", "finals", "final_labs"; not "finalize".
  final: /^final(?![a-z])|^final(term|sem|s(?![a-z]))/,
}
const PLAIN: Record<Term, readonly string[]> = { mid: ['mid', 'midterm'], final: ['final', 'finalterm'] }

/** Which term a top-level folder name stands for, if any. */
export function termOfFolder(name: string): Term | null {
  const lower = name.trim().toLowerCase()
  if (/\.[a-z0-9]+$/.test(lower)) return null
  for (const term of ['mid', 'final'] as const) if (PATTERNS[term].test(lower)) return term
  return null
}

/** The term's folder in a top-level listing. The plainest name wins, then A to Z. */
export function termFolder(listing: Listing, term: Term): TreeDir | null {
  const found = listing.dirs
    .filter((dir) => termOfFolder(dir.path) === term)
    .sort((a, b) => a.path.localeCompare(b.path))
  const plain = found.find((dir) => PLAIN[term].includes(dir.path.toLowerCase().replace(/[^a-z0-9]/g, '')))
  return plain ?? found[0] ?? null
}

const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

/** The lab tasks in a term folder: its sub-folders, or its files when it has none. Hidden ones are left out. */
export function labTasks(listing: Listing): string[] {
  const visible = (path: string) => !path.startsWith('.')
  const dirs = listing.dirs.map((dir) => dir.path).filter(visible)
  const names = dirs.length > 0 ? dirs : listing.files.map((file) => file.path).filter(visible)
  return names.sort(natural)
}

const HEAD_CHANGES = new Set(['push', 'force_push', 'branch_creation', 'pr_merge', 'merge_queue_merge'])
const movesHead = (event: ActivityEvent) => HEAD_CHANGES.has(event.type) && event.after !== ZERO_OID

/** Pushes to the main branch after the deadline, oldest first. */
function pushesAfter(activity: ActivityData | undefined, deadline: number): ActivityEvent[] {
  if (!activity || activity.failed) return []
  return activity.events.filter((event) => movesHead(event) && Date.parse(event.ts) > deadline).reverse()
}

type Search = { found: ActivityEvent } | { need: string } | { failed: true } | null

/**
 * The oldest push after which `holds` is true, assuming that once it holds it
 * keeps holding (a folder that arrived stays; a folder that reached its final
 * state stays in it). Reads about log2 of the pushes. Null when even the last
 * push does not hold.
 */
function firstPushWhere(pushes: ActivityEvent[], lookup: Lookup, holds: (listing: Listing) => boolean): Search {
  if (pushes.length === 0) return null
  let lo = 0
  let hi = pushes.length - 1
  const last = lookup(pushes[hi].after)
  if (last === undefined) return { need: pushes[hi].after }
  if (last === 'failed') return { failed: true }
  if (!holds(last)) return null
  while (lo < hi) {
    const middle = Math.floor((lo + hi) / 2)
    const listing = lookup(pushes[middle].after)
    if (listing === undefined) return { need: pushes[middle].after }
    if (listing === 'failed') return { failed: true }
    if (holds(listing)) hi = middle
    else lo = middle + 1
  }
  return { found: pushes[lo] }
}

const PASS_THROUGH = new Set(['invalid_link', 'checking', 'not_found', 'check_failed', 'no_submission'])

export function judgeTerm({
  verdict,
  meta,
  activity,
  deadline,
  term,
  lookup,
}: {
  verdict: Verdict
  meta: RepoMeta | undefined
  activity: ActivityData | undefined
  deadline: number | null
  term: Term
  lookup: Lookup
}): TermJudgement {
  const done = (v: Verdict, folder: TreeDir | null = null): TermJudgement => ({ verdict: v, need: null, folder })
  if (verdict.need !== null || PASS_THROUGH.has(verdict.status)) return done(verdict)
  if (!meta || meta.state !== 'ok' || !meta.headOid) return done(verdict)

  const waiting = (sha: string): TermJudgement => ({
    verdict: { ...verdict, status: 'checking', lateByMs: null },
    need: sha,
    folder: null,
  })
  const failed = () => done({ ...verdict, status: 'check_failed', lateByMs: null })
  const withNote = (v: Verdict, note: Note): Verdict => ({ ...v, notes: [...v.notes, note] })
  const missing = () =>
    done(
      withNote(
        { ...verdict, status: 'no_submission', lateByMs: null, firstPushAt: null, needsReview: false },
        'term_folder_missing',
      ),
    )

  const head = lookup(meta.headOid)
  if (head === undefined) return waiting(meta.headOid)
  if (head === 'failed') return failed()
  const now = termFolder(head, term)

  /** Late, dated by the first push after the deadline that had the folder. */
  const lateBy = (pushes: ActivityEvent[]): TermJudgement => {
    const search = firstPushWhere(pushes, lookup, (listing) => termFolder(listing, term) !== null)
    if (search === null || deadline === null) return done({ ...verdict, status: 'late' }, now)
    if ('need' in search) return waiting(search.need)
    if ('failed' in search) return failed()
    const at = search.found.ts
    return done({ ...verdict, status: 'late', lateByMs: Date.parse(at) - deadline, firstPushAt: at }, now)
  }

  switch (verdict.status) {
    case 'submitted':
    case 'on_time':
      // Nothing reached the main branch after the deadline: the head is what was there.
      return now ? done(verdict, now) : missing()

    case 'late':
      if (!now) return missing()
      if (deadline === null || !activity?.exhausted) return done(verdict, now)
      return lateBy(pushesAfter(activity, deadline))

    case 'changed_after': {
      if (deadline === null) return done(verdict, now)
      const atDeadline = verdict.atDeadlineOid
      if (atDeadline === null) return now ? done(verdict, now) : missing()
      const then = lookup(atDeadline)
      if (then === undefined) return waiting(atDeadline)
      if (then === 'failed') return failed()
      const before = termFolder(then, term)

      if (!before && !now) return missing()
      if (!before) return lateBy(pushesAfter(activity, deadline))
      if (!now) return done(withNote({ ...verdict, needsReview: true }, 'term_folder_removed'))
      if (before.sha === now.sha) {
        return done(
          withNote(
            { ...verdict, status: 'on_time', lateByMs: null, latePushes: 0, forcePushed: false, needsReview: false },
            'term_untouched_after_deadline',
          ),
          now,
        )
      }
      // Changed: dated by the push that left the folder as it is now.
      const search = firstPushWhere(pushesAfter(activity, deadline), lookup, (listing) => {
        return termFolder(listing, term)?.sha === now.sha
      })
      if (search === null) return done(verdict, now)
      if ('need' in search) return waiting(search.need)
      if ('failed' in search) return failed()
      return done({ ...verdict, lateByMs: Date.parse(search.found.ts) - deadline }, now)
    }

    default:
      return done(verdict, now)
  }
}
