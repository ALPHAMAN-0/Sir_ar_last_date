import { useMemo, useState } from 'react'
import { applyDeductions, type PerformanceStatus } from '../logic/grading.ts'
import { buildPerformanceRows, type PerformanceRow } from '../sheet/performanceRows.ts'
import { useApp, usePeople } from '../state/hooks.ts'
import {
  clearSheet,
  getState,
  loadFile,
  refresh,
  setSearch,
  setStatusFilter,
  type PersonRow,
} from '../state/store.ts'
import { PerformanceTable, type PerformanceTableRow } from './PerformanceTable.tsx'
import { GradingBox } from './GradingBox.tsx'
import { KindBadge } from './KindBadge.tsx'
import { PauseNotice } from './PauseNotice.tsx'

/** Decides the status of a performance row. `not_applicable` when the sheet has no link column. */
function statusForRow(person: PersonRow | undefined, hasLinks: boolean): PerformanceStatus {
  if (!hasLinks) return 'not_applicable'
  if (!person) return 'checking'
  return person.verdict.status
}

/** The performance register screen. */
export function PerformanceRegister() {
  const sheet = useApp((state) => state.sheet)
  const columns = useApp((state) => state.columns)
  const deadline = useApp((state) => state.deadline)
  const grading = useApp((state) => state.grading)
  const loadingRepos = useApp((state) => state.loadingRepos)
  const checkedAt = useApp((state) => state.checkedAt)
  const search = useApp((state) => state.search)
  const statusFilter = useApp((state) => state.statusFilter)
  const people = usePeople()
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [downloadFailed, setDownloadFailed] = useState(false)

  const peopleByRowId = useMemo(() => {
    const map = new Map<string, PersonRow>()
    for (const person of people) map.set(person.row.rowId, person)
    return map
  }, [people])

  // When the sheet is performance, we re-derive rows from the saved `columns` mapping
  // each time grading or the sheet changes, so the deductions stay in sync.
  const performanceRows: PerformanceRow[] = useMemo(() => {
    if (!columns || sheet?.kind !== 'performance') return []
    return buildPerformanceRows(columns.data, columns.mapping)
  }, [columns, sheet?.kind])

  const hasLinks = useMemo(() => {
    if (!columns) return false
    return columns.mapping.link !== null
  }, [columns])

  const markHeaders = useMemo(() => {
    const first = performanceRows[0]
    if (!first) return []
    return first.marks.map((m) => m.header)
  }, [performanceRows])

  // Stable lookup of `PersonRow` by link key, for status lookup.
  const personByKey = useMemo(() => {
    const map = new Map<string, PersonRow>()
    for (const person of people) {
      if (person.row.link.ok) map.set(person.row.link.key, person)
    }
    return map
  }, [people])

  const tableRows: PerformanceTableRow[] = useMemo(() => {
    return performanceRows.map((row) => {
      const person = row.id ? peopleByRowId.get(row.rowId) ?? undefined : undefined
      const key = person?.row.link.ok ? person.row.link.key : null
      const matched = key ? personByKey.get(key) : undefined
      const status = statusForRow(matched, hasLinks)
      const total = row.marks.reduce<number | null>((sum, mark) => {
        if (mark.value === null) return sum
        if (sum === null) return mark.value
        return sum + mark.value
      }, null)
      const deduction = applyDeductions(total, status, grading)
      return { row, status, deduction }
    })
  }, [performanceRows, peopleByRowId, personByKey, hasLinks, grading])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return tableRows.filter(({ row, status }) => {
      if (statusFilter !== 'all' && status !== statusFilter) return false
      if (!needle) return true
      return [row.id, row.name, ...row.marks.map((m) => m.raw)].some((text) =>
        (text ?? '').toLowerCase().includes(needle),
      )
    })
  }, [tableRows, statusFilter, search])

  if (!sheet) return null
  if (sheet.kind !== 'performance') return null

  const checking = loadingRepos > 0

  const download = async () => {
    const stamp = Date.now()
    setDownloadFailed(false)
    try {
      const excel = await import('../sheet/performanceExport.ts')
      const { buildPerformanceWorkbook, downloadWorkbook, exportFileName } = excel
      const rowsForFile = filtered.map(({ row, status, deduction }) => ({
        rowNumber: row.rowNumber,
        id: row.id,
        name: row.name,
        marks: row.marks.map((m) => ({ header: m.header, raw: m.raw, value: m.value })),
        status,
        finalMark: deduction.final,
        deductionLines: deduction.lines,
      }))
      const workbook = buildPerformanceWorkbook(rowsForFile, {
        sheetName: sheet.fileName,
        deadline,
        checkedAt: getState().checkedAt ?? stamp,
        grading,
      })
      downloadWorkbook(workbook, exportFileName(stamp))
    } catch (error) {
      console.error('The performance report could not be written:', error)
      setDownloadFailed(true)
    }
  }

  // Refresh reuses the project-base path; for a performance sheet with no link column
  // there is nothing to fetch, so the button is informational.
  const onRefresh = () => {
    if (hasLinks) refresh()
  }

  return (
    <section className="register">
      <div className="sheetbar">
        <div className="sheetbar__file">
          <span className="sheetbar__label">Sheet</span>
          <strong className="sheetbar__name">{sheet.fileName}</strong>
          <span className="sheetbar__count">
            {performanceRows.length} {performanceRows.length === 1 ? 'person' : 'people'}
          </span>
          <KindBadge />
        </div>
        <div className="sheetbar__actions">
          <button
            type="button"
            className="button button--quiet"
            onClick={() => document.getElementById('perf-replace')?.click()}
          >
            Replace sheet
          </button>
          {confirmingClear ? (
            <span className="confirm" role="alert">
              Remove this sheet from this browser?
              <button type="button" className="button button--danger" onClick={clearSheet}>
                Yes, remove
              </button>
              <button type="button" className="button button--quiet" onClick={() => setConfirmingClear(false)}>
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
            id="perf-replace"
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

      <p className="deadline__hint">
        A <strong>performance base</strong> sheet is a class gradebook. Set the rules below;
        the final mark and the deduction are written into the downloaded file.
      </p>

      <GradingBox />

      <PauseNotice />

      {hasLinks ? (
        <p className="notice notice--info">
          This sheet also has a repo link column. The status column will use the same
          rules as the project register, and deductions will apply.
        </p>
      ) : (
        <p className="notice notice--info">
          This sheet has no GitHub link column, so every row's status is "Not graded".
          Deductions are not applied; the final mark is the original mark.
        </p>
      )}

      <div className="toolbar">
        <label className="search">
          <span className="visually-hidden">Search by ID or name</span>
          <input
            type="search"
            placeholder="Search ID or name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <p className="toolbar__checked" aria-live="polite">
          {checking
            ? `Checking ${performanceRows.length} repos`
            : checkedAt
              ? `Checked ${new Date(checkedAt).toLocaleString()}`
              : ''}
        </p>
        <button
          type="button"
          className="button"
          onClick={onRefresh}
          disabled={!hasLinks || loadingRepos > 0}
          title={hasLinks ? 'Re-check the GitHub repos' : 'No link column to check'}
        >
          Refresh
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void download()}
          disabled={filtered.length === 0}
        >
          Download .xlsx
        </button>
      </div>
      {downloadFailed ? (
        <p className="notice notice--bad" role="alert">
          The performance file could not be written. Please try again.
        </p>
      ) : null}

      {filtered.length > 0 ? (
        <PerformanceTable rows={filtered} headers={markHeaders} />
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
    </section>
  )
}