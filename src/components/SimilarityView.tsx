// The similarity tab. Loads the file list of every repo through the Worker,
// compares them in a Web Worker, and shows which pairs hold identical files.
// The rules and the arithmetic live in src/similarity; this file only draws.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { repoUrl } from '../logic/people.ts'
import { zoneLabel } from '../logic/time.ts'
import { analyse, defaultCommonLimit, pairDetail, sharedSets, type Shared } from '../similarity/compare.ts'
import type { CompareRequest } from '../similarity/compare.worker.ts'
import {
  createFirstRunner,
  type FirstProgress,
  type FirstRun,
  type FirstState,
  type FirstStates,
} from '../similarity/firstRun.ts'
import { fileSize, percent, tierLabel, tierTone } from '../similarity/format.ts'
import { createHistoryLoader } from '../similarity/history.ts'
import { describeSkips } from '../similarity/rules.ts'
import {
  groupLabel,
  personLabel,
  planComparison,
  repoFacts,
  type RepoFacts,
  type RepoGroup,
} from '../similarity/run.ts'
import { summarise, type NotCompared, type PairRow } from '../similarity/summary.ts'
import { createTreeLoader, type Loaded, type TreeInput } from '../similarity/trees.ts'
import type { Analysis, RepoFiles } from '../similarity/types.ts'
import { useApp, usePeople } from '../state/hooks.ts'
import { loadCommits } from '../state/person.ts'
import { client } from '../state/store.ts'
import { PauseNotice } from './PauseNotice.tsx'
import { FirstCell, FirstEvidence } from './WhoFirst.tsx'

// File lists are addressed by commit id, so one loader keeps them for the whole session.
const loader = createTreeLoader(client.get)
// Push logs and the files at an older commit never change either: one runner keeps them too.
const firstRunner = createFirstRunner({ history: createHistoryLoader(client.get), commits: loadCommits })

/** Rows drawn before "Show all". A class of 200 can produce thousands of weak pairs. */
const VISIBLE_PAIRS = 100
const VISIBLE_FILES = 100
const LIMIT_CHOICES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 30, 50, 100]

type Lists =
  | { phase: 'waiting' }
  | { phase: 'loading'; done: number; total: number }
  | { phase: 'ready'; loaded: Loaded }

/** Loads the file list of every repo. An answer for an older sheet or commit is ignored. */
function useFileLists(inputs: readonly TreeInput[], enabled: boolean) {
  const key = inputs.map((input) => `${input.repo}@${input.headOid}`).join('|')
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ id: string; lists: Lists } | null>(null)
  const id = `${key}#${attempt}`

  useEffect(() => {
    if (!enabled || inputs.length === 0) return
    let live = true
    void loader
      .loadAll(inputs, (done, total) => {
        if (live) setResult({ id, lists: { phase: 'loading', done, total } })
      })
      .then((loaded) => {
        if (live) setResult({ id, lists: { phase: 'ready', loaded } })
      })
    return () => {
      live = false
    }
    // `inputs` is a new array whenever the register re-judges its rows; `id`
    // changes only when a repo or its head commit does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled])

  const lists: Lists =
    !enabled || inputs.length === 0
      ? { phase: 'waiting' }
      : result && result.id === id
        ? result.lists
        : { phase: 'loading', done: 0, total: inputs.length }
  return { lists, retry: () => setAttempt((count) => count + 1) }
}

/**
 * Runs the comparison in a Web Worker. Null until the first answer for these
 * file lists; after that the previous answer stays on screen while a new limit
 * is worked out, so the page does not blink and the limit box keeps its focus.
 */
function useAnalysis(trees: ReadonlyMap<string, RepoFiles> | null, commonLimit: number): Analysis | null {
  const [result, setResult] = useState<{ trees: unknown; analysis: Analysis } | null>(null)

  useEffect(() => {
    if (!trees) return
    const repos = [...trees.values()]
    let live = true
    const finish = (analysis: Analysis) => {
      if (live) setResult({ trees, analysis })
    }
    // A browser that cannot start the worker still gets its answer, on this thread.
    const here = () => queueMicrotask(() => finish(analyse(repos, { commonLimit })))
    let worker: Worker | null = null
    try {
      worker = new Worker(new URL('../similarity/compare.worker.ts', import.meta.url), { type: 'module' })
      worker.addEventListener('message', (event: MessageEvent<Analysis>) => finish(event.data))
      worker.addEventListener('error', here)
      const request: CompareRequest = { repos, commonLimit }
      worker.postMessage(request)
    } catch {
      here()
    }
    return () => {
      live = false
      worker?.terminate()
    }
  }, [trees, commonLimit])

  return result && result.trees === trees ? result.analysis : null
}

const NOT_CHECKED: { states: FirstStates; progress: FirstProgress } = {
  states: new Map(),
  progress: { done: 0, total: 0 },
}

/**
 * Works out, pair by pair, who had the shared files on GitHub first. It starts
 * again when the comparison or a repo changes; what was read before is kept, so
 * another starter limit costs no new requests.
 */
function useFirst(
  analysis: Analysis | null,
  trees: ReadonlyMap<string, RepoFiles> | null,
  facts: ReadonlyMap<string, RepoFacts>,
  shared: Shared | null,
) {
  // `facts` is a new map whenever the register re-judges its rows; this text
  // changes only when something about a repo does.
  const factsKey = [...facts.values()]
    .map((entry) =>
      [entry.repo, entry.headOid, entry.createdAt, entry.pushedAt, entry.isFork, entry.parent, entry.template].join(' '),
    )
    .join('|')
  const [result, setResult] = useState<{
    analysis: Analysis
    states: FirstStates
    progress: FirstProgress
  } | null>(null)
  const run = useRef<FirstRun | null>(null)

  useEffect(() => {
    if (!analysis || !trees || !shared) return
    const started = firstRunner.start(
      { pairs: analysis.pairs, trees, facts, starter: shared.starter },
      (states, progress) => setResult({ analysis, states, progress }),
    )
    run.current = started
    return () => {
      started.stop()
      if (run.current === started) run.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, trees, shared, factsKey])

  const open = useCallback((key: string) => run.current?.open(key), [])
  const current = result && result.analysis === analysis ? result : NOT_CHECKED
  return { states: current.states, progress: current.progress, open }
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`

export function SimilarityView() {
  const sheet = useApp((state) => state.sheet)
  const people = usePeople()
  const plan = useMemo(() => planComparison(people), [people])
  const { lists, retry } = useFileLists(plan.inputs, plan.waiting === 0)
  const loaded = lists.phase === 'ready' ? lists.loaded : null

  const repoCount = loaded?.trees.size ?? 0
  // With three repos nothing can be in "more than 4": show the limit that is really in force.
  const never = Math.max(repoCount, 2)
  const suggested = Math.min(defaultCommonLimit(repoCount), never)
  const [chosenLimit, setChosenLimit] = useState<number | null>(null)
  const limit = Math.min(chosenLimit ?? suggested, never)

  const analysis = useAnalysis(loaded?.trees ?? null, limit)
  const summary = useMemo(
    () => (loaded && analysis ? summarise(plan, loaded, analysis) : null),
    [plan, loaded, analysis],
  )
  const shared = useMemo(() => (analysis ? sharedSets(analysis) : null), [analysis])
  const facts = useMemo(() => repoFacts(people), [people])
  const first = useFirst(analysis, loaded?.trees ?? null, facts, shared)

  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const [downloadFailed, setDownloadFailed] = useState(false)

  if (!sheet) return null

  const toggle = (key: string) => {
    // Opening a pair that was not checked for "who had it first" checks it.
    if (!open.has(key)) first.open(key)
    setOpen((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const download = async () => {
    if (!summary || !analysis || !loaded) return
    setDownloadFailed(false)
    try {
      // The Excel library is fetched on first use.
      const report = await import('../similarity/report.ts')
      report.downloadReport({
        summary,
        analysis,
        trees: loaded.trees,
        first: first.states,
        info: {
          fileName: sheet.fileName,
          sheetName: sheet.sheetName,
          checkedAt: Date.now(),
          zone: zoneLabel(),
        },
      })
    } catch (error) {
      console.error('The similarity report could not be written:', error)
      setDownloadFailed(true)
    }
  }

  // Before the comparison has run, the plan alone already knows these two.
  const sameRepo = summary?.sameRepo ?? plan.groups.filter((group) => group.people.length > 1)
  const notCompared: NotCompared[] =
    summary?.notCompared ??
    plan.leftOut.map((entry) => ({ label: personLabel(entry.person), repo: null, reason: entry.reason }))
  const nothing = plan.waiting === 0 && plan.inputs.length === 0
  const failed = loaded ? loaded.errors.size : 0
  const pairs = summary?.pairs ?? []
  const sameRepoRows = pairs.filter((pair) => pair.kind === 'same_repo').length
  const repoPairs = pairs.length - sameRepoRows
  const shown = showAll ? pairs : pairs.slice(0, VISIBLE_PAIRS)
  const limits = [...new Set([...LIMIT_CHOICES.filter((value) => value < never), suggested, never])].sort(
    (a, b) => a - b,
  )

  return (
    <section className="similarity">
      <nav className="similarity__nav" aria-label="Similarity">
        <a className="backlink" href="#/">
          ← Back to the register
        </a>
        <span className="similarity__sheet mono">{sheet.fileName}</span>
      </nav>

      <header className="similarity__head">
        <h1 className="similarity__title">Similarity report</h1>
        <p className="similarity__lede">
          Shows which repos hold files with exactly the same content, whatever the files are
          called. Downloaded packages, pictures, tool settings and files that most of the class
          has are left out first. For each pair it also looks up who had those files on GitHub
          first. A copy that was edited in every file is not found, so read this as a list of
          places to look, not as a verdict.
        </p>
      </header>

      <PauseNotice />

      {sameRepo.length > 0 ? (
        <div className="notice notice--bad similarity__same" role="note">
          <p>
            <strong>{plural(sameRepo.length, 'repo was', 'repos were')} handed in by more than one person.</strong>{' '}
            Each is a 100% match and is listed first in the table below.
          </p>
          <ul>
            {sameRepo.map((group) => (
              <li key={group.repo}>
                <a className="mono" href={repoUrl(group.repo)} target="_blank" rel="noopener noreferrer">
                  {group.nameWithOwner}
                </a>
                : {group.people.map(personLabel).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.waiting > 0 ? (
        <p className="empty" role="status">
          Waiting for the register to finish checking {plural(plan.waiting, 'row')}.
        </p>
      ) : null}

      {nothing ? (
        <p className="empty">There is nothing to compare: no row of this sheet leads to a repo with files.</p>
      ) : null}

      {lists.phase === 'loading' || (loaded && !analysis) ? (
        <div className="similarity__progress" role="status" aria-live="polite">
          <progress
            className="progress"
            max={plan.inputs.length}
            value={lists.phase === 'loading' ? lists.done : plan.inputs.length}
          />
          <p className="similarity__progress-text">
            {lists.phase === 'loading'
              ? `Reading file lists: ${lists.done} of ${lists.total} repos`
              : `Comparing ${plural(repoCount, 'repo')}`}
          </p>
        </div>
      ) : null}

      {summary && analysis && loaded ? (
        <>
          <div className="similarity__bar">
            <p className="similarity__summary">
              <strong>{plural(pairs.length, 'match', 'matches')}</strong> found
              {pairs.length > 0 ? ':' : '.'}{' '}
              {sameRepoRows > 0 ? (
                <>
                  {plural(sameRepoRows, 'repo')} handed in by more than one person (100%)
                  {repoPairs > 0 ? ' and ' : '. '}
                </>
              ) : null}
              {repoPairs > 0 || sameRepoRows === 0 ? (
                <>
                  {plural(repoPairs, 'pair')} of different repos with identical files.{' '}
                </>
              ) : null}
              <span className="similarity__dim">
                {plural(summary.compared, 'repo')} compared, which makes {plural(analysis.totalPairs, 'pair')}.
              </span>
            </p>
            <div className="similarity__actions">
              {failed > 0 ? (
                <button type="button" className="button" onClick={retry}>
                  Try again
                </button>
              ) : null}
              <button type="button" className="button button--primary" onClick={() => void download()}>
                Download .xlsx
              </button>
            </div>
          </div>
          {downloadFailed ? (
            <p className="notice notice--bad" role="alert">
              The report could not be written. Please try again.
            </p>
          ) : null}

          {summary.onlyStarter > 0 ? (
            <p className="notice notice--warn" role="note">
              <strong>
                {plural(summary.onlyStarter, 'repo holds', 'repos hold')} nothing but files that more than{' '}
                {analysis.commonLimit} repos have.
              </strong>{' '}
              That is expected when a repo contains only what was handed out. If the files listed
              under &ldquo;Starter files&rdquo; below are the students&rsquo; own work, many people
              handed in the same solution: raise the limit to compare them.
            </p>
          ) : null}

          <form className="similarity__limit" onSubmit={(event) => event.preventDefault()}>
            <label className="deadline__label" htmlFor="starter-limit">
              Starter files
            </label>
            <span>
              A file found in more than{' '}
              <select
                id="starter-limit"
                value={limit}
                onChange={(event) => setChosenLimit(Number(event.target.value))}
              >
                {limits.map((value) => (
                  <option key={value} value={value}>
                    {value === never
                      ? `${value}: count every file`
                      : value === suggested
                        ? `${value} (suggested)`
                        : value}
                  </option>
                ))}
              </select>{' '}
              repos was probably handed out, so it is not counted.{' '}
              {analysis.starter.length > 0
                ? `${plural(analysis.starter.length, 'file is', 'files are')} left out this way.`
                : 'No file is left out this way.'}
            </span>
          </form>

          {analysis.starter.length > 0 ? (
            <details className="similarity__fold">
              <summary>Starter files that are not counted ({analysis.starter.length.toLocaleString('en')})</summary>
              <p>
                If you see a student&rsquo;s own work in this list, many repos hold the same solution:
                raise the limit above to count it.
              </p>
              <ul className="similarity__list">
                {analysis.starter.slice(0, VISIBLE_FILES).map((file) => (
                  <li key={file.sha}>
                    <span className="mono">{file.path}</span>
                    <span className="similarity__dim">
                      in {plural(file.repos, 'repo')} · {fileSize(file.size)}
                    </span>
                  </li>
                ))}
                {analysis.starter.length > VISIBLE_FILES ? (
                  <li className="similarity__dim">
                    +{(analysis.starter.length - VISIBLE_FILES).toLocaleString('en')} more, all in the .xlsx
                  </li>
                ) : null}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}

      {notCompared.length > 0 ? (
        <details className="similarity__fold similarity__fold--warn">
          <summary>Not compared ({notCompared.length})</summary>
          <ul className="similarity__list">
            {notCompared.map((entry) => (
              <li key={`${entry.label}|${entry.repo ?? ''}|${entry.reason}`}>
                <span>
                  {entry.label}
                  {entry.repo ? <span className="mono"> {entry.repo}</span> : null}
                </span>
                <span className="similarity__dim">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {summary && loaded && shared ? (
        pairs.length > 0 ? (
          <>
            {first.progress.done < first.progress.total ? (
              <p className="similarity__progress-text" role="status" aria-live="polite">
                Checking who had the files first: {first.progress.done} of {first.progress.total} repos
              </p>
            ) : null}
            <div className="ledger similarity__table-wrap">
              <table className="ledger__table similarity__table">
                <thead>
                  <tr>
                    <th scope="col">A</th>
                    <th scope="col">B</th>
                    <th scope="col">Match</th>
                    <th scope="col">Who had it first</th>
                    <th scope="col" className="is-number">
                      Identical
                    </th>
                    <th scope="col" className="is-number">
                      Of A
                    </th>
                    <th scope="col" className="is-number">
                      Of B
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Files</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((pair) => {
                    const key = `${pair.summary.aKey}|${pair.summary.bKey}`
                    const isOpen = open.has(key)
                    return (
                      <Fragment key={key}>
                        <PairLine
                          pair={pair}
                          first={pair.kind === 'repos' ? first.states.get(key) : undefined}
                          isOpen={isOpen}
                          onToggle={() => toggle(key)}
                        />
                        {isOpen ? (
                          <tr className="similarity__detail">
                            <td colSpan={8}>
                              {pair.kind === 'same_repo' ? (
                                <SameRepoFiles pair={pair} tree={loaded.trees.get(pair.a.repo)} />
                              ) : (
                                <PairFiles
                                  pair={pair}
                                  trees={loaded.trees}
                                  shared={shared}
                                  first={first.states.get(key)}
                                  onCheck={() => first.open(key)}
                                />
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {repoPairs === 0 ? (
              <p className="similarity__more">
                Apart from the repos handed in by more than one person, no two different repos hold a
                file with the same content.
              </p>
            ) : null}
            {pairs.length > shown.length ? (
              <p className="similarity__more">
                Showing the {shown.length} strongest of {pairs.length.toLocaleString('en')} pairs.{' '}
                <button type="button" className="linkish" onClick={() => setShowAll(true)}>
                  Show all
                </button>
              </p>
            ) : null}
          </>
        ) : (
          <p className="empty">No two different repos in this sheet hold a file with the same content.</p>
        )
      ) : null}
    </section>
  )
}

/** "3 of 5 · 60%": how many of one side's compared files are in the other, and that share. */
function ofText(identical: number, own: number, share: number): string {
  return own === 0 ? '100%' : `${identical} of ${own} · ${percent(share)}`
}

function Side({ group, max }: { group: RepoGroup; max?: number }) {
  return (
    <>
      <strong>{groupLabel(group, max)}</strong>
      <a className="similarity__repo mono" href={repoUrl(group.repo)} target="_blank" rel="noopener noreferrer">
        {group.nameWithOwner}
      </a>
      {group.isFork ? <span className="tag">Fork</span> : null}
    </>
  )
}

function PairLine({
  pair,
  first,
  isOpen,
  onToggle,
}: {
  pair: PairRow
  /** Undefined for a repo handed in by several people: one repo has no direction. */
  first: FirstState | undefined
  isOpen: boolean
  onToggle: () => void
}) {
  const { summary } = pair
  const tone = tierTone(summary.tier)
  const onRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
    // The whole row is a shortcut; the links and the button inside it keep working.
    if ((event.target as HTMLElement).closest('a, button')) return
    if (window.getSelection()?.toString()) return
    onToggle()
  }
  return (
    <tr
      className={`entry entry--${tone} similarity__row${isOpen ? ' similarity__row--open' : ''}`}
      onClick={onRowClick}
    >
      {pair.kind === 'same_repo' ? (
        <>
          <td className="similarity__side" data-label="People">
            <Side group={pair.a} max={pair.a.people.length} />
          </td>
          <td className="similarity__side" data-label="Repo">
            <strong>Same repo</strong>{' '}
            <span className="similarity__dim">handed in by {plural(pair.a.people.length, 'person', 'people')}</span>
          </td>
        </>
      ) : (
        <>
          <td className="similarity__side" data-label="A">
            <Side group={pair.a} />
          </td>
          <td className="similarity__side" data-label="B">
            <Side group={pair.b} />
          </td>
        </>
      )}
      <td className="similarity__match" data-label="Match">
        <span className={`stamp stamp--${tone}`}>
          <span className="stamp__label">{percent(summary.score)}</span>
          <span className="stamp__detail"> {tierLabel(summary.tier)}</span>
        </span>
        {summary.sameCommit && pair.kind === 'repos' ? (
          <span className="entry__notes">Same commit in both repos</span>
        ) : null}
      </td>
      <td className="similarity__who" data-label="Who had it first">
        <FirstCell state={first} tier={summary.tier} />
      </td>
      <td className="is-number mono" data-label="Identical">
        {pair.kind === 'same_repo' && summary.identical === 0 ? 'every file' : plural(summary.identical, 'file')}
      </td>
      <td className="is-number mono" data-label="Of A">
        {ofText(summary.aIdentical, summary.aOwn, summary.aShare)}
      </td>
      <td className="is-number mono" data-label="Of B">
        {ofText(summary.bIdentical, summary.bOwn, summary.bShare)}
      </td>
      <td className="similarity__toggle">
        <button type="button" className="linkish" aria-expanded={isOpen} onClick={onToggle}>
          {isOpen ? 'Hide files' : 'Show files'}
        </button>
      </td>
    </tr>
  )
}

/** The detail of a repo handed in by several people: who, and the files they all handed in. */
function SameRepoFiles({ pair, tree }: { pair: PairRow; tree: RepoFiles | undefined }) {
  return (
    <div className="similarity__files">
      <section className="similarity__paths similarity__paths--bad">
        <h4 className="similarity__paths-title">Handed in by ({pair.a.people.length})</h4>
        <ul className="similarity__paths-list">
          {pair.a.people.map((person) => (
            <li key={person.rowId}>
              <span>{personLabel(person)}</span>
              <span className="similarity__dim">row {person.rowNumber}</span>
            </li>
          ))}
        </ul>
      </section>
      {tree ? (
        <section className="similarity__paths">
          <h4 className="similarity__paths-title">Files, the same for all of them ({tree.files.length})</h4>
          <ul className="similarity__paths-list">
            {tree.files.slice(0, VISIBLE_FILES).map((file) => (
              <li key={file.path}>
                <span className="mono">{file.path}</span>
                <span className="similarity__dim">{fileSize(file.size)}</span>
              </li>
            ))}
            {tree.files.length > VISIBLE_FILES ? (
              <li className="similarity__dim">
                +{(tree.files.length - VISIBLE_FILES).toLocaleString('en')} more
              </li>
            ) : null}
          </ul>
          <dl className="similarity__rest">
            <dt>Left out</dt>
            <dd>{leftOutText(tree)}</dd>
          </dl>
        </section>
      ) : null}
    </div>
  )
}

function leftOutText(tree: RepoFiles): string {
  const parts = [describeSkips(tree.skipped)]
  if (tree.unopened > 0) parts.push(`${plural(tree.unopened, 'third-party folder')} never opened`)
  return parts.filter(Boolean).join(', ') || 'nothing'
}

function PairFiles({
  pair,
  trees,
  shared,
  first,
  onCheck,
}: {
  pair: PairRow
  trees: ReadonlyMap<string, RepoFiles>
  shared: Shared
  first: FirstState | undefined
  onCheck: () => void
}) {
  const a = trees.get(pair.a.repo)
  const b = trees.get(pair.b.repo)
  const detail = useMemo(() => (a && b ? pairDetail(a, b, shared) : null), [a, b, shared])
  if (!a || !b || !detail) return null
  const aLabel = groupLabel(pair.a, 1)
  const bLabel = groupLabel(pair.b, 1)

  return (
    <>
      <FirstEvidence state={first} tier={pair.summary.tier} onCheck={onCheck} />
      <div className="similarity__files">
        <section className="similarity__paths similarity__paths--bad">
          <h4 className="similarity__paths-title">Identical content ({detail.identical.length})</h4>
          <ul className="similarity__paths-list">
            {detail.identical.slice(0, VISIBLE_FILES).map((file) => (
              <li key={file.aPath}>
                <span className="mono">
                  {file.aPath === file.bPath ? file.aPath : `${file.aPath} = ${file.bPath}`}
                </span>
                <span className="similarity__dim">{fileSize(file.size)}</span>
              </li>
            ))}
            {detail.identical.length > VISIBLE_FILES ? (
              <li className="similarity__dim">
                +{(detail.identical.length - VISIBLE_FILES).toLocaleString('en')} more, in the .xlsx
              </li>
            ) : null}
          </ul>
        </section>

        {detail.sameName.length > 0 ? (
          <section className="similarity__paths similarity__paths--warn">
            <h4 className="similarity__paths-title">Same name, other content ({detail.sameName.length})</h4>
            <ul className="similarity__paths-list">
              {detail.sameName.slice(0, VISIBLE_FILES).map((file) => (
                <li key={file.path}>
                  <span className="mono">{file.path}</span>
                  <span className="similarity__dim">
                    {fileSize(file.aSize)} / {fileSize(file.bSize)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="similarity__paths">
          <h4 className="similarity__paths-title">The rest</h4>
          <dl className="similarity__rest">
            <dt>Only in A ({aLabel})</dt>
            <dd>{plural(detail.onlyA, 'file')}</dd>
            <dt>Only in B ({bLabel})</dt>
            <dd>{plural(detail.onlyB, 'file')}</dd>
            <dt>Starter files both have</dt>
            <dd>{detail.starter === 0 ? 'none' : `${detail.starter}, not counted`}</dd>
            <dt>Left out of A</dt>
            <dd>{leftOutText(a)}</dd>
            <dt>Left out of B</dt>
            <dd>{leftOutText(b)}</dd>
          </dl>
        </section>
      </div>
    </>
  )
}
