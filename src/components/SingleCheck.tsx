// A small panel for inspecting one repo outside the sheet. The teacher pastes
// a GitHub link, the orchestrator (`../singleCheck/run.ts`) hits the Worker
// for the repo's facts, and the result is shown as a definition list with the
// files changed in the head commit on the default branch.

import { useState, type FormEvent } from 'react'
import { repoUrl } from '../logic/people.ts'
import { formatDateTime } from '../logic/time.ts'
import { runSingleCheck } from '../singleCheck/run.ts'
import type { SingleCheckOutcome, SingleCheckResult } from '../singleCheck/types.ts'

type View =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; result: SingleCheckResult }
  | { kind: 'error'; message: string }

const MAX_FILES = 30

const labels = {
  name: 'Name',
  created: 'Created',
  lastPush: 'Last push',
  firstPush: 'First push',
  defaultBranch: 'Default branch',
  filesChanged: 'Files changed',
} as const

/** Renders the result of a successful check. Pure, easy to test in isolation. */
export function SingleCheckResultView({ result }: { result: SingleCheckResult }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? result.files : result.files.slice(0, MAX_FILES)
  const hidden = result.files.length - visible.length

  return (
    <dl className="single-check__grid" aria-label="Repo facts">
      <dt>{labels.name}</dt>
      <dd>
        <a
          className="mono"
          href={repoUrl(result.key)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {result.nameWithOwner}
        </a>
      </dd>

      <dt>{labels.created}</dt>
      <dd>{formatDateTime(result.createdAt)}</dd>

      <dt>{labels.lastPush}</dt>
      <dd>{result.pushedAt ? formatDateTime(result.pushedAt) : 'No push yet'}</dd>

      <dt>{labels.firstPush}</dt>
      <dd>{result.firstPushAt ? formatDateTime(result.firstPushAt) : 'No push recorded'}</dd>

      <dt>{labels.defaultBranch}</dt>
      <dd className="mono">{result.defaultBranch}</dd>

      <dt>{labels.filesChanged}</dt>
      <dd>
        {result.files.length === 0 ? (
          <span className="single-check__muted">No files in the head commit.</span>
        ) : (
          <>
            <ul className="single-check__files">
              {visible.map((file) => (
                <li key={file.path}>
                  <span className="mono">{file.path}</span>
                  <span className="single-check__diff">
                    {' '}
                    +{file.additions} −{file.deletions}
                  </span>
                </li>
              ))}
            </ul>
            {hidden > 0 ? (
              <p className="single-check__more">
                {hidden} more file{hidden === 1 ? '' : 's'} hidden.{' '}
                <button type="button" className="button button--quiet" onClick={() => setShowAll(true)}>
                  Show all
                </button>
              </p>
            ) : null}
            {result.filesTruncated ? (
              <p className="notice notice--warn">
                The commit has more files than this view can show.
              </p>
            ) : null}
            {result.filesTooLarge ? (
              <p className="notice notice--warn">
                The commit is too large to list here; open it on GitHub instead.
              </p>
            ) : null}
          </>
        )}
      </dd>
    </dl>
  )
}

function describe(outcome: SingleCheckOutcome): string {
  if ('kind' in outcome) {
    if (outcome.kind === 'bad_link') return outcome.reason
    if (outcome.kind === 'not_found') return 'No such repo, or it is private.'
    if (outcome.kind === 'repo_error') return `GitHub could not be read for this repo (${outcome.code}).`
    return 'No connection to the server.'
  }
  return ''
}

export function SingleCheck() {
  const [link, setLink] = useState('')
  const [view, setView] = useState<View>({ kind: 'idle' })

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (link.trim() === '') return
    setView({ kind: 'loading' })
    const outcome = await runSingleCheck(link)
    if ('kind' in outcome) {
      setView({ kind: 'error', message: describe(outcome) })
    } else {
      setView({ kind: 'done', result: outcome })
    }
  }

  return (
    <details className="single-check" open>
      <summary className="single-check__summary">Single check</summary>
      <p className="single-check__lede">
        Paste a GitHub repo link to inspect one repo on its own — name, when it was created, when it
        was last pushed, when it was first pushed on the default branch, and which files changed in
        the head commit.
      </p>

      <form
        className="single-check__form"
        onSubmit={(event) => {
          void onSubmit(event)
        }}
      >
        <label className="single-check__label" htmlFor="single-check-input">
          Repo link
        </label>
        <input
          id="single-check-input"
          className="single-check__input"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://github.com/owner/name"
          value={link}
          onChange={(event) => setLink(event.target.value)}
        />
        <button type="submit" className="button button--primary" disabled={view.kind === 'loading'}>
          {view.kind === 'loading' ? 'Checking…' : 'Check'}
        </button>
      </form>

      {view.kind === 'error' ? (
        <p className="notice notice--bad" role="alert">
          {view.message}
        </p>
      ) : null}

      {view.kind === 'done' ? <SingleCheckResultView result={view.result} /> : null}
    </details>
  )
}