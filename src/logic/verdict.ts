// Decides each person's status. This is a pure function: the same facts and
// the same deadline always give the same answer, and changing the deadline
// needs no new download unless older push history is required.
//
// The verdict uses the time GitHub RECEIVED the work (push time). Commit dates
// are written on the author's own computer and can be set to anything.

import type { ActivityEvent, RepoMeta } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import type { LinkProblem, LinkResult } from '../sheet/parseRepoLink.ts'

export type Status =
  | 'invalid_link'
  | 'checking'
  | 'not_found'
  | 'check_failed'
  | 'no_submission'
  | 'submitted'
  | 'on_time'
  | 'changed_after'
  | 'late'

export type Note =
  | 'duplicate_link'
  | 'moved'
  | 'archived'
  | 'fork'
  | 'fork_never_pushed'
  | 'other_branch_pushed_later'
  | 'provisional'
  | 'identical_after_deadline'
  | 'default_branch_renamed'
  | 'default_branch_created_late'
  | 'many_pushes_after_deadline'
  | 'by_commit_date'

export type ActivityData = {
  /** Push events on the default branch, newest first. */
  events: ActivityEvent[]
  /** The end of GitHub's log was reached. */
  exhausted: boolean
  /** Loading stopped at the page limit before the end of the log. */
  capped: boolean
  /** False while the last push is so fresh that GitHub's log may lag behind. */
  settled: boolean
  /** The oldest events on ANY branch, oldest first. null until loaded. */
  probe: ActivityEvent[] | null
  failed: boolean
}

export type Verdict = {
  status: Status
  notes: Note[]
  /** More data is needed before the answer is final. */
  need: 'activity' | 'probe' | null
  linkProblem: LinkProblem | null
  /** Late: first push minus deadline. Changed after: last push minus deadline. */
  lateByMs: number | null
  latePushes: number
  forcePushed: boolean
  /** Head commit of the default branch at the deadline, when it can be known. */
  atDeadlineOid: string | null
  firstPushAt: string | null
  lastOnTimePushAt: string | null
  /** The facts are unusual; a person should look at this repo. */
  needsReview: boolean
}

export type JudgeInput = {
  link: LinkResult
  meta?: RepoMeta
  activity?: ActivityData
  /** Last millisecond that still counts as on time, or null for "no deadline". */
  deadline: number | null
  duplicate?: boolean
}

const HEAD_CHANGES = new Set(['push', 'force_push', 'branch_creation', 'pr_merge', 'merge_queue_merge'])
const time = (iso: string) => Date.parse(iso)
const movesHead = (event: ActivityEvent) => HEAD_CHANGES.has(event.type) && event.after !== ZERO_OID

function blank(): Verdict {
  return {
    status: 'checking',
    notes: [],
    need: null,
    linkProblem: null,
    lateByMs: null,
    latePushes: 0,
    forcePushed: false,
    atDeadlineOid: null,
    firstPushAt: null,
    lastOnTimePushAt: null,
    needsReview: false,
  }
}

export function judge({ link, meta, activity, deadline, duplicate = false }: JudgeInput): Verdict {
  const v = blank()
  if (!link.ok) return { ...v, status: 'invalid_link', linkProblem: link.reason }
  if (duplicate) v.notes.push('duplicate_link')
  if (!meta) return v
  if (meta.state === 'not_found') return { ...v, status: 'not_found' }
  // A temporary failure must never be shown as the student's fault.
  if (meta.state === 'error') return { ...v, status: 'check_failed' }

  if (meta.nameWithOwner.toLowerCase() !== link.key) v.notes.push('moved')
  if (meta.isArchived) v.notes.push('archived')
  if (meta.isFork) v.notes.push('fork')

  // "Empty" is decided from the repo itself, never from pushedAt.
  if (meta.isEmpty || !meta.headOid) return { ...v, status: 'no_submission' }

  const created = time(meta.createdAt)
  const pushed = meta.pushedAt ? time(meta.pushedAt) : null
  // A fork copies its parent's pushedAt until its owner pushes something.
  if (meta.isFork && pushed !== null && pushed < created) {
    v.notes.push('fork_never_pushed')
    return { ...v, status: 'no_submission' }
  }

  if (deadline === null) return { ...v, status: 'submitted' }

  const late = (first: ActivityEvent): Verdict => ({
    ...v,
    status: 'late',
    lateByMs: time(first.ts) - deadline,
    firstPushAt: first.ts,
  })

  // Nothing can reach GitHub before the repo exists. This check comes before
  // the pushedAt shortcut on purpose.
  if (created > deadline) {
    if (!activity) return { ...v, status: 'late', need: 'activity' }
    const pushes = activity.events.filter(movesHead)
    const first = activity.exhausted && !activity.failed ? pushes[pushes.length - 1] : undefined
    // Without the log, the creation time is the earliest the first push can be.
    return first ? late(first) : { ...v, status: 'late', lateByMs: created - deadline }
  }

  // Every kind of push moves pushedAt, so nothing arrived after the deadline.
  if (pushed === null || pushed <= deadline) return { ...v, status: 'on_time' }

  if (!activity) return { ...v, need: 'activity' }
  if (activity.failed) return { ...v, status: 'check_failed' }

  const events = activity.events
  const pre = events.find((event) => time(event.ts) <= deadline)
  if (!pre && !activity.exhausted && !activity.capped) return { ...v, need: 'activity' }

  // Repos older than GitHub's push log have no events at all.
  if (events.length === 0 && activity.settled) {
    v.notes.push('by_commit_date')
    const headAt = meta.headCommittedAt ? time(meta.headCommittedAt) : null
    return headAt !== null && headAt > deadline
      ? { ...v, status: 'changed_after', lateByMs: headAt - deadline, needsReview: true }
      : { ...v, status: 'on_time' }
  }

  const post = events.filter((event) => movesHead(event) && time(event.ts) > deadline)
  if (post.length === 0) {
    // pushedAt moved but the default branch did not: another branch was pushed,
    // or the push is seconds old and the log has not caught up yet.
    v.notes.push(activity.settled ? 'other_branch_pushed_later' : 'provisional')
    return { ...v, status: 'on_time', lastOnTimePushAt: pre?.ts ?? null }
  }

  const last = post[0]
  const first = post[post.length - 1]
  let atDeadline: string | null = null
  let needsReview = false

  if (pre && pre.after !== ZERO_OID) {
    atDeadline = pre.after
    v.lastOnTimePushAt = pre.ts
  } else if (!pre && !activity.exhausted) {
    // Hit the page limit while every loaded push is after the deadline.
    if (activity.probe === null) return { ...v, need: 'probe' }
    const earliest = activity.probe.find(movesHead)
    if (!earliest || time(earliest.ts) > deadline) return late(earliest ?? first)
    v.notes.push('many_pushes_after_deadline')
    needsReview = true
  } else if (!pre && first.before !== ZERO_OID) {
    // The log begins after the branch already had commits (older repo).
    atDeadline = first.before
  } else {
    // The default branch did not exist at the deadline. Late only if NO branch
    // had anything by then; a renamed branch must not turn into a false Late.
    if (activity.probe === null) return { ...v, need: 'probe' }
    const early = activity.probe.filter((event) => movesHead(event) && time(event.ts) <= deadline)
    if (early.length === 0) return late(activity.probe.find(movesHead) ?? first)
    if (early.some((event) => event.after === first.after)) {
      atDeadline = first.after
      v.notes.push('default_branch_renamed')
    } else {
      v.notes.push('default_branch_created_late')
      needsReview = true
    }
  }

  // Pushed again, but the branch ended up exactly where it was at the deadline.
  if (atDeadline !== null && atDeadline === meta.headOid) {
    v.notes.push('identical_after_deadline')
    return { ...v, status: 'on_time', atDeadlineOid: atDeadline }
  }

  return {
    ...v,
    status: 'changed_after',
    lateByMs: time(last.ts) - deadline,
    latePushes: post.length,
    forcePushed: post.some((event) => event.type === 'force_push'),
    atDeadlineOid: atDeadline,
    needsReview,
  }
}

export const NOTE_TEXT: Record<Note, string> = {
  duplicate_link: 'Same repo as another row',
  moved: 'Repo was renamed or moved',
  archived: 'Repo is archived',
  fork: 'Fork',
  fork_never_pushed: 'Fork with no pushes of its own',
  other_branch_pushed_later: 'Another branch was pushed after the deadline',
  provisional: 'Pushed minutes ago; refresh shortly to confirm',
  identical_after_deadline: 'Pushed after the deadline, but the content is unchanged',
  default_branch_renamed: 'Main branch was renamed or switched after the deadline',
  default_branch_created_late: 'Main branch was created after the deadline',
  many_pushes_after_deadline: 'Very many pushes after the deadline',
  by_commit_date: 'GitHub has no push log for this repo; judged by commit date',
}
