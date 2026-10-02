import { useEffect, useMemo, useState } from 'react'
import { ZERO_OID } from '../../shared/validate.ts'
import { ApiError } from '../api/client.ts'
import {
  filterPeople,
  latenessText,
  noteTexts,
  okMeta,
  repoUrl,
  sortPeople,
} from '../logic/people.ts'
import { apiRepoName } from '../logic/repoName.ts'
import { formatDateTime, formatDuration } from '../logic/time.ts'
import { LINK_PROBLEM_TEXT } from '../sheet/parseRepoLink.ts'
import { personHref, useApp, useNow, usePeople } from '../state/hooks.ts'
import { loadCommits, type CommitList } from '../state/person.ts'
import { loadActivity, type PersonRow } from '../state/store.ts'
import { Stamp } from './Stamp.tsx'
import { Timeline } from './Timeline.tsx'

type CommitResult = { id: string; data?: CommitList; error?: string }

/** Loads the commit list behind a head commit. The result is kept per head, so a new push reloads it. */
function useCommitList(repo: string | null, headOid: string | null) {
  const id = repo && headOid ? `${repo}@${headOid}` : null
  const [result, setResult] = useState<CommitResult | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!repo || !headOid || !id) return
    let live = true
    loadCommits(repo, headOid).then(
      (data) => {
        if (live) setResult({ id, data })
      },
      (error: unknown) => {
        const message =
          error instanceof ApiError ? error.message : 'The commits could not be loaded.'
        if (live) setResult({ id, error: message })
      },
    )
    return () => {
      live = false
    }
  }, [repo, headOid, id, attempt])

  // An answer for another repo or an older head is ignored: that shows "Loading".
  const current = result && result.id === id ? result : null
  return {
    list: current?.data,
    error: current?.error,
    retry: () => {
      setResult(null)
      setAttempt((count) => count + 1)
    },
  }
}

function explain(person: PersonRow, deadlinePassed: boolean): string {
  const { verdict, row } = person
  switch (verdict.status) {
    case 'late':
      return verdict.firstPushAt
        ? `The first push reached GitHub on ${formatDateTime(verdict.firstPushAt)}, ${latenessText(verdict)} after the deadline.`
        : 'Nothing had reached GitHub when the deadline passed.'
    case 'changed_after':
      return verdict.latePushes > 0
        ? `Work was pushed in time, then ${verdict.latePushes} more ${verdict.latePushes === 1 ? 'push' : 'pushes'} arrived after the deadline. The last one came ${latenessText(verdict)} after it.`
        : 'The newest commit is dated after the deadline.'
    case 'on_time':
      return deadlinePassed
        ? 'Everything on the main branch reached GitHub before the deadline.'
        : 'Work is already on GitHub. The deadline has not passed yet.'
    case 'no_submission':
      return 'The repo exists but holds no work.'
    case 'not_found':
      return 'GitHub has no public repo at this link. It may be private, deleted or mistyped.'
    case 'invalid_link':
      return `${verdict.linkProblem ? LINK_PROBLEM_TEXT[verdict.linkProblem] : 'This link could not be read'}: “${row.rawLink || 'empty cell'}”.`
    case 'check_failed':
      return 'The check could not finish. Go back to the register and press Refresh.'
    case 'submitted':
      return 'This repo has work in it. Set a deadline to see whether it was on time.'
    case 'checking':
      return 'Checking this repo.'
  }
}

const personLabel = (person: PersonRow) =>
  person.row.name || person.row.id || `Row ${person.row.rowNumber}`

