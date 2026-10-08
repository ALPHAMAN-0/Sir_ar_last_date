import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api/client.ts'
import { countCommitShares } from '../logic/commitShares.ts'
import { FIRST_PUSH_BY_COMMIT_NOTE, firstPush, firstPushText } from '../logic/firstPush.ts'
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
import { personHref, useApp, useChecks, useNow, usePeople } from '../state/hooks.ts'
import { checkRepo, MAX_CHECKED_COMMITS } from '../state/padding.ts'
import { loadCommits, type CommitList } from '../state/person.ts'
import { HISTORY_PAGES, loadActivity, type PersonRow } from '../state/store.ts'
import { PauseNotice } from './PauseNotice.tsx'
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

type Checking = { done: number; total: number; all: boolean; running: boolean }

/**
 * Checks which commits are padding, the newest ones as soon as the list is
 * here, all of them on request. The findings themselves live in the store.
 */
function usePaddingCheck(repo: string | null, list: CommitList | undefined) {
  const [state, setState] = useState<Checking | null>(null)
  // "Check all" holds for one list only: another person, or a new push, starts over.
  const [allFor, setAllFor] = useState<CommitList | null>(null)
  const all = allFor === list

  useEffect(() => {
    if (!repo || !list) return
    let live = true
    void checkRepo(repo, list.commits, {
      limit: all ? list.commits.length : MAX_CHECKED_COMMITS,
      onProgress: (done, total) => {
        if (live) setState({ done, total, all: total === list.commits.length, running: done < total })
      },
    })
    return () => {
      live = false
    }
  }, [repo, list, all])

  return { checking: state, checkAll: () => setAllFor(list ?? null) }
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
  const checks = useChecks(repo)
  const { checking, checkAll } = usePaddingCheck(repo, list)
  const shares = useMemo(() => (list ? countCommitShares(list, checks) : null), [list, checks])

  // Newer browsers return a promise from scrollTo, and an effect must not return one.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [rowId])

  // The push log gives every commit its real arrival time.
  useEffect(() => {
    if (key && headOid) void loadActivity(key, HISTORY_PAGES)
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
  // GitHub's push time when it has one. If not, the first commit's date, marked as such.
  const first = firstPush(person, error ? null : list)
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
      <PauseNotice />

      {meta ? (
        <dl className="facts">
          <div>
            <dt>Repo created</dt>
            <dd className="mono">{formatDateTime(meta.createdAt)}</dd>
          </div>
          <div>
            <dt>First push</dt>
            <dd className="mono">{firstPushText(first)}</dd>
            {first.kind === 'commit_date' ? (
              <dd className="facts__note">{FIRST_PUSH_BY_COMMIT_NOTE}</dd>
            ) : null}
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

      {list && shares?.kind === 'counted' && list.commits.length > 0 ? (
        <section className="shares" aria-label="Commits by person">
          <h2 className="timeline__title">Commits by person</h2>
          <p className="shares__status" role="status">
            {!checking
              ? 'Checking the commits.'
              : checking.running
                ? `Checking ${checking.done} of ${checking.total} commits`
                : checking.all
                  ? `Checked all ${checking.total} commits.`
                  : `Checked the newest ${checking.total} commits.`}{' '}
            {checking && !checking.running && !checking.all ? (
              <button type="button" className="linkish" onClick={checkAll}>
                Check all {list.commits.length} commits
              </button>
            ) : null}
          </p>
          <table className="shares__table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Commits</th>
                <th scope="col">Real</th>
                <th scope="col">Tiny</th>
                <th scope="col">Only whitespace</th>
                <th scope="col">Empty</th>
                <th scope="col">Not checked</th>
              </tr>
            </thead>
            <tbody>
              {shares.authors.map((author) => (
                <tr key={author.who}>
                  <th scope="row">{author.who}</th>
                  <td className="mono">{author.commits}</td>
                  <td className="mono">{author.checked?.real ?? 0}</td>
                  <td className="mono">{author.checked?.tiny ?? 0}</td>
                  <td className="mono">{author.checked?.whitespace ?? 0}</td>
                  <td className="mono">{author.checked?.empty ?? 0}</td>
                  <td className="mono">{author.checked?.unknown ?? author.commits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
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
              checks={checks}
            />
          )}
        </section>
      ) : null}
    </article>
  )
}
