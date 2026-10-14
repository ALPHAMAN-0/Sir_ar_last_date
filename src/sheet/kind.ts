// Decides whether an uploaded sheet is the existing "project base" (one GitHub
// repo per person) or the new "performance base" (one row per person with mark
// columns). Pure functions, no Excel library, no DOM, no state.

import { parseRepoLink } from './parseRepoLink.ts'
import type { Cell } from './columns.ts'

export type SheetKind = 'project' | 'performance'

/** The mapping shape we accept on input — what `detectMapping` already produces. */
export type KindInput = {
  id: number | null
  name: number | null
  link: number | null
  headerRow: number | null
}

const cellIsRepoLink = (cell: Cell) =>
  parseRepoLink(cell.text).ok || (cell.link !== null && parseRepoLink(cell.link).ok)

/** Reads every cell of a column as a finite number, ignoring blank and non-numeric. */
function countNumericColumn(grid: Cell[][], column: number): number {
  let count = 0
  for (const row of grid) {
    const cell = row[column]
    if (!cell) continue
    const text = cell.text.trim()
    if (text === '') continue
    const value = Number(text)
    if (Number.isFinite(value)) count++
  }
  return count
}

/** Returns the indices of columns that look like mark columns. */
export function markColumnIndices(grid: Cell[][], mapping: KindInput): number[] {
  if (grid.length === 0) return []
  const width = grid[0]?.length ?? 0
  const reserved = new Set<number>()
  if (mapping.id !== null) reserved.add(mapping.id)
  if (mapping.name !== null) reserved.add(mapping.name)
  if (mapping.link !== null) reserved.add(mapping.link)
  const result: number[] = []
  for (let c = 0; c < width; c++) {
    if (reserved.has(c)) continue
    if (countNumericColumn(grid, c) >= 3) result.push(c)
  }
  return result
}

/**
 * "project" when the mapping already has a recognizable link column.
 * "performance" when there is no link column but at least one numeric mark column.
 * Defaults to "project" so the existing column picker can disambiguate.
 */
export function detectSheetKind(grid: Cell[][], mapping: KindInput): SheetKind {
  if (mapping.link !== null) {
    const column = mapping.link
    const hasLink = grid.some((row) => {
      const cell = row[column]
      return cell !== undefined && cellIsRepoLink(cell)
    })
    if (hasLink) return 'project'
  }
  if (markColumnIndices(grid, mapping).length >= 1) return 'performance'
  return 'project'
}
