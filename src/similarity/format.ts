// Display helpers for the similarity report. Pure, no DOM. Tones are the same
// words the register's stamps use, so both screens share their colours.

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

/** "850 B", "1.2 KB", "3.4 MB" */
export function fileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
