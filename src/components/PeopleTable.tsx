import type { MouseEvent } from 'react'
import { latenessText, noteTexts, okMeta, repoLinkFor, STATUS_TONE } from '../logic/people.ts'
import { formatDateTime } from '../logic/time.ts'
import { personHref } from '../state/hooks.ts'
import { setSort, type PersonRow, type Sort, type SortColumn } from '../state/store.ts'
import { Stamp } from './Stamp.tsx'

const COLUMNS: Array<{ column: SortColumn; label: string; numeric?: boolean }> = [
  { column: 'row', label: 'Row', numeric: true },
  { column: 'id', label: 'ID' },
  { column: 'name', label: 'Name' },
  { column: 'repo', label: 'Repo' },
  { column: 'status', label: 'Status' },
  { column: 'lateBy', label: 'Late by' },
  { column: 'createdAt', label: 'Repo created' },
  { column: 'pushedAt', label: 'Last push' },
  { column: 'committedAt', label: 'Last commit' },
  { column: 'commits', label: 'Commits', numeric: true },
]

type Props = { people: PersonRow[]; sort: Sort; deadlinePassed: boolean }

function openPerson(event: MouseEvent<HTMLTableRowElement>, rowId: string): void {
  // The whole row is a shortcut; real links and buttons inside it keep working.
  if ((event.target as HTMLElement).closest('a, button')) return
  if (window.getSelection()?.toString()) return
  window.location.hash = personHref(rowId)
}

export function PeopleTable({ people, sort, deadlinePassed }: Props) {
  return (
    <div className="ledger">
      <table className="ledger__table">
        <thead>
          <tr>
            {COLUMNS.map(({ column, label, numeric }) => {
              const active = sort.column === column
              return (
                <th
                  key={column}
                  scope="col"
                  className={numeric ? 'is-number' : undefined}
                  aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                >
                  <button
                    type="button"
                    className={`sort${active ? ' sort--active' : ''}`}
                    onClick={() => setSort(column)}
                  >
                    {label}
                    <span className="sort__arrow" aria-hidden="true">
                      {active ? (sort.descending ? '▼' : '▲') : '↕'}
                    </span>
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {people.map((person) => {
            const { row, verdict } = person
            const meta = okMeta(person)
            const hasWork = meta !== null && !meta.isEmpty
            const link = repoLinkFor(person)
            const notes = noteTexts(person)
            return (
              <tr
                key={row.rowId}
                className={`entry entry--${STATUS_TONE[verdict.status]}`}
                onClick={(event) => openPerson(event, row.rowId)}
              >
                <td className="is-number entry__row" data-label="Row">
                  {row.rowNumber}
                </td>
                <td className="mono" data-label="ID">
                  {row.id || '—'}
                </td>
                <td className="entry__name" data-label="Name">
                  <a href={personHref(row.rowId)}>{row.name || '(no name)'}</a>
                </td>
                <td className="entry__repo" data-label="Repo">
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer">
                      {meta ? meta.nameWithOwner : row.link.ok ? row.link.key : ''}
                    </a>
                  ) : (
                    <span className="entry__raw">{row.rawLink || '—'}</span>
                  )}
                </td>
                <td className="entry__status" data-label="Status">
                  <Stamp key={verdict.status} status={verdict.status} deadlinePassed={deadlinePassed} />
                  {notes.length > 0 ? <span className="entry__notes">{notes.join(' · ')}</span> : null}
                </td>
                <td className="mono" data-label="Late by">
                  {latenessText(verdict) || (verdict.need && verdict.status === 'late' ? '…' : '')}
                </td>
                <td className="mono" data-label="Repo created">
                  {formatDateTime(meta?.createdAt)}
                </td>
                <td className="mono" data-label="Last push">
                  {hasWork ? formatDateTime(meta.pushedAt) : ''}
                </td>
                <td className="mono" data-label="Last commit">
                  {formatDateTime(meta?.headCommittedAt)}
                </td>
                <td className="is-number mono" data-label="Commits">
                  {hasWork ? meta.totalCommits : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
