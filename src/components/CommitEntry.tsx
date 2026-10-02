import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommitInfo } from '../../shared/api.ts'
import { ApiError } from '../api/client.ts'
import { repoUrl } from '../logic/people.ts'
import { arrivedLate, type PushInfo } from '../logic/pushAttribution.ts'
import { formatDateTime, formatTime } from '../logic/time.ts'
import { loadFiles, type FilePage } from '../state/person.ts'

/** A commit made long before it was pushed is worth pointing out. */
const NOTABLE_GAP_MS = 10 * 60_000

const KIND: Record<string, { letter: string; word: string; tone: string }> = {
  added: { letter: 'A', word: 'Added', tone: 'add' },
  modified: { letter: 'M', word: 'Changed', tone: 'mod' },
  changed: { letter: 'M', word: 'Changed', tone: 'mod' },
  removed: { letter: 'D', word: 'Deleted', tone: 'del' },
  renamed: { letter: 'R', word: 'Renamed', tone: 'ren' },
  copied: { letter: 'C', word: 'Copied', tone: 'ren' },
}
const OTHER_KIND = { letter: '·', word: 'Touched', tone: 'mod' }

type FilesState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  pages: FilePage[]
  message?: string
}

type Props = {
  repo: string
  commit: CommitInfo
  push: PushInfo | undefined
  deadline: number | null
  /** Load the file list as soon as the commit is scrolled into view. */
  autoFiles: boolean
}

export function CommitEntry({ repo, commit, push, deadline, autoFiles }: Props) {
  const holder = useRef<HTMLLIElement>(null)
  const [files, setFiles] = useState<FilesState>({ status: 'idle', pages: [] })
  const commitLink = `${repoUrl(repo)}/commit/${commit.oid}`

  const load = useCallback(
    (page: number) => {
      setFiles((previous) => ({ ...previous, status: 'loading' }))
      loadFiles(repo, commit.oid, page).then(
        (result) => setFiles((previous) => ({ status: 'ready', pages: [...previous.pages, result] })),
        (error: unknown) =>
          setFiles((previous) => ({
            ...previous,
            status: 'error',
            message: error instanceof ApiError ? error.message : 'The files could not be loaded.',
          })),
      )
    },
    [repo, commit.oid],
  )

  // Each file list costs one GitHub request, so wait until the commit has
  // actually stayed on screen for a moment.
  useEffect(() => {
    const node = holder.current
    if (!autoFiles || files.status !== 'idle' || !node) return
    let timer = 0
    const observer = new IntersectionObserver(
      (entries) => {
        window.clearTimeout(timer)
        if (entries.some((entry) => entry.isIntersecting)) {
          timer = window.setTimeout(() => load(1), 300)
        }
      },
      { rootMargin: '120px 0px' },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [autoFiles, files.status, load])

  const late = arrivedLate(push, deadline)
  const pushedAt = push?.pushedAt ?? null
  const gap = pushedAt ? Date.parse(pushedAt) - Date.parse(commit.committedAt) : 0
  const datedInTime = deadline !== null && Date.parse(commit.committedAt) <= deadline
  const lastPage = files.pages.at(-1)
  const stats = files.pages[0]?.stats ?? null
  const shown = files.pages.flatMap((page) => page.files)

  return (
    <li ref={holder} className={`commit${late ? ' commit--late' : ''}`}>
      <time className="commit__time mono" dateTime={commit.committedAt}>
        {formatTime(commit.committedAt)}
      </time>
      <div className="commit__body">
        <p className="commit__title">
          <a href={commitLink} target="_blank" rel="noopener noreferrer">
            {commit.headline || '(no message)'}
          </a>
          {late ? <span className="tag tag--bad">After deadline</span> : null}
          {commit.parents.length > 1 ? <span className="tag">Merge</span> : null}
        </p>
        <p className="commit__meta">
          {commit.authorLogin ?? commit.authorName ?? 'Unknown author'}
          <span className="mono"> · {commit.oid.slice(0, 7)}</span>
          {stats ? (
            <span className="mono">
              {' · '}
              <span className="plus">+{stats.additions}</span>{' '}
              <span className="minus">−{stats.deletions}</span>
            </span>
          ) : null}
        </p>
        {pushedAt && (late || gap > NOTABLE_GAP_MS) ? (
          <p className={`commit__push${late && datedInTime ? ' commit__push--alert' : ''}`}>
            {late && datedInTime
              ? `The commit is dated before the deadline, but GitHub received it on ${formatDateTime(pushedAt)}.`
              : `Reached GitHub on ${formatDateTime(pushedAt)}.`}
          </p>
        ) : null}

        {files.status === 'idle' && !autoFiles ? (
          <button type="button" className="linkish" onClick={() => load(1)}>
            Show files
          </button>
        ) : null}
        {files.status === 'idle' && autoFiles ? <p className="commit__wait" aria-hidden="true" /> : null}

        {shown.length > 0 ? (
          <ul className="files">
            {shown.map((file) => {
              const kind = KIND[file.status] ?? OTHER_KIND
              return (
                <li key={file.path} className="file">
                  <span className={`kind kind--${kind.tone}`} title={kind.word}>
                    <span aria-hidden="true">{kind.letter}</span>
                    <span className="visually-hidden">{kind.word}</span>
                  </span>
                  <a
                    className="file__path mono"
                    href={`${commitLink}#${file.anchor}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                  </a>
                  <span className="file__delta mono">
                    <span className="plus">+{file.additions}</span>{' '}
                    <span className="minus">−{file.deletions}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : null}

        {files.status === 'loading' ? <p className="commit__note">Loading files</p> : null}
        {files.status === 'ready' && lastPage?.tooLarge ? (
          <p className="commit__note">
            This commit is too large to list here.{' '}
            <a href={commitLink} target="_blank" rel="noopener noreferrer">
              Open it on GitHub ↗
            </a>
          </p>
        ) : null}
        {files.status === 'ready' && shown.length === 0 && !lastPage?.tooLarge ? (
          <p className="commit__note">No file changes in this commit.</p>
        ) : null}
        {files.status === 'ready' && lastPage?.more && !lastPage.tooLarge ? (
          <button type="button" className="linkish" onClick={() => load(files.pages.length + 1)}>
            Show more files
          </button>
        ) : null}
        {files.status === 'error' ? (
          <p className="commit__note commit__note--bad">
            {files.message}{' '}
            <button type="button" className="linkish" onClick={() => load(files.pages.length + 1)}>
              Try again
            </button>
          </p>
        ) : null}
      </div>
    </li>
  )
}
