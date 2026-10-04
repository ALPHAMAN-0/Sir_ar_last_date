// The similarity tab. Reads repos from the store, fetches their file
// trees from public api.github.com (no token, anonymous), runs the
// comparison in a Web Worker, then shows the result sorted by Jaccard
// similarity. Click a row to see the shared / unique paths.

import { Fragment, useEffect, useState } from 'react'
import type { RepoOk } from '../../shared/api.ts'
import { zoneLabel } from '../logic/time.ts'
import { tier } from '../similarity/compare.ts'
import { percent, tierLabel, tierTone } from '../similarity/format.ts'
import { downloadReport, type ReportPair } from '../similarity/report.ts'
import { comparableRepos, treeInputs } from '../similarity/run.ts'
import { fetchAll, type TreeError } from '../similarity/trees.ts'
import type { FileTree, Pair } from '../similarity/types.ts'
import { useApp, useNow, usePeople } from '../state/hooks.ts'

type ProgressEvent = { done: number; total: number; current: string }

type FetchResult = {
  trees: Map<string, FileTree>
  errors: Map<string, TreeError>
}

const NONE: never[] = []

/**
 * Wraps the comparison in a Web Worker. Vite bundles compare.worker.ts
 * into a separate worker chunk when used with `new Worker(new URL(...))`.
 */
function runInWorker(trees: Map<string, FileTree>): Promise<Pair[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../similarity/compare.worker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      reject(error)
      return
    }
    worker.addEventListener('message', (event: MessageEvent<{ pairs: Pair[] }>) => {
      resolve(event.data.pairs)
      worker.terminate()
    })
    worker.addEventListener('error', (event) => {
      reject(new Error(event.message || 'Worker error'))
      worker.terminate()
    })
    worker.postMessage({ trees: [...trees.entries()] })
  })
}

/** Builds a friendly label for a repo, preferring the sheet's id/name. */
function repoLabel(repoKey: string, labelByKey: Map<string, string>): string {
  const fromSheet = labelByKey.get(repoKey)
  return fromSheet ?? repoKey
}

/**
 * Loads the trees and runs the comparison. Returns a discriminated
 * state value so the view can render each phase without a separate
 * "is loading" flag. Drops late answers when the comparable set
 * changes mid-flight.
 */
type RunOutcome =
  | { phase: 'idle' }
  | { phase: 'fetching'; progress: ProgressEvent }
  | { phase: 'comparing'; fetch: FetchResult }
  | { phase: 'ready'; fetch: FetchResult; pairs: Pair[] }
  | { phase: 'error'; message: string }

