// The rules that turn a row's status and the teacher's grading controls into
// a final mark, with a short explanation of what was deducted. Pure functions:
// the same inputs always give the same outputs, no time, no DOM, no state.

import type { Status } from './verdict.ts'

/**
 * The performance view's grading controls. The teacher enters them on the
 * Grading box, exactly like the deadline.
 *
 * `totalMark` is the upper bound for the final mark, also shown on the
 * Info sheet of the download. `null` means "no upper bound"; the teacher's
 * sheet may carry marks above it, in which case the cell is the original mark.
 *
 * `offForLate` and `offForChanged` are deducted once each, based on the
 * verdict status of the row. They default to 0, which makes the function a
 * no-op.
 */
export type Grading = {
  totalMark: number | null
  offForLate: number
  offForChanged: number
}

export const defaultGrading = (): Grading => ({ totalMark: null, offForLate: 0, offForChanged: 0 })

/**
 * The status of a row in a performance-base sheet. Same as the verdict
 * statuses, plus `not_applicable` for rows the detector could not link to a
 * GitHub repo (no link column at all).
 */
export type PerformanceStatus = Status | 'not_applicable'

export type DeductionResult = {
  final: number | null
  /** Each entry explains one deduction, e.g. "Late: −20". Empty for no-op. */
  lines: string[]
}

const NO_WORK: ReadonlySet<Status> = new Set(['no_submission', 'not_found', 'invalid_link', 'check_failed'])

const formatNumber = (value: number): string => {
  // No trailing ".0" on whole numbers — keeps the file clean.
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/**
 * Returns the final mark after applying the grading rules, with a one-line
 * explanation per deduction. `null` and `NaN` pass through unchanged (a row
 * with a non-numeric mark is shown as-is, never coerced to 0).
 *
 * Clamping rules:
 *   - the lower bound is 0 (a deduction cannot take a mark below zero)
 *   - the upper bound is `totalMark` when set; otherwise the original mark
 *     is used as-is, so a sheet with marks above the total still downloads
 *     without surprise
 */
export function applyDeductions(
  mark: number | null,
  status: PerformanceStatus,
  grading: Grading,
): DeductionResult {
  if (mark === null || Number.isNaN(mark)) {
    return { final: mark, lines: [] }
  }
  const { totalMark, offForLate, offForChanged } = grading
  let working = mark
  const lines: string[] = []
  switch (status) {
    case 'late':
      working -= offForLate
      if (offForLate !== 0) lines.push(`Late: −${formatNumber(offForLate)}`)
      break
    case 'changed_after':
      working -= offForChanged
      if (offForChanged !== 0) lines.push(`Changed after deadline: −${formatNumber(offForChanged)}`)
      break
    case 'no_submission':
    case 'not_found':
    case 'invalid_link':
    case 'check_failed':
      working = 0
      lines.push('No work: 0')
      break
    case 'on_time':
    case 'submitted':
    case 'checking':
    case 'not_applicable':
      break
  }
  if (working < 0) working = 0
  if (totalMark !== null && working > totalMark) working = totalMark
  return { final: working, lines }
}

/** True when the status should be treated as a late-ish deduction (helper for tests). */
export function isNoWork(status: PerformanceStatus): boolean {
  return status !== 'not_applicable' && NO_WORK.has(status)
}