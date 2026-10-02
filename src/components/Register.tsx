import { useMemo, useRef, useState } from 'react'
import {
  countByStatus,
  filterPeople,
  sortPeople,
  STATUS_ORDER,
  STATUS_TONE,
  statusLabel,
  toExportRows,
} from '../logic/people.ts'
import { formatDateTime, formatTime, zoneLabel } from '../logic/time.ts'
import { useApp, useNow, usePeople } from '../state/hooks.ts'
import { clearSheet, loadFile, refresh, setSearch, setStatusFilter } from '../state/store.ts'
import { ColumnPicker } from './ColumnPicker.tsx'
import { DeadlineBox } from './DeadlineBox.tsx'
import { PeopleTable } from './PeopleTable.tsx'

const PAUSE_TEXT = {
  rate_limited: 'Too many requests at once. Checking continues by itself at',
  github_throttled: 'GitHub asked the app to slow down. Checking continues by itself at',
  quota_reserved:
    'The GitHub limit shared by everyone using this page is used up for this hour. Press Refresh after',
} as const

export function Register() {
  const sheet = useApp((state) => state.sheet)
  const sort = useApp((state) => state.sort)
  const statusFilter = useApp((state) => state.statusFilter)
  const search = useApp((state) => state.search)
  const deadline = useApp((state) => state.deadline)
  const loadingRepos = useApp((state) => state.loadingRepos)
  const checkedAt = useApp((state) => state.checkedAt)
  const pause = useApp((state) => state.pause)
  const quota = useApp((state) => state.quota)
  const canPickColumns = useApp((state) => state.columns !== null)
  const people = usePeople()
  const now = useNow()
  const replaceInput = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const deadlinePassed = deadline !== null && now > deadline
  const counts = useMemo(() => countByStatus(people), [people])
  const shown = useMemo(
    () => sortPeople(filterPeople(people, statusFilter, search), sort),
    [people, statusFilter, search, sort],
  )
  const repoCount = useMemo(() => {
    const keys = new Set<string>()
    for (const person of people) if (person.row.link.ok) keys.add(person.row.link.key)
    return keys.size
  }, [people])
  if (!sheet) return null

  const noLinks = repoCount === 0
  const filtered = shown.length !== people.length
  const checking = loadingRepos > 0 || (counts.get('checking') ?? 0) > 0

  const download = async () => {
    const stamp = Date.now()
    // The Excel library is fetched on first use.
    const excel = await import('../sheet/exportXlsx.ts')
    excel.downloadWorkbook(
      excel.buildWorkbook(toExportRows(shown, deadlinePassed), {
        sheetName: sheet.fileName,
        deadline,
        checkedAt: checkedAt ?? stamp,
        zone: zoneLabel(),
      }),
      excel.exportFileName(stamp),
    )
  }

  return (
    <section className="register">
      <div className="sheetbar">
        <div className="sheetbar__file">
          <span className="sheetbar__label">Sheet</span>
          <strong className="sheetbar__name">{sheet.fileName}</strong>
          <span className="sheetbar__count">
            {people.length} {people.length === 1 ? 'person' : 'people'}
          </span>
        </div>
        <div className="sheetbar__actions">
          <button
            type="button"
            className="button button--quiet"
            onClick={() => replaceInput.current?.click()}
          >
            Replace sheet
          </button>
          {canPickColumns ? (
            <button type="button" className="button button--quiet" onClick={() => setPicking(true)}>
              Columns
            </button>
          ) : null}
          {confirmingClear ? (
            <span className="confirm" role="alert">
              Remove this sheet from this browser?
              <button type="button" className="button button--danger" onClick={clearSheet}>
                Yes, remove
              </button>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setConfirmingClear(false)}
              >
                Keep it
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="button button--quiet button--danger"
              onClick={() => setConfirmingClear(true)}
            >
              Clear
            </button>
          )}
          <input
            ref={replaceInput}
            className="visually-hidden"
            type="file"
            accept=".xlsx,.xls,.csv"
            aria-label="Choose another Excel or CSV file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void loadFile(file)
              event.target.value = ''
            }}
          />
        </div>
      </div>

      {picking || (noLinks && canPickColumns) ? (
        <>
          {noLinks ? (
            <p className="notice notice--warn">
              No GitHub repo links were found in this sheet. Choose the column that holds them.
            </p>
          ) : null}
          <ColumnPicker onDone={() => setPicking(false)} />
        </>
      ) : null}
      {sheet.truncated ? (
        <p className="notice notice--warn">
          This sheet has more than 1,000 people. Only the first 1,000 are shown.
        </p>
      ) : null}

      <DeadlineBox />

      {pause ? (
        <p className="notice notice--bad" role="status">
          {PAUSE_TEXT[pause.reason]} {formatTime(pause.until)}.
        </p>
      ) : null}

      <div className="tally" role="group" aria-label="Filter by status">
        <button
          type="button"
          className={`chip${statusFilter === 'all' ? ' chip--on' : ''}`}
          aria-pressed={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        >
          <span className="chip__count">{people.length}</span> Everyone
        </button>
        {STATUS_ORDER.filter((status) => counts.has(status)).map((status) => (
          <button
            key={status}
            type="button"
            className={`chip chip--${STATUS_TONE[status]}${statusFilter === status ? ' chip--on' : ''}`}
            aria-pressed={statusFilter === status}
            onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
          >
            <span className="chip__count">{counts.get(status)}</span>{' '}
            {statusLabel(status, deadlinePassed)}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <label className="search">
          <span className="visually-hidden">Search by ID, name or repo</span>
          <input
            type="search"
            placeholder="Search ID, name or repo"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <p className="toolbar__checked" aria-live="polite">
          {checking
            ? loadingRepos > 0
              ? `Checking ${repoCount - loadingRepos} of ${repoCount} repos`
              : 'Checking push times'
            : checkedAt
              ? `Checked ${formatDateTime(checkedAt)}`
              : ''}
        </p>
        <button type="button" className="button" onClick={refresh} disabled={loadingRepos > 0}>
          Refresh
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void download()}
          disabled={shown.length === 0}
        >
          {filtered ? `Download ${shown.length} rows` : 'Download .xlsx'}
        </button>
      </div>
      {loadingRepos > 0 ? (
        <progress className="progress" max={repoCount} value={repoCount - loadingRepos} />
      ) : null}

      {shown.length > 0 ? (
        <PeopleTable people={shown} sort={sort} deadlinePassed={deadlinePassed} />
      ) : (
        <p className="empty">
          Nobody matches this filter.{' '}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setStatusFilter('all')
              setSearch('')
            }}
          >
            Show everyone
          </button>
        </p>
      )}

      {quota?.core && quota.graphql ? (
        <p className="quota">
          GitHub requests left this hour, shared by everyone using this page:{' '}
          <span className="mono">{Math.min(quota.core.remaining, quota.graphql.remaining).toLocaleString('en')}</span>{' '}
          of <span className="mono">{quota.core.limit.toLocaleString('en')}</span>. The app stops at{' '}
          <span className="mono">{quota.reserve}</span>.
        </p>
      ) : null}
    </section>
  )
}
