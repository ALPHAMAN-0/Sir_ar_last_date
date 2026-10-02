import type { CommitInfo } from '../../shared/api.ts'
import { localDateKey } from './time.ts'

export type TimelineItem =
  | { kind: 'day'; key: string; count: number }
  | { kind: 'deadline' }
  | { kind: 'commit'; commit: CommitInfo; index: number }

/**
 * Commits by the date written in them, newest first, grouped under a heading
 * per local day, with exactly one line where the deadline falls.
 */
export function buildTimeline(
  commits: readonly CommitInfo[],
  deadline: number | null,
): TimelineItem[] {
  const sorted = [...commits].sort((a, b) => Date.parse(b.committedAt) - Date.parse(a.committedAt))
  const perDay = new Map<string, number>()
  for (const commit of sorted) {
    const key = localDateKey(commit.committedAt)
    perDay.set(key, (perDay.get(key) ?? 0) + 1)
  }
  const items: TimelineItem[] = []
  let day = ''
  let ruled = deadline === null
  sorted.forEach((commit, index) => {
    if (!ruled && deadline !== null && Date.parse(commit.committedAt) <= deadline) {
      items.push({ kind: 'deadline' })
      ruled = true
    }
    const key = localDateKey(commit.committedAt)
    if (key !== day) {
      day = key
      items.push({ kind: 'day', key, count: perDay.get(key) ?? 0 })
    }
    items.push({ kind: 'commit', commit, index })
  })
  if (!ruled) items.push({ kind: 'deadline' })
  return items
}