export function PersonView({ rowId }: { rowId: string }) {
  const people = usePeople()
  const sort = useApp((state) => state.sort)
  const statusFilter = useApp((state) => state.statusFilter)
  const search = useApp((state) => state.search)
  const deadline = useApp((state) => state.deadline)
  const now = useNow()

  const person = people.find((candidate) => candidate.row.rowId === rowId)
  const meta = person ? okMeta(person) : null
  const key = person?.row.link.ok ? person.row.link.key : null
  const repo = meta ? apiRepoName(meta) : null
  const headOid = meta?.headOid ?? null
  const pushedAt = meta?.pushedAt ?? null
  const { list, error, retry } = useCommitList(repo, headOid)

  // Newer browsers return a promise from scrollTo, and an effect must not return one.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [rowId])

  // The push log gives every commit its real arrival time.
  useEffect(() => {
    if (key && headOid) void loadActivity(key, 3)
  }, [key, headOid, pushedAt])

  // Previous and next follow the order and filter chosen in the register.
  const order = useMemo(
    () => sortPeople(filterPeople(people, statusFilter, search), sort),
    [people, statusFilter, search, sort],
  )

  if (!person) {
    return (
      <section className="person">
        <p className="empty">
          This row is not in the current sheet. <a href="#/">Back to the register</a>
        </p>
      </section>
    )
  }

  const { row, verdict, activity } = person
  const deadlinePassed = deadline !== null && now > deadline
  const position = order.findIndex((candidate) => candidate.row.rowId === rowId)
  const previous = position > 0 ? order[position - 1] : null
  const next = position >= 0 && position < order.length - 1 ? order[position + 1] : null
  const oldestPush =
    activity?.exhausted && !activity.failed
      ? activity.events.filter((event) => event.after !== ZERO_OID).at(-1)
      : undefined
  const firstPushAt = verdict.firstPushAt ?? oldestPush?.ts ?? null
  const linkProblem = verdict.linkProblem ? LINK_PROBLEM_TEXT[verdict.linkProblem] : null
  const notes = noteTexts(person).filter((text) => text !== linkProblem)

  return (
    <article className="person">
      <nav className="person__nav" aria-label="People">
        <a className="backlink" href="#/">
          ← Back to the register
        </a>
        <span className="person__pager">
          {previous ? <a href={personHref(previous.row.rowId)}>← {personLabel(previous)}</a> : null}
          {next ? <a href={personHref(next.row.rowId)}>{personLabel(next)} →</a> : null}
        </span>
      </nav>

      <header className="person__head">
        <div className="person__who">
          <p className="person__id mono">
            {row.id || '—'} · sheet row {row.rowNumber}
          </p>
          <h1 className="person__name">{row.name || '(no name)'}</h1>
          {repo && meta ? (
            <a className="person__repo" href={repoUrl(repo)} target="_blank" rel="noopener noreferrer">
              github.com/{meta.nameWithOwner}
            </a>
          ) : null}
        </div>
        <div className="person__verdict">
          <Stamp
            key={verdict.status}
            status={verdict.status}
            deadlinePassed={deadlinePassed}
            detail={
              verdict.status === 'late' && verdict.lateByMs !== null
                ? `by ${formatDuration(verdict.lateByMs)}`
                : undefined
            }
            large
          />
          <p className="person__why">{explain(person, deadlinePassed)}</p>
          {notes.length > 0 ? (
            <ul className="person__notes">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </header>

      {meta ? (
        <dl className="facts">
          <div>
            <dt>Repo created</dt>
            <dd className="mono">{formatDateTime(meta.createdAt)}</dd>
          </div>
          <div>
            <dt>First push</dt>
            <dd className="mono">{formatDateTime(firstPushAt) || '—'}</dd>
          </div>
          {verdict.lastOnTimePushAt ? (
            <div>
              <dt>Last push in time</dt>
              <dd className="mono">{formatDateTime(verdict.lastOnTimePushAt)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Last push</dt>
            <dd className="mono">{meta.isEmpty ? '—' : formatDateTime(meta.pushedAt) || '—'}</dd>
          </div>
          <div>
            <dt>Main branch</dt>
            <dd className="mono">{meta.defaultBranch ?? '—'}</dd>
          </div>
          <div>
            <dt>Commits</dt>
            <dd className="mono">{meta.isEmpty ? 0 : meta.totalCommits}</dd>
          </div>
        </dl>
      ) : null}

      {repo && headOid ? (
        <section className="timeline" aria-label="Commits by date">
          <h2 className="timeline__title">Which date, which files</h2>
          {error ? (
            <p className="notice notice--bad" role="alert">
              {error}{' '}
              <button type="button" className="linkish" onClick={retry}>
                Try again
              </button>
            </p>
          ) : !list ? (
            <p className="empty">Loading the commits.</p>
          ) : (
            <Timeline
              repo={repo}
              headOid={headOid}
              list={list}
              events={activity?.events}
              deadline={deadline}
              atDeadlineOid={verdict.atDeadlineOid}
              changedAfter={verdict.status === 'changed_after'}
            />
          )}
        </section>
      ) : null}
    </article>
  )
}
