// Display helpers for the similarity report. Pure, no DOM. Tones are the same
// words the register's stamps use, so both screens share their colours.

import { repoUrl } from '../logic/people.ts'
import type { CodeTier, LineRange } from './sharedCode.ts'
import type { Tier } from './types.ts'

/** A share in [0, 1] as "87%". Small values keep one decimal so they do not all read "0%". */
export function percent(score: number): string {
  const pct = score * 100
  if (pct === 0) return '0%'
  if (pct >= 10) return `${Math.round(pct)}%`
  return `${pct.toFixed(1)}%`
}

/** What the files say, never what the students did. */
export function tierLabel(tier: Tier): string {
  switch (tier) {
    case 'same_repo':
      return 'Same repo'
    case 'almost_all':
      return 'Almost all identical'
    case 'most':
      return 'Mostly identical'
    case 'part':
      return 'Partly identical'
    case 'little':
      return 'Small part identical'
    case 'thin':
      return 'Only a small file or two'
  }
}

export function tierTone(tier: Tier): 'bad' | 'warn' | 'info' | 'muted' {
  switch (tier) {
    case 'same_repo':
    case 'almost_all':
      return 'bad'
    case 'most':
      return 'warn'
    case 'part':
      return 'info'
    case 'little':
    case 'thin':
      return 'muted'
  }
}

/** The label of a shared-code pair. What the code says, never what the students did. */
export function codeTierLabel(tier: CodeTier): string {
  switch (tier) {
    case 'almost_all':
      return 'Almost all code shared'
    case 'most':
      return 'Most code shared'
    case 'part':
      return 'Part of the code shared'
    case 'little':
      return 'A little code shared'
    case 'thin':
      return 'Only a few lines shared'
  }
}

/**
 * Never `bad`: red stays for identical files. Shared code is a reason to look,
 * and two people can share it because both took it from the same place.
 */
export function codeTierTone(tier: CodeTier): 'warn' | 'info' | 'muted' {
  switch (tier) {
    case 'almost_all':
    case 'most':
      return 'warn'
    case 'part':
      return 'info'
    case 'little':
    case 'thin':
      return 'muted'
  }
}

/** "3–40, 52–60": line ranges, the first `max` of them. */
export function rangesText(ranges: ReadonlyArray<readonly [number, number]>, max = 4): string {
  const shown = ranges.slice(0, max).map(([first, last]) => (first === last ? `${first}` : `${first}–${last}`))
  const rest = ranges.length - shown.length
  return rest > 0 ? `${shown.join(', ')} +${rest} more` : shown.join(', ')
}

export const isNotebook = (path: string) => path.toLowerCase().endsWith('.ipynb')

/** The file on GitHub at the compared commit, opened at its first shared lines. */
export function fileUrl(repo: string, headOid: string, path: string, ranges: readonly LineRange[] = []): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const first = ranges[0]
  // A notebook is shown as cells on GitHub, so line numbers lead nowhere.
  const anchor = first && !isNotebook(path) ? `#L${first[0]}-L${first[1]}` : ''
  return `${repoUrl(repo)}/blob/${headOid}/${encoded}${anchor}`
}

/** "850 B", "1.2 KB", "3.4 MB" */
export function fileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
