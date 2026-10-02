import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { getState, judgeRows, subscribe, type AppState, type PersonRow } from './store.ts'

/** Reads one value from the store. The selector must return an existing value, not a new object. */
export function useApp<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getState()))
}

/** Every sheet row with its status, in sheet order. Recomputed only when its inputs change. */
export function usePeople(): PersonRow[] {
  const sheet = useApp((state) => state.sheet)
  const repos = useApp((state) => state.repos)
  const activity = useApp((state) => state.activity)
  const deadline = useApp((state) => state.deadline)
  return useMemo(
    () => (sheet ? judgeRows(sheet, repos, activity, deadline) : []),
    [sheet, repos, activity, deadline],
  )
}

function subscribeHash(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

/** `#/p/r12` opens the person on sheet row 12. Anything else is the table. */
export function useRoute(): { rowId: string | null } {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash)
  const match = /^#\/p\/(r\d+)$/.exec(hash)
  return { rowId: match ? match[1] : null }
}

export const personHref = (rowId: string) => `#/p/${rowId}`

/** The current time, refreshed on an interval, for "passed 3h ago" style text. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
