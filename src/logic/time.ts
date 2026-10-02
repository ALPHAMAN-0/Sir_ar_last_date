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

// Written out by hand so every browser shows exactly the same text.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const dayText = (date: Date) =>
  `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
const timeText = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`

/** "25 Sep 2026, 15:05" in local time. */
export function formatDateTime(instant: string | number | null | undefined): string {
  if (instant === null || instant === undefined) return ''
  const date = new Date(instant)
  return Number.isNaN(date.getTime()) ? '' : `${dayText(date)}, ${timeText(date)}`
}

/** "25 Sep, 15:05": the year is left out when it is the current one. For tight table columns. */
export function formatDateTimeShort(
  instant: string | number | null | undefined,
  now: number = Date.now(),
): string {
  if (instant === null || instant === undefined) return ''
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return ''
  if (date.getFullYear() !== new Date(now).getFullYear()) return formatDateTime(instant)
  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]}, ${timeText(date)}`
}

/** "Fri, 25 Sep 2026" for a "YYYY-MM-DD" key. */
export function formatDayKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return `${WEEKDAYS[date.getDay()]}, ${dayText(date)}`
}

/** "15:05" in local time. */
export function formatTime(instant: string | number): string {
  return timeText(new Date(instant))
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
