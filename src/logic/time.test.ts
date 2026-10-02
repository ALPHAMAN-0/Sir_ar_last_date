import { afterEach, describe, expect, it } from 'vitest'
import {
  formatDateTime,
  formatDayKey,
  formatDuration,
  formatTime,
  localDateKey,
  parseDeadlineInput,
  zoneLabel,
} from './time.ts'

declare const process: { env: Record<string, string | undefined> }

const originalZone = process.env.TZ
const useZone = (zone: string) => {
  process.env.TZ = zone
}
afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

describe('parseDeadlineInput', () => {
  it('reads local wall time and includes the whole minute', () => {
    useZone('Asia/Dhaka')
    const parsed = parseDeadlineInput('2026-10-05T23:59')
    expect(parsed).toEqual({ ms: Date.parse('2026-10-05T17:59:59.999Z'), shifted: false })
  })

  it('gives a different instant in a different zone', () => {
    useZone('America/New_York')
    expect(parseDeadlineInput('2026-10-05T23:59')?.ms).toBe(Date.parse('2026-10-06T03:59:59.999Z'))
  })

  it('warns when the typed time does not exist because clocks moved forward', () => {
    useZone('America/New_York')
    // 02:30 on 8 March 2026 is skipped in New York.
    expect(parseDeadlineInput('2026-03-08T02:30')?.shifted).toBe(true)
    expect(parseDeadlineInput('2026-03-08T03:30')?.shifted).toBe(false)
  })

  it('rejects anything that is not a full date and time', () => {
    for (const bad of ['', '2026-10-05', '2026-10-05 23:59', '2026-10-05T23:59:30', 'tomorrow']) {
      expect(parseDeadlineInput(bad), bad).toBeNull()
    }
  })
})

describe('localDateKey', () => {
  it('groups by the local calendar day, not the UTC day', () => {
    useZone('Asia/Dhaka')
    // 18:30 UTC is 00:30 the next day in Dhaka.
    expect(localDateKey('2026-09-25T18:30:00Z')).toBe('2026-09-26')
    expect(localDateKey('2026-09-25T17:30:00Z')).toBe('2026-09-25')
  })
})

describe('date text', () => {
  it('shows local time in one fixed format', () => {
    useZone('Asia/Dhaka')
    expect(formatDateTime('2026-09-25T15:10:45Z')).toBe('25 Sep 2026, 21:10')
    expect(formatDateTime(Date.parse('2026-01-05T18:05:00Z'))).toBe('06 Jan 2026, 00:05')
    expect(formatTime('2026-09-25T03:04:00Z')).toBe('09:04')
    expect(formatDayKey('2026-09-25')).toBe('Fri, 25 Sep 2026')
  })

  it('shows the deadline minute, not the next one', () => {
    useZone('Asia/Dhaka')
    const deadline = parseDeadlineInput('2026-10-05T23:59')
    expect(formatDateTime(deadline?.ms)).toBe('05 Oct 2026, 23:59')
  })

  it('returns nothing for missing or broken values', () => {
    expect(formatDateTime(null)).toBe('')
    expect(formatDateTime(undefined)).toBe('')
    expect(formatDateTime('not a date')).toBe('')
  })
})

describe('formatDuration', () => {
  it('uses the two largest units', () => {
    const minute = 60_000
    expect(formatDuration(20_000)).toBe('under 1 min')
    expect(formatDuration(45 * minute)).toBe('45 min')
    expect(formatDuration(60 * minute)).toBe('1h')
    expect(formatDuration(200 * minute)).toBe('3h 20m')
    expect(formatDuration(24 * 60 * minute)).toBe('1d')
    expect(formatDuration((2 * 24 + 4) * 60 * minute + 30 * minute)).toBe('2d 4h')
  })
})

describe('zoneLabel', () => {
  it('shows the zone name and its UTC offset', () => {
    useZone('Asia/Dhaka')
    expect(zoneLabel(new Date('2026-10-05T00:00:00Z'))).toMatch(/\(UTC\+6\)$/)
    useZone('Asia/Kolkata')
    expect(zoneLabel(new Date('2026-10-05T00:00:00Z'))).toMatch(/\(UTC\+5:30\)$/)
  })
})
