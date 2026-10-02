import { useMemo } from 'react'
import type { ActivityEvent } from '../../shared/api.ts'
import { repoUrl } from '../logic/people.ts'
import { arrivedLate, attributePushes } from '../logic/pushAttribution.ts'
import { formatDateTime, formatDayKey } from '../logic/time.ts'
import { buildTimeline } from '../logic/timeline.ts'
import type { CommitList } from '../state/person.ts'
import { CommitEntry } from './CommitEntry.tsx'

/** Files load by themselves for this many commits; older ones wait for a click. */
const AUTO_FILE_COMMITS = 60

type Props = {
  repo: string
  headOid: string
  list: CommitList
  /** Push events of the main branch. Undefined until they are loaded. */
  events: readonly ActivityEvent[] | undefined
  deadline: number | null
  /** The branch head at the deadline, when the status is "changed after deadline". */
  atDeadlineOid: string | null
  changedAfter: boolean
}

/** "Which date, which files": commits grouped by day, with the deadline ruled across. */
export function Timeline({ repo, headOid, list, events, deadline, atDeadlineOid, changedAfter }: Props) {
  const pushes = useMemo(() => attributePushes(list.commits, events ?? []), [list, events])
  const items = useMemo(() => buildTimeline(list.commits, deadline), [list, deadline])
  const lateCommits = useMemo(
    () => list.commits.filter((commit) => arrivedLate(pushes.get(commit.oid), deadline) === true).length,
    [list, pushes, deadline],
  )

  return (
    <>
      {changedAfter ? (
        <p className="afterline">
          {lateCommits > 0 ? (
            <>
              <strong>
                {lateCommits} {lateCommits === 1 ? 'commit' : 'commits'}
              </strong>{' '}
              reached GitHub after the deadline. They are marked below.{' '}
            </>
          ) : null}
          {atDeadlineOid ? (
            <a
              href={`${repoUrl(repo)}/compare/${atDeadlineOid}...${headOid}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              See everything that changed after the deadline on GitHub ↗
            </a>
          ) : null}
        </p>
      ) : null}
      {list.truncated ? (
        <p className="notice notice--warn">
          This repo has a very long history. The newest 1,000 commits are shown.
        </p>
      ) : null}
      <ol className="timeline__list">
        {items.map((item) => {
          if (item.kind === 'deadline') {
            return (
              <li key="deadline" className="timeline__deadline">
                <span>Deadline · {formatDateTime(deadline)}</span>
              </li>
            )
          }
          if (item.kind === 'day') {
            return (
              <li key={`day-${item.key}`} className="timeline__day">
                <h3>{formatDayKey(item.key)}</h3>
                <span>
                  {item.count} {item.count === 1 ? 'commit' : 'commits'}
                </span>
              </li>
            )
          }
          return (
            <CommitEntry
              key={item.commit.oid}
              repo={repo}
              commit={item.commit}
              push={pushes.get(item.commit.oid)}
              deadline={deadline}
              autoFiles={item.index < AUTO_FILE_COMMITS}
            />
          )
        })}
      </ol>
    </>
  )
}
