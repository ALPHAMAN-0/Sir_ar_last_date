import type { PerformanceRow } from '../sheet/performanceRows.ts'
import type { DeductionResult, PerformanceStatus } from '../logic/grading.ts'

/** What each row of the performance register shows, after the verdict and the deduction. */
export type PerformanceTableRow = {
  row: PerformanceRow
  /** The status of the row, after the verdict. `not_applicable` for sheets without a link column. */
  status: PerformanceStatus
  /** The deduction result, with the final mark and the explanation lines. */
  deduction: DeductionResult
}

type Props = {
  rows: readonly PerformanceTableRow[]
  /** Labels for the mark columns, in the same order as `row.marks`. */
  headers: readonly string[]
}

const formatMark = (value: number | null): string => {
  if (value === null) return ''
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
}

const statusLabel = (status: PerformanceStatus): string => {
  switch (status) {
    case 'on_time':
      return 'On time'
    case 'submitted':
      return 'Submitted'
    case 'changed_after':
      return 'Changed after deadline'
    case 'late':
      return 'Late'
    case 'no_submission':
      return 'No submission'
    case 'not_found':
      return 'Not found'
    case 'invalid_link':
      return 'Invalid link'
    case 'check_failed':
      return 'Check failed'
    case 'checking':
      return 'Checking'
    case 'not_applicable':
      return 'Not graded'
  }
}

const statusTone = (status: PerformanceStatus): string => {
  switch (status) {
    case 'on_time':
    case 'submitted':
      return 'good'
    case 'changed_after':
      return 'warn'
    case 'late':
    case 'no_submission':
      return 'bad'
    case 'not_found':
    case 'invalid_link':
    case 'check_failed':
    case 'checking':
      return 'muted'
    case 'not_applicable':
      return 'info'
  }
}

const totalMarkFromRow = (row: PerformanceTableRow): number | null => {
  // The "total" is the sum of the numeric mark columns. Non-numeric values are skipped.
  let sum = 0
  let any = false
  for (const mark of row.row.marks) {
    if (mark.value !== null) {
      sum += mark.value
      any = true
    }
  }
  return any ? sum : null
}

/**
 * The performance register's table: one row per student, with the original
 * mark columns, the final mark after deduction, and a short note explaining
 * what was deducted. Pure presentational — sorting, filtering, and search
 * happen above this component.
 */
export function PerformanceTable({ rows, headers }: Props) {
  if (rows.length === 0) return null
  return (
    <div className="people-wrap" role="region" aria-label="Performance register">
      <table className="people perf-table">
        <thead>
          <tr>
            <th scope="col" className="people__row">Row</th>
            <th scope="col">ID</th>
            <th scope="col">Name</th>
            {headers.map((header) => (
              <th key={header} scope="col" className="perf-table__mark">
                {header}
              </th>
            ))}
            <th scope="col" className="perf-table__total">Total</th>
            <th scope="col">Status</th>
            <th scope="col" className="perf-table__final">Final mark</th>
            <th scope="col">Deduction</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row, status, deduction }) => (
            <tr key={row.rowId} className={`people__row--${statusTone(status)}`}>
              <td className="people__row">{row.rowNumber}</td>
              <td>{row.id}</td>
              <td>{row.name}</td>
              {row.marks.map((mark) => (
                <td key={mark.column} className="perf-table__mark mono">
                  {formatMark(mark.value)}
                </td>
              ))}
              <td className="perf-table__total mono">{formatMark(totalMarkFromRow({ row, status, deduction }))}</td>
              <td>{statusLabel(status)}</td>
              <td className="perf-table__final mono">{formatMark(deduction.final)}</td>
              <td>{deduction.lines.join('; ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}