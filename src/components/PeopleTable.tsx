import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { formatMark, markFor, NO_RULES, readBonus, type Rules } from '../logic/marking.ts'
import { latenessText, noteTexts, okMeta, repoLinkFor, STATUS_TONE } from '../logic/people.ts'
import { formatDateTime, formatDateTimeShort } from '../logic/time.ts'
import type { SheetKind, SheetRow } from '../sheet/columns.ts'
import { personHref, useApp } from '../state/hooks.ts'
import { bonusOf, setBonus, setSort, type PersonRow, type Sort, type SortColumn } from '../state/store.ts'
import { Stamp } from './Stamp.tsx'

type Column = { column: SortColumn; label: string; numeric?: boolean }

const LEADING: Column[] = [
  { column: 'row', label: 'Row', numeric: true },
  { column: 'id', label: 'ID' },
  { column: 'name', label: 'Name' },
  { column: 'repo', label: 'Repo' },
  { column: 'status', label: 'Status' },
  { column: 'lateBy', label: 'Late by' },
]
const TRAILING: Column[] = [
  { column: 'createdAt', label: 'Repo created' },
  { column: 'pushedAt', label: 'Last push' },
  { column: 'committedAt', label: 'Last commit' },
  { column: 'commits', label: 'Commits', numeric: true },
]

type Props = {
  people: PersonRow[]
  sort: Sort
  deadlinePassed: boolean
  kind?: SheetKind
  /** The rules table in force, which turns each status into a mark. */
  rules?: Rules
  /** A lab sheet's carried columns. */
  extraHeaders?: readonly string[]
}

function openPerson(event: MouseEvent<HTMLTableRowElement>, rowId: string): void {
  // The whole row is a shortcut; real links, buttons and boxes inside it keep working.
  if ((event.target as HTMLElement).closest('a, button, input')) return
  if (window.getSelection()?.toString()) return
  window.location.hash = personHref(rowId)
}

/** Moves the focus to the bonus box `step` rows down (or up) the table, for marking row after row. */
function moveBonusFocus(from: HTMLInputElement, step: number): void {
  const boxes = [...(from.closest('table')?.querySelectorAll<HTMLInputElement>('input.bonus') ?? [])]
  const next = boxes[boxes.indexOf(from) + step]
  if (next) {
    next.focus()
    next.select()
  }
}

/**
 * A student's bonus, in force as it is typed. A minus sign takes marks off.
 * Enter or the down arrow go to the next student, the up arrow to the one above.
 */
function BonusBox({ row }: { row: SheetRow }) {
  const stored = useApp((state) => bonusOf(row, state))
  // What is being typed; null shows the stored bonus.
  const [typed, setTyped] = useState<string | null>(null)
  const invalid = typed !== null && !readBonus(typed).ok

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveBonusFocus(event.currentTarget, event.key === 'ArrowUp' ? -1 : 1)
    }
  }

  return (
    <input
      className="bonus"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0"
      aria-label={`Bonus for ${row.name || row.id || `row ${row.rowNumber}`}`}
      aria-invalid={invalid ? true : undefined}
      title={invalid ? 'Type a number, such as 1, 0.5 or -1' : undefined}
      value={typed ?? (stored === null ? '' : formatMark(stored))}
      onChange={(event) => {
        const text = event.target.value
        setTyped(text)
        const reading = readBonus(text)
        if (reading.ok) setBonus(row, reading.value)
      }}
      onBlur={() => setTyped(null)}
      onKeyDown={onKeyDown}
    />
  )
}

function MarkCell({ person, rules }: { person: PersonRow; rules: Rules }) {
  const bonus = useApp((state) => bonusOf(person.row, state))
  const mark = markFor(person.verdict.status, rules, bonus ?? 0)
  return (
    <td className="entry__mark" data-label="Final mark">
      <span className="mark__final">{mark.final === null ? '—' : formatMark(mark.final)}</span>
      {mark.rule ? <span className="mark__rule">{mark.rule}</span> : null}
    </td>
  )
}

/** "Lab 1, Lab 2" in the term folder; "…" while they are read; blank without a folder. */
function tasksText(person: PersonRow): string {
  const tasks = person.lab?.tasks
  if (tasks === undefined) return person.lab?.folder ? '…' : ''
  if (tasks === null) return ''
  return tasks.length === 0 ? 'Empty folder' : tasks.join(', ')
}

function SortHeader({ column, label, numeric, sort }: Column & { sort: Sort }) {
  const active = sort.column === column
  return (
    <th
      scope="col"
      className={numeric ? 'is-number' : undefined}
      aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
    >
      <button type="button" className={`sort${active ? ' sort--active' : ''}`} onClick={() => setSort(column)}>
        {label}
        <span className="sort__arrow" aria-hidden="true">
          {active ? (sort.descending ? '▼' : '▲') : '↕'}
        </span>
      </button>
    </th>
  )
}

export function PeopleTable({ people, sort, deadlinePassed, kind = 'project', rules = NO_RULES, extraHeaders = [] }: Props) {
  const lab = kind === 'lab'
  const plain = (label: string, numeric = false) => (
    <th key={label} scope="col" className={`ledger__plain${numeric ? ' is-number' : ''}`}>
      {label}
    </th>
  )
  return (
    <div className="ledger">
      <table className="ledger__table">
        <thead>
          <tr>
            {LEADING.map((column) => (
              <SortHeader key={column.column} {...column} sort={sort} />
            ))}
            {/* The marks first, so they stay in view; a lab sheet's own columns after them. */}
            {plain('Bonus')}
            {plain('Final mark')}
            {lab ? [plain('Lab tasks'), ...extraHeaders.map((header) => plain(header))] : null}
            {TRAILING.map((column) => (
              <SortHeader key={column.column} {...column} sort={sort} />
            ))}
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
                <td className="entry__bonus" data-label="Bonus">
                  <BonusBox row={row} />
                </td>
                <MarkCell person={person} rules={rules} />
                {lab ? (
                  <>
                    <td className="entry__tasks" data-label="Lab tasks" title={person.lab?.folder ?? undefined}>
                      {tasksText(person)}
                    </td>
                    {extraHeaders.map((header, index) => (
                      <td key={`${index}-${header}`} className="entry__extra" data-label={header}>
                        {row.extra?.[index] ?? ''}
                      </td>
                    ))}
                  </>
                ) : null}
                <td className="mono" data-label="Repo created" title={formatDateTime(meta?.createdAt)}>
                  {formatDateTimeShort(meta?.createdAt)}
                </td>
                <td
                  className="mono"
                  data-label="Last push"
                  title={hasWork ? formatDateTime(meta.pushedAt) : undefined}
                >
                  {hasWork ? formatDateTimeShort(meta.pushedAt) : ''}
                </td>
                <td
                  className="mono"
                  data-label="Last commit"
                  title={formatDateTime(meta?.headCommittedAt)}
                >
                  {formatDateTimeShort(meta?.headCommittedAt)}
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
