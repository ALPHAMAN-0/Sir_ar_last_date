// The shared-code part of the similarity tab: which repos hold the same code
// even where a copy was edited, so that no file is identical any more. The rules
// and the arithmetic live in src/similarity (codeText.ts, sharedCode.ts); this
// file only draws.

import { Fragment, useMemo, useState, type MouseEvent } from 'react'
import type { CodeLoaded, LoadedCode } from '../similarity/codeLoader.ts'
import { MAX_TEXT_BYTES } from '../similarity/codeText.ts'
import { codeTierLabel, codeTierTone, fileSize, fileUrl, isNotebook, percent, rangesText } from '../similarity/format.ts'
import { groupLabel, type RepoGroup } from '../similarity/run.ts'
import { codePairDetail, type CodeAnalysis, type CodePair, type LineRange } from '../similarity/sharedCode.ts'
import type { RepoFiles } from '../similarity/types.ts'
import { Side } from './SimilaritySide.tsx'

export type CodeLists = { phase: 'loading'; done: number; total: number } | { phase: 'ready'; loaded: CodeLoaded }

/** Rows drawn before "Show all". */
const VISIBLE_PAIRS = 100
const VISIBLE_FILES = 100

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`


/** "22 of 40 · 55%": one side's shared lines, its own lines of code, and the share. */
function ofText(shared: number, own: number, share: number): string {
  return `${shared.toLocaleString('en')} of ${own.toLocaleString('en')} · ${percent(share)}`
}

export function SharedCode({
  lists,
  analysis,
  groups,
  trees,
  commonLimit,
  onRetry,
}: {
  lists: CodeLists
  analysis: CodeAnalysis | null
  groups: ReadonlyMap<string, RepoGroup>
  trees: ReadonlyMap<string, RepoFiles>
  /** The starter-file limit in force: code found in more repos is not counted. */
  commonLimit: number
  onRetry: () => void
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const common = useMemo(() => (analysis ? new Set(analysis.common) : null), [analysis])
  const loaded = lists.phase === 'ready' ? lists.loaded : null

  const toggle = (key: string) =>
    setOpen((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const rows = (analysis?.pairs ?? []).flatMap((pair) => {
    const a = groups.get(pair.aKey)
    const b = groups.get(pair.bKey)
    return a && b ? [{ pair, a, b }] : []
  })
  const shown = showAll ? rows : rows.slice(0, VISIBLE_PAIRS)
  const strong = rows.filter(({ pair }) => pair.tier === 'almost_all' || pair.tier === 'most').length
  const failed = loaded ? [...loaded.errors] : []

  return (
    <section className="similarity__section" aria-labelledby="shared-code-title">
      <header className="similarity__head">
        <h2 id="shared-code-title" className="similarity__section-title">
          Shared code
        </h2>
        <p className="similarity__lede">
          Finds code that two repos share even where a copy was edited, so no file is identical
          any more. Spaces, line endings, letter case and comments are ignored, and a copy with
          some lines changed is still found. Code that more than {commonLimit} repos have is not
          counted, the same limit as for starter files. Two students can share code because both
          took it from the same class example, so read this as places to look, not proof. It
          does not say who had the code first.
        </p>
      </header>

      {lists.phase === 'loading' || !analysis ? (
        <div className="similarity__progress" role="status" aria-live="polite">
          <progress
            className="progress"
            max={lists.phase === 'loading' ? lists.total : 1}
            value={lists.phase === 'loading' ? lists.done : 1}
          />
          <p className="similarity__progress-text">
            {lists.phase === 'loading'
              ? `Reading the code: ${lists.done} of ${lists.total} repos`
              : 'Comparing the code'}
          </p>
        </div>
      ) : null}

      {failed.length > 0 ? (
        <div className="notice notice--warn" role="note">
          <p>
            <strong>The code of {plural(failed.length, 'repo')} could not be read,</strong> so{' '}
            {failed.length === 1 ? 'it is' : 'they are'} not in this part.{' '}
            <button type="button" className="linkish" onClick={onRetry}>
              Try again
            </button>
          </p>
          <ul className="similarity__list">
            {failed.map(([repo, error]) => (
              <li key={repo}>
                <span>
                  {groups.get(repo) ? groupLabel(groups.get(repo) as RepoGroup) : ''}
                  <span className="mono"> {groups.get(repo)?.nameWithOwner ?? repo}</span>
                </span>
                <span className="similarity__dim">{error.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis && loaded && common ? (
        rows.length > 0 ? (
          <>
            <p className="similarity__summary">
              <strong>{plural(rows.length, 'pair')}</strong> of repos share code
              {strong > 0 ? `, ${strong} of them most of it or more` : ''}.
            </p>
            <div className="ledger similarity__table-wrap">
              <table className="ledger__table similarity__table">
                <thead>
                  <tr>
                    <th scope="col">A</th>
                    <th scope="col">B</th>
                    <th scope="col">Shared code</th>
                    <th scope="col" className="is-number">
                      Lines of A
                    </th>
                    <th scope="col" className="is-number">
                      Lines of B
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Files</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ pair, a, b }) => {
                    const key = `${pair.aKey}|${pair.bKey}`
                    const isOpen = open.has(key)
                    const aCode = loaded.repos.get(pair.aKey)
                    const bCode = loaded.repos.get(pair.bKey)
                    return (
                      <Fragment key={key}>
                        <CodeLine pair={pair} a={a} b={b} isOpen={isOpen} onToggle={() => toggle(key)} />
                        {isOpen && aCode && bCode ? (
                          <tr className="similarity__detail">
                            <td colSpan={6}>
                              <CodeFiles
                                a={a}
                                b={b}
                                aCode={aCode}
                                bCode={bCode}
                                aTree={trees.get(pair.aKey)}
                                bTree={trees.get(pair.bKey)}
                                common={common}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > shown.length ? (
              <p className="similarity__more">
                Showing the {shown.length} strongest of {rows.length.toLocaleString('en')} pairs.{' '}
                <button type="button" className="linkish" onClick={() => setShowAll(true)}>
                  Show all
                </button>
              </p>
            ) : null}
          </>
        ) : (
          <p className="empty">No two repos share more than a few lines of code.</p>
        )
      ) : null}
    </section>
  )
}

function CodeLine({
  pair,
  a,
  b,
  isOpen,
  onToggle,
}: {
  pair: CodePair
  a: RepoGroup
  b: RepoGroup
  isOpen: boolean
  onToggle: () => void
}) {
  const tone = codeTierTone(pair.tier)
  const onRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
    // The whole row is a shortcut; the links and the button inside it keep working.
    if ((event.target as HTMLElement).closest('a, button')) return
    if (window.getSelection()?.toString()) return
    onToggle()
  }
  return (
    <tr className={`entry entry--${tone} similarity__row${isOpen ? ' similarity__row--open' : ''}`} onClick={onRowClick}>
      <td className="similarity__side" data-label="A">
        <Side group={a} />
      </td>
      <td className="similarity__side" data-label="B">
        <Side group={b} />
      </td>
      <td className="similarity__match" data-label="Shared code">
        <span className={`stamp stamp--${tone}`}>
          <span className="stamp__label">{percent(pair.score)}</span>
          <span className="stamp__detail"> {codeTierLabel(pair.tier)}</span>
        </span>
      </td>
      <td className="is-number mono" data-label="Lines of A">
        {ofText(pair.aShared, pair.aOwn, pair.aShare)}
      </td>
      <td className="is-number mono" data-label="Lines of B">
        {ofText(pair.bShared, pair.bOwn, pair.bShare)}
      </td>
      <td className="similarity__toggle">
        <button type="button" className="linkish" aria-expanded={isOpen} onClick={onToggle}>
          {isOpen ? 'Hide code' : 'Show code'}
        </button>
      </td>
    </tr>
  )
}

/** A link to the shared lines of one file, or plain text when the compared commit is not known. */
function Lines({ tree, path, ranges }: { tree: RepoFiles | undefined; path: string; ranges: readonly LineRange[] }) {
  const text = isNotebook(path) ? 'in its cells' : `lines ${rangesText(ranges)}`
  if (!tree) return <>{text}</>
  return (
    <a href={fileUrl(tree.repo, tree.headOid, path, ranges)} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  )
}

function CodeFiles({
  a,
  b,
  aCode,
  bCode,
  aTree,
  bTree,
  common,
}: {
  a: RepoGroup
  b: RepoGroup
  aCode: LoadedCode
  bCode: LoadedCode
  aTree: RepoFiles | undefined
  bTree: RepoFiles | undefined
  common: ReadonlySet<number>
}) {
  const files = useMemo(() => codePairDetail(aCode.code, bCode.code, common), [aCode, bCode, common])
  const readText = (entry: LoadedCode) =>
    `${plural(entry.code.files.length, 'file')}${entry.unread > 0 ? `; ${entry.unread} could not be read` : ''}`

  return (
    <div className="similarity__files">
      <section className="similarity__paths similarity__paths--warn">
        <h4 className="similarity__paths-title">Files with shared code ({files.length})</h4>
        <p className="similarity__dim">
          Where the shared lines are in each file, and how many of its lines of code they are.
        </p>
        <ul className="similarity__paths-list">
          {files.slice(0, VISIBLE_FILES).map((file) => (
            <li key={file.aPath}>
              <span className="mono">{file.aPath === file.bPath ? file.aPath : `${file.aPath} ↔ ${file.bPath}`}</span>
              <span className="similarity__dim">
                A: <Lines tree={aTree} path={file.aPath} ranges={file.aRanges} /> ({file.aShared} of {file.aOwn})
                {' · '}B: <Lines tree={bTree} path={file.bPath} ranges={file.bRanges} /> ({file.bShared} of {file.bOwn})
              </span>
            </li>
          ))}
          {files.length > VISIBLE_FILES ? (
            <li className="similarity__dim">+{(files.length - VISIBLE_FILES).toLocaleString('en')} more, in the .xlsx</li>
          ) : null}
        </ul>
      </section>
      <section className="similarity__paths">
        <h4 className="similarity__paths-title">The rest</h4>
        <dl className="similarity__rest">
          <dt>Code read in A ({groupLabel(a, 1)})</dt>
          <dd>{readText(aCode)}</dd>
          <dt>Code read in B ({groupLabel(b, 1)})</dt>
          <dd>{readText(bCode)}</dd>
          <dt>Not read</dt>
          <dd>Prose, data and settings (README, .txt, .json, .yml), and files over {fileSize(MAX_TEXT_BYTES)}</dd>
        </dl>
      </section>
    </div>
  )
}
