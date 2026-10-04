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

export type Route =
  | { kind: 'register' }
  | { kind: 'person'; rowId: string }
  | { kind: 'similarity' }

/** `#/p/r12` opens the person on sheet row 12. `#/s` opens the similarity tab. Anything else is the table. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash)
  const person = /^#\/p\/(r\d+)$/.exec(hash)
  if (person) return { kind: 'person', rowId: person[1] }
  if (hash === '#/s') return { kind: 'similarity' }
  return { kind: 'register' }
}

export const personHref = (rowId: string) => `#/p/${rowId}`
export const similarityHref = () => '#/s'

/** The current time, refreshed on an interval, for "passed 3h ago" style text. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
