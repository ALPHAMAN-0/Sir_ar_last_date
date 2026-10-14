// The contribution tab. Reads the commit list of every repo in the sheet and
// shows who committed to it and how large each person's share of the commits
// is. The counting lives in src/logic/commitShares.ts and src/contribution;
// this file only draws.

import { useEffect, useMemo, useState } from 'react'
import { filterContribution, summariseContribution, type RepoContribution } from '../contribution/rows.ts'
import { percentOf, type CommitShares } from '../logic/commitShares.ts'
import { okMeta, repoUrl } from '../logic/people.ts'
import { apiRepoName } from '../logic/repoName.ts'
import { personLabel } from '../similarity/run.ts'
import { loadCommitShares } from '../state/commitShares.ts'
import { useApp, usePeople } from '../state/hooks.ts'
import type { PersonRow } from '../state/store.ts'
import { PauseNotice } from './PauseNotice.tsx'

const NOTHING_READ: ReadonlyMap<string, CommitShares> = new Map()
/** People listed for one repo before "Show all". A fork of a large project can have hundreds. */
const VISIBLE_PEOPLE = 10

/**
 * Reads who committed to every repo, the same way the download does, and hands
 * the answers over repo by repo so that a large class fills in as it is read.
 * Nothing is asked while the register is still checking, and an answer for an
 * older sheet or commit is ignored.
 */
