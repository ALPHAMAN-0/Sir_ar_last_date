// Dates are shown in the browser's own time zone. Deadlines are typed as local
// wall-clock time and stored as an absolute instant.

const pad = (value: number) => String(value).padStart(2, '0')

export type ParsedDeadline = {
  /** Last millisecond that still counts as on time. */
  ms: number
  /** True when the typed time does not exist (clock change) and was moved. */
  shifted: boolean
}

/**
 * Reads a `datetime-local` value such as "2026-10-05T23:59". The whole chosen
 * minute counts as on time, so 23:59 means up to 23:59:59.
 */
export function parseDeadlineInput(value: string): ParsedDeadline | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const start = new Date(year, month - 1, day, hour, minute, 0, 0)
  if (Number.isNaN(start.getTime())) return null
  const shifted =
    start.getFullYear() !== year ||
    start.getMonth() !== month - 1 ||
    start.getDate() !== day ||
    start.getHours() !== hour ||
    start.getMinutes() !== minute
  return { ms: start.getTime() + 59_999, shifted }
}

/** The local calendar day of an instant, as "YYYY-MM-DD". Used to group commits by date. */
export function localDateKey(instant: string | number): string {
  const date = new Date(instant)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

/** "25 Sep 2026, 15:05" */
export function formatDateTime(instant: string | number | null | undefined): string {
  if (instant === null || instant === undefined) return ''
  const date = new Date(instant)
  return Number.isNaN(date.getTime()) ? '' : DATE_TIME.format(date)
}

/** "Fri, 25 Sep 2026" for a "YYYY-MM-DD" key. */
export function formatDayKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  return DAY.format(new Date(year, month - 1, day))
}

/** "15:05" */
export function formatTime(instant: string | number): string {
  return TIME.format(new Date(instant))
}

/** "3h 20m", "2d 4h", "45 min". Rounds down, never shows zero for a real delay. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.abs(ms) / 60_000)
  if (minutes < 1) return 'under 1 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`
}

/** "Asia/Dhaka (UTC+6)" */
export function zoneLabel(now: Date = new Date()): string {
  const offset = -now.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  const hours = Math.floor(Math.abs(offset) / 60)
  const minutes = Math.abs(offset) % 60
  const utc = `UTC${sign}${hours}${minutes ? `:${pad(minutes)}` : ''}`
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone
  return name ? `${name} (${utc})` : utc
}
