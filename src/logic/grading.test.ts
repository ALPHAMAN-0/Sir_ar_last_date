import { describe, expect, it } from 'vitest'
import { applyDeductions, defaultGrading, type Grading, type PerformanceStatus } from './grading.ts'

describe('defaultGrading', () => {
  it('returns sensible defaults: no total, no deductions', () => {
    expect(defaultGrading()).toEqual({ totalMark: null, offForLate: 0, offForChanged: 0 })
  })
})

describe('applyDeductions', () => {
  const grading: Grading = { totalMark: 100, offForLate: 20, offForChanged: 10 }

  it('returns the original mark for an on-time row', () => {
    const result = applyDeductions(85, 'on_time', grading)
    expect(result.final).toBe(85)
    expect(result.lines).toEqual([])
  })

  it('returns the original mark for a "submitted" row (deadline not yet passed)', () => {
    const result = applyDeductions(85, 'submitted', grading)
    expect(result.final).toBe(85)
    expect(result.lines).toEqual([])
  })

  it('subtracts the late deduction for a late row and labels the line', () => {
    const result = applyDeductions(85, 'late', grading)
    expect(result.final).toBe(65)
    expect(result.lines).toEqual(['Late: −20'])
  })

  it('subtracts the changed-after deduction for a changed row and labels the line', () => {
    const result = applyDeductions(85, 'changed_after', grading)
    expect(result.final).toBe(75)
    expect(result.lines).toEqual(['Changed after deadline: −10'])
  })

  it('returns 0 for a no_submission row and explains why', () => {
    const result = applyDeductions(0, 'no_submission', grading)
    expect(result.final).toBe(0)
    expect(result.lines).toEqual(['No work: 0'])
  })

  it('returns 0 for a not_found row and explains why', () => {
    const result = applyDeductions(80, 'not_found', grading)
    expect(result.final).toBe(0)
    expect(result.lines).toEqual(['No work: 0'])
  })

  it('returns 0 for an invalid_link row and explains why', () => {
    const result = applyDeductions(80, 'invalid_link', grading)
    expect(result.final).toBe(0)
    expect(result.lines).toEqual(['No work: 0'])
  })

  it('returns 0 for a check_failed row and explains why', () => {
    const result = applyDeductions(80, 'check_failed', grading)
    expect(result.final).toBe(0)
    expect(result.lines).toEqual(['No work: 0'])
  })

  it('returns the mark unchanged for a "not_applicable" row (no link in the sheet)', () => {
    const result = applyDeductions(80, 'not_applicable', grading)
    expect(result.final).toBe(80)
    expect(result.lines).toEqual([])
  })

  it('returns the mark unchanged for a "checking" row (still being decided)', () => {
    const result = applyDeductions(80, 'checking', grading)
    expect(result.final).toBe(80)
    expect(result.lines).toEqual([])
  })

  it('clamps the final mark at 0 when deduction is larger than the mark', () => {
    const result = applyDeductions(15, 'late', grading)
    expect(result.final).toBe(0)
    expect(result.lines).toEqual(['Late: −20'])
  })

  it('clamps the final mark at the total mark when the original is above it', () => {
    const result = applyDeductions(150, 'on_time', grading)
    expect(result.final).toBe(100)
  })

  it('does not clamp at the top when totalMark is null', () => {
    const noTotal: Grading = { totalMark: null, offForLate: 0, offForChanged: 0 }
    const result = applyDeductions(150, 'on_time', noTotal)
    expect(result.final).toBe(150)
  })

  it('still applies deductions when totalMark is null (just no upper clamp)', () => {
    const noTotal: Grading = { totalMark: null, offForLate: 20, offForChanged: 0 }
    const result = applyDeductions(50, 'late', noTotal)
    expect(result.final).toBe(30)
  })

  it('handles 0 deductions as a no-op', () => {
    const zero: Grading = { totalMark: 100, offForLate: 0, offForChanged: 0 }
    expect(applyDeductions(80, 'late', zero).final).toBe(80)
    expect(applyDeductions(80, 'changed_after', zero).final).toBe(80)
  })

  it('handles a non-numeric mark by returning it as-is with no lines', () => {
    const result = applyDeductions(NaN, 'on_time', grading)
    expect(result.final).toBe(NaN)
    expect(result.lines).toEqual([])
  })

  it('handles a null mark by returning null with no lines', () => {
    const result = applyDeductions(null, 'on_time', grading)
    expect(result.final).toBe(null)
    expect(result.lines).toEqual([])
  })
})

describe('PerformanceStatus', () => {
  it('is a closed union of the verdict statuses plus "not_applicable"', () => {
    // Sanity: the type compiles. This is a documentation test, not a runtime check.
    const statuses: PerformanceStatus[] = [
      'on_time',
      'submitted',
      'changed_after',
      'late',
      'no_submission',
      'not_found',
      'invalid_link',
      'check_failed',
      'checking',
      'not_applicable',
    ]
    expect(statuses).toHaveLength(10)
  })
})
