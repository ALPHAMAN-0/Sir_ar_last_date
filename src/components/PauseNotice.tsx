import { formatTime } from '../logic/time.ts'
import { useApp } from '../state/hooks.ts'

const PAUSE_TEXT = {
  rate_limited: 'Too many requests at once. Checking continues by itself at',
  github_throttled: 'GitHub asked the app to slow down. Checking continues by itself at',
  quota_reserved:
    'The GitHub limit shared by everyone using this page is used up for this hour. Press Refresh after',
} as const

/** Shown while the request queue is on hold, on every screen that loads from GitHub. */
export function PauseNotice() {
  const pause = useApp((state) => state.pause)
  if (!pause) return null
  return (
    <p className="notice notice--bad" role="status">
      {PAUSE_TEXT[pause.reason]} {formatTime(pause.until)}.
    </p>
  )
}