function useSimilarityRun(comparable: readonly RepoOk[]): RunOutcome {
  const [outcome, setOutcome] = useState<RunOutcome>({ phase: 'idle' })
  // Stable key so a re-order of the same repos does not refetch.
  const comparableKey = comparable
    .map((repo) => `${repo.key}@${repo.headOid ?? ''}@${repo.defaultBranch ?? ''}`)
    .join('|')

  useEffect(() => {
    if (comparable.length < 2) {
      setOutcome({ phase: 'idle' })
      return
    }
    let cancelled = false
    setOutcome({ phase: 'fetching', progress: { done: 0, total: comparable.length, current: '' } })

    void (async () => {
      try {
        const fetchResult = await fetchAll(treeInputs(comparable), {
          concurrency: 4,
          onProgress: (done, total, current) => {
            if (cancelled) return
            setOutcome({ phase: 'fetching', progress: { done, total, current } })
          },
        })
        if (cancelled) return
        if (fetchResult.trees.size < 2) {
          setOutcome({ phase: 'ready', fetch: fetchResult, pairs: [] })
          return
        }
        setOutcome({ phase: 'comparing', fetch: fetchResult })
        const resultPairs = await runInWorker(fetchResult.trees)
        if (cancelled) return
        setOutcome({ phase: 'ready', fetch: fetchResult, pairs: resultPairs })
      } catch (error) {
        if (cancelled) return
        setOutcome({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Could not run the comparison.',
        })
      }
    })()

    return () => {
      cancelled = true
    }
    // comparableKey changes only when the set of (repo, head, branch)
    // tuples changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparableKey])

  return outcome
}

export function SimilarityView() {
  const sheet = useApp((state) => state.sheet)
  const people = usePeople()
  const now = useNow()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // One map per repo key. The label is "id · name" when both exist,
  // falling back to the key. The .xlsx export uses the structured parts.
  const metaByKey = (() => {
    const map = new Map<string, { id: string; name: string; branch: string; headOid: string; label: string }>()
    for (const person of people) {
      const link = person.row.link
      if (!link.ok) continue
      if (map.has(link.key)) continue
      const meta = person.meta
      const parts: string[] = []
      if (person.row.id) parts.push(person.row.id)
      if (person.row.name) parts.push(person.row.name)
      map.set(link.key, {
        id: person.row.id,
        name: person.row.name,
        branch: meta?.state === 'ok' ? (meta.defaultBranch ?? '') : '',
        headOid: meta?.state === 'ok' ? (meta.headOid ?? '') : '',
        label: parts.length > 0 ? parts.join(' · ') : link.key,
      })
    }
    return map
  })()
  const labelByKey = new Map<string, string>()
  for (const [key, meta] of metaByKey) labelByKey.set(key, meta.label)

  const okRepos = people.flatMap((person) => {
    const key = person.row.link.ok ? person.row.link.key : null
    if (!key) return NONE
    const meta = person.meta
    if (!meta || meta.state !== 'ok') return NONE
    return [meta]
  })
  const comparable = comparableRepos(okRepos)
  const outcome = useSimilarityRun(comparable)

  // Derive these from outcome so we don't keep separate useState calls.
  const phase = outcome.phase
  const progress = outcome.phase === 'fetching' ? outcome.progress : null
  const result = outcome.phase === 'ready' || outcome.phase === 'comparing' ? outcome.fetch : null
  const pairs = outcome.phase === 'ready' ? outcome.pairs : []
  const errorMessage = outcome.phase === 'error' ? outcome.message : null

  const sortedPairs = (() => {
    const copy = [...pairs]
    copy.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.overlap !== a.overlap) return b.overlap - a.overlap
      return a.aKey.localeCompare(b.aKey)
    })
    return copy
  })()

  const treeCount = result?.trees.size ?? 0
  const errorCount = result?.errors.size ?? 0

  if (!sheet) return null

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const totalPossiblePairs = (comparable.length * (comparable.length - 1)) / 2

  const onDownload = () => {
    if (phase !== 'ready' || !result) return
    const rows: ReportPair[] = sortedPairs.map((pair) => {
      const aMeta = metaByKey.get(pair.aKey)
      const bMeta = metaByKey.get(pair.bKey)
      return {
        aKey: pair.aKey,
        aId: aMeta?.id ?? '',
        aName: aMeta?.name ?? '',
        aBranch: pair.aBranch,
        aHeadOid: pair.aHeadOid,
        bKey: pair.bKey,
        bId: bMeta?.id ?? '',
        bName: bMeta?.name ?? '',
        bBranch: pair.bBranch,
        bHeadOid: pair.bHeadOid,
        overlap: pair.overlap,
        union: pair.union,
        score: pair.score,
        shared: pair.shared,
        onlyA: pair.onlyA,
        onlyB: pair.onlyB,
      }
    })
    downloadReport(rows, {
      sheetName: sheet.sheetName,
      checkedAt: now,
      totalTrees: comparable.length,
      failedTrees: errorCount,
      totalPairs: totalPossiblePairs,
      zone: zoneLabel(),
    })
  }

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
          How similar each pair of repos looks by file names. Not a verdict on copying: two
          students independently writing <span className="mono">index.html</span> and{' '}
          <span className="mono">style.css</span> will score high. Use this as a starting point
          for a closer look.
        </p>
      </header>

      <p className="notice notice--warn similarity__note" role="note">
        File-name overlap only. Anonymous GitHub requests (60 per hour, 5,000 if you sign in).
      </p>

      {comparable.length < 2 ? (
        <p className="empty">
          Need at least two checked repos to compare. The register shows progress for each one.
        </p>
      ) : null}

      {phase === 'fetching' || phase === 'comparing' ? (
        <div className="similarity__progress" role="status" aria-live="polite">
          <progress
            className="progress"
            max={comparable.length}
            value={progress?.done ?? 0}
          />
          <p className="similarity__progress-text">
            {phase === 'fetching'
              ? `Fetching file trees ${progress?.done ?? 0} of ${progress?.total ?? comparable.length}${
                  progress?.current ? ` · ${progress.current}` : ''
                }`
              : `Comparing ${treeCount} trees…`}
          </p>
        </div>
      ) : null}

      {phase === 'error' && errorMessage ? (
        <p className="notice notice--bad" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {phase === 'ready' && result ? (
        <>
          <p className="similarity__summary">
            {treeCount} of {comparable.length} trees fetched
            {errorCount > 0 ? `, ${errorCount} could not be listed` : ''}.{' '}
            {sortedPairs.length} {sortedPairs.length === 1 ? 'pair' : 'pairs'} compared.
          </p>

          {sortedPairs.length > 0 ? (
            <p className="similarity__download">
              <button type="button" className="button button--primary" onClick={onDownload}>
                Download .xlsx
              </button>
            </p>
          ) : null}

          {errorCount > 0 ? (
            <details className="similarity__errors">
              <summary>Repos whose file tree could not be listed ({errorCount})</summary>
              <ul>
                {[...result.errors.entries()].map(([repoKey, err]) => (
                  <li key={repoKey}>
                    <span className="mono">{repoKey}</span>: {describeError(err)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {sortedPairs.length > 0 ? (
            <div className="ledger similarity__table-wrap">
              <table className="ledger__table similarity__table">
                <thead>
                  <tr>
                    <th>A</th>
                    <th>B</th>
                    <th className="is-number">Overlap</th>
                    <th className="is-number">Shared</th>
                    <th className="is-number">Only A</th>
                    <th className="is-number">Only B</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPairs.map((pair) => {
                    const aLabel = repoLabel(pair.aKey, labelByKey)
                    const bLabel = repoLabel(pair.bKey, labelByKey)
                    const key = `${pair.aKey}|${pair.bKey}`
                    const isOpen = expanded.has(key)
                    const t = tier(pair.score)
                    const tone = tierTone(t)
                    return (
                      <Fragment key={key}>
                        <tr
                          className={`entry similarity__row similarity__row--${tone}${
                            isOpen ? ' similarity__row--open' : ''
                          }`}
                          onClick={() => toggle(key)}
                        >
                          <td className="entry__name">
                            <span className={`tone tone--${tone}`} aria-hidden="true" />
                            {aLabel}
                          </td>
                          <td className="entry__name">{bLabel}</td>
                          <td className="is-number mono">
                            <span className={`stamp stamp--${tone}`}>
                              <span className="stamp__label">{percent(pair.score)}</span>
                              <span className="stamp__detail"> {tierLabel(t)}</span>
                            </span>
                          </td>
                          <td className="is-number mono">{pair.overlap}</td>
                          <td className="is-number mono">{pair.onlyA.length}</td>
                          <td className="is-number mono">{pair.onlyB.length}</td>
                        </tr>
                        {isOpen ? (
                          <tr className="similarity__detail">
                            <td colSpan={6}>
                              <PairDetail pair={pair} aLabel={aLabel} bLabel={bLabel} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">
              Nothing to compare. Most repos in this sheet could not be listed by GitHub.
            </p>
          )}
        </>
      ) : null}
    </section>
  )
}

/** Renders the expanded path lists for one pair. */
function PairDetail({ pair, aLabel, bLabel }: { pair: Pair; aLabel: string; bLabel: string }) {
  return (
    <div className="similarity__detail-grid">
      <PathList tone="good" title={`In both (${pair.shared.length})`} paths={pair.shared} />
      <PathList tone="info" title={`Only in ${aLabel} (${pair.onlyA.length})`} paths={pair.onlyA} />
      <PathList tone="info" title={`Only in ${bLabel} (${pair.onlyB.length})`} paths={pair.onlyB} />
    </div>
  )
}

function PathList({
  tone,
  title,
  paths,
}: {
  tone: 'good' | 'info'
  title: string
  paths: string[]
}) {
  return (
    <section className={`similarity__paths similarity__paths--${tone}`}>
      <h4 className="similarity__paths-title">{title}</h4>
      {paths.length === 0 ? (
        <p className="similarity__paths-empty">None.</p>
      ) : (
        <ul className="similarity__paths-list">
          {paths.slice(0, 50).map((path) => (
            <li key={path} className="mono">
              {path}
            </li>
          ))}
          {paths.length > 50 ? (
            <li className="similarity__paths-more">
              +{paths.length - 50} more (download the .xlsx to see all)
            </li>
          ) : null}
        </ul>
      )}
    </section>
  )
}

function describeError(err: TreeError): string {
  if (err.kind === 'http' && err.status === 403) {
    return 'Rate-limited. Sign in to GitHub to raise the limit.'
  }
  return err.message
}