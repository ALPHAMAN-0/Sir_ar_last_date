// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Status } from '../logic/verdict.ts'
import { Stamp } from './Stamp.tsx'

afterEach(cleanup)

const text = (status: Status, deadlinePassed: boolean, detail?: string) =>
  render(<Stamp status={status} deadlinePassed={deadlinePassed} detail={detail} />).container.textContent

describe('Stamp', () => {
  it('uses the softer wording until the deadline has passed', () => {
    expect(text('on_time', false)).toBe('Submitted')
    expect(text('on_time', true)).toBe('On time')
    expect(text('no_submission', false)).toBe('Nothing yet')
    expect(text('no_submission', true)).toBe('No submission')
  })

  it('reads the same before and after the deadline for the other statuses', () => {
    for (const [status, label] of [
      ['late', 'Late'],
      ['changed_after', 'Changed after deadline'],
      ['submitted', 'Has work'],
      ['not_found', 'Not found'],
      ['invalid_link', 'Invalid link'],
      ['check_failed', 'Check failed'],
      ['checking', 'Checking'],
    ] as const) {
      expect(text(status, false)).toBe(label)
      expect(text(status, true)).toBe(label)
    }
  })

  it('puts a real space before the detail, so it never reads "Lateby"', () => {
    expect(text('late', true, 'by 3h 20m')).toBe('Late by 3h 20m')
  })
})
