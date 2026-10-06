// When a repo first received work. GitHub's push log gives the real time, but
// it begins in March 2023: a repo last pushed before that has no log at all,
// and an older repo pushed since has a log that starts in the middle. When the
// log cannot tell, the date written in the oldest commit stands in, and the
// screen says that it is a commit date. Pure functions, no browser APIs.

import { ZERO_OID } from '../../shared/validate.ts'
import type { CommitList } from '../state/person.ts'
import type { PersonRow } from '../state/store.ts'
import { formatDateTime } from './time.ts'

export type FirstPush =
  /** The time GitHub received it. */
  | { kind: 'recorded'; at: string }
  /** No push time is known. This is the date written in the oldest commit. */
  | { kind: 'commit_date'; at: string }
  /** Nothing was pushed. */
  | { kind: 'none' }
  | { kind: 'loading' }
  /** The push log could not be loaded. */
  | { kind: 'failed' }
  /** No push time is known, and there is no commit date to give instead. */
  | { kind: 'unknown' }

const time = (iso: string) => Date.parse(iso)

/**
 * @param commits the history of the main branch: undefined while it loads,
 *   null when it could not be loaded
 */
export function firstPush(
  person: Pick<PersonRow, 'meta' | 'verdict' | 'activity'>,
  commits: CommitList | null | undefined,
): FirstPush {
  const { meta, verdict, activity } = person
  if (meta?.state !== 'ok' || verdict.status === 'no_submission') return { kind: 'none' }
  // A late row already names its first push. Both places must show the same time.
  if (verdict.firstPushAt) return { kind: 'recorded', at: verdict.firstPushAt }
  if (!activity) return { kind: 'loading' }
  if (activity.failed) return { kind: 'failed' }

  const oldest = activity.exhausted
    ? activity.events.filter((event) => event.after !== ZERO_OID).at(-1)
    : undefined
  // The push that created the branch, or the first one a fork got from its
  // owner. Any other oldest event means the log begins after the first push.
  if (oldest && (oldest.before === ZERO_OID || meta.isFork)) return { kind: 'recorded', at: oldest.ts }

  // A fork's oldest commits were written for the repo it was copied from.
  if (meta.isFork) return { kind: 'unknown' }
  if (commits === undefined) return { kind: 'loading' }
  if (commits === null || commits.truncated || commits.commits.length === 0) return { kind: 'unknown' }
  const first = commits.commits.reduce((a, b) => (time(b.committedAt) < time(a.committedAt) ? b : a))
  return { kind: 'commit_date', at: first.committedAt }
}

/** What the facts list shows. A missing time is always explained. */
export function firstPushText(first: FirstPush): string {
  switch (first.kind) {
    case 'recorded':
    case 'commit_date':
      return formatDateTime(first.at) || '—'
    case 'none':
      return '—'
    case 'loading':
      return '…'
    case 'failed':
      return 'Could not be loaded'
    case 'unknown':
      return 'Not known'
  }
}

/** Shown under a commit date, so that it is not read as a push time. */
export const FIRST_PUSH_BY_COMMIT_NOTE = 'Date of the first commit. The push time is not known.'