function useCommitShares(people: readonly PersonRow[]) {
  // `people` is a new array whenever the register re-judges its rows; this
  // text changes only when a repo or its head commit does.
  const key = people
    .map((person) => {
      const meta = okMeta(person)
      return meta ? `${apiRepoName(meta)}@${meta.headOid}` : ''
    })
    .join('|')
  const checking = people.some((person) => person.row.link.ok && !person.meta)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; shares: ReadonlyMap<string, CommitShares> } | null>(null)

  useEffect(() => {
    if (checking) return
    let live = true
    // One row per link: the commit lists are kept by repo, so a repo handed in twice is read once.
    const byLink = new Map<string, PersonRow>()
    for (const person of people) {
      if (person.row.link.ok && !byLink.has(person.row.link.key)) byLink.set(person.row.link.key, person)
    }
    for (const person of byLink.values()) {
      void loadCommitShares([person]).then((read) => {
        if (!live) return
        setResult((previous) => ({
          key,
          shares: new Map([...(previous?.key === key ? previous.shares : []), ...read]),
        }))
      })
    }
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, checking, attempt])

  return {
    shares: result && result.key === key ? result.shares : NOTHING_READ,
    /** Asks again for what could not be read. What was read is kept for the session and costs nothing. */
    retry: () => {
      setResult((previous) =>
        previous
          ? { key: previous.key, shares: new Map([...previous.shares].filter(([, shares]) => shares.kind !== 'failed')) }
          : previous,
      )
      setAttempt((count) => count + 1)
    },
  }
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`

export function ContributionView() {
  const sheet = useApp((state) => state.sheet)
  const people = usePeople()
  const { shares, retry } = useCommitShares(people)
  const summary = useMemo(() => summariseContribution(people, shares), [people, shares])
  const [search, setSearch] = useState('')
  const shown = useMemo(() => filterContribution(summary.repos, search), [summary, search])

  if (!sheet) return null

  const { repos, notCounted, waiting } = summary
  const reading = repos.filter((entry) => entry.state === 'loading').length
  const failed = repos.filter((entry) => entry.state === 'failed').length
  const solo = repos.filter((entry) => entry.contributors.length === 1).length
  const several = repos.filter((entry) => entry.contributors.length > 1).length
  const nothing = waiting === 0 && repos.length === 0

  return (
    <section className="similarity">
      <nav className="similarity__nav" aria-label="Contribution">
        <a className="backlink" href="#/">
          ← Back to the register
        </a>
        <span className="similarity__sheet mono">{sheet.fileName}</span>
      </nav>

      <header className="similarity__head">
        <h1 className="similarity__title">Contribution</h1>
        <p className="similarity__lede">
          Shows who committed to each repo and how large each person&rsquo;s share of the commits is,
          counted on the main branch. A person is named by their GitHub account, or by the name
          written in the commit when GitHub cannot tell whose it is. One commit can be a line or a
          whole feature, so read a share as a place to look, not as a mark.
        </p>
      </header>

      <PauseNotice />

      {waiting > 0 ? (
        <p className="empty" role="status">
          Waiting for the register to finish checking {plural(waiting, 'row')}.
        </p>
      ) : null}

      {nothing ? (
        <p className="empty">There is nothing to count: no row of this sheet leads to a repo with commits.</p>
      ) : null}

      {waiting === 0 && reading > 0 ? (
        <div className="similarity__progress" role="status" aria-live="polite">
          <progress className="progress" max={repos.length} value={repos.length - reading} />
          <p className="similarity__progress-text">
            Reading commits: {repos.length - reading} of {plural(repos.length, 'repo')}
          </p>
        </div>
      ) : null}

      {failed > 0 ? (
        <p className="notice notice--bad" role="alert">
          The commits of {plural(failed, 'repo')} could not be read.{' '}
          <button type="button" className="linkish" onClick={retry}>
            Try again
          </button>
        </p>
      ) : null}

      {waiting === 0 && repos.length > 0 ? (
        <>
          <div className="toolbar">
            <label className="search">
              <span className="visually-hidden">Search by ID, name, repo or committer</span>
              <input
                type="search"
                placeholder="Search ID, name, repo or committer"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {reading === 0 ? (
              <p className="toolbar__checked">
                {plural(repos.length, 'repo')}: {solo} with one committer, {several} with several.
              </p>
            ) : null}
          </div>

          {shown.length > 0 ? (
            <ul className="contribution__list">
              {shown.map((entry) => (
                <RepoBlock key={entry.repo} entry={entry} />
              ))}
            </ul>
          ) : (
            <p className="empty">
              No repo matches this search.{' '}
              <button type="button" className="linkish" onClick={() => setSearch('')}>
                Show every repo
              </button>
            </p>
          )}
        </>
      ) : null}

      {notCounted.length > 0 ? (
        <details className="similarity__fold similarity__fold--warn">
          <summary>Not counted ({notCounted.length})</summary>
          <ul className="similarity__list">
            {notCounted.map((entry) => (
              <li key={entry.member.rowId}>
                <span>
                  {personLabel(entry.member)}
                  {entry.rawLink ? <span className="mono"> {entry.rawLink}</span> : null}
                </span>
                <span className="similarity__dim">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

/** One repo: who handed it in, and who committed how much of it. */
function RepoBlock({ entry }: { entry: RepoContribution }) {
  const [showAll, setShowAll] = useState(false)
  // Not checked is not the same as none found: the column is there only after a check.
  const checked = entry.contributors.some((contributor) => contributor.padding !== null)
  const listed = showAll ? entry.contributors : entry.contributors.slice(0, VISIBLE_PEOPLE)
  const rest = entry.contributors.slice(listed.length)
  const restCommits = rest.reduce((sum, contributor) => sum + contributor.commits, 0)
  return (
    <li className="contribution__repo">
      <header className="contribution__head">
        <strong>{entry.members.map(personLabel).join(', ')}</strong>
        <a className="mono" href={repoUrl(entry.repo)} target="_blank" rel="noopener noreferrer">
          {entry.nameWithOwner}
        </a>
        {entry.isFork ? <span className="tag">Fork</span> : null}
        {entry.members.length > 1 ? (
          <span className="tag tag--warn">Handed in by {entry.members.length} people</span>
        ) : null}
      </header>

      {entry.state === 'loading' ? (
        <p className="similarity__dim">Reading the commits.</p>
      ) : entry.state === 'failed' ? (
        <p className="similarity__dim">The commits could not be read.</p>
      ) : entry.contributors.length === 0 ? (
        <p className="similarity__dim">No commits to count.</p>
      ) : (
        <>
          <p className="similarity__dim">
            {plural(entry.total, 'commit')} by {plural(entry.contributors.length, 'person', 'people')}
            {/* A fork starts with its parent's history, so whoever wrote that is in the list too. */}
            {entry.isFork ? ', including the ones the fork came with' : ''}
            {entry.truncated ? '. Only the newest commits of this repo were counted.' : ''}
          </p>
          <table className="shares__table">
            <caption className="visually-hidden">Commits by person in {entry.nameWithOwner}</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Commits</th>
                <th scope="col">Share</th>
                {checked ? <th scope="col">Padding</th> : null}
              </tr>
            </thead>
            <tbody>
              {listed.map((contributor) => (
                <tr key={contributor.who}>
                  <th scope="row">{contributor.who}</th>
                  <td className="mono">
                    {contributor.commits.toLocaleString('en')}
                    {contributor.merges > 0 ? ` (${plural(contributor.merges, 'merge')})` : ''}
                  </td>
                  <td className="contribution__share">
                    {/* The number next to it says the same; the bar is for the eye only. */}
                    <progress className="progress contribution__bar" max={1} value={contributor.share} aria-hidden="true" />
                    <span className="mono">{contributor.percent}</span>
                  </td>
                  {checked ? <td className="mono">{contributor.padding ?? ''}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
          {rest.length > 0 ? (
            <p className="similarity__dim">
              {plural(rest.length, 'more person', 'more people')} made {plural(restCommits, 'commit')} (
              {percentOf(restCommits, entry.total)}).{' '}
              <button type="button" className="linkish" onClick={() => setShowAll(true)}>
                Show all {entry.contributors.length} people
              </button>
            </p>
          ) : null}
        </>
      )}
    </li>
  )
}
