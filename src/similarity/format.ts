// Human-friendly display helpers for the similarity report. Pure, no DOM.
// Tone strings match the existing stamp tones so the chip and table rows
// reuse the same colour tokens as the register.

import type { Tier } from './types.ts'

/**
 * Formats a Jaccard score in [0, 1] as "NN%" (whole percent) for clarity,
 * except very small values show one decimal place so the table isn't full
 * of zeroes.
 */
export function percent(score: number): string {
  const pct = score * 100
  if (pct === 0) return '0%'
  if (pct >= 10) return `${Math.round(pct)}%`
  return `${pct.toFixed(1)}%`
}

/** Short, honest label for a tier. Says nothing about plagiarism. */
export function tierLabel(tier: Tier): string {
  switch (tier) {
    case 'very_similar':
      return 'Very similar'
    case 'similar':
      return 'Similar'
    case 'some_overlap':
      return 'Some overlap'
    case 'different':
      return 'Different'
  }
}

/**
 * Maps a similarity tier to the same tone vocabulary the register uses,
 * so the chip and the table row border share colours.
 *
 * - very_similar → bad (it is the most worrying tier)
 * - similar      → warn
 * - some_overlap → info
 * - different    → muted
 */
export function tierTone(tier: Tier): 'bad' | 'warn' | 'info' | 'muted' {
  switch (tier) {
    case 'very_similar':
      return 'bad'
    case 'similar':
      return 'warn'
    case 'some_overlap':
      return 'info'
    case 'different':
      return 'muted'
  }
}