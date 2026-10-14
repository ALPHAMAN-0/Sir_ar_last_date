import { describe, expect, it } from 'vitest'
import type { Cell } from './columns.ts'
import { detectSheetKind, markColumnIndices } from './kind.ts'

const cell = (text: string, link: string | null = null): Cell => ({ text, link })
const row = (...cells: Array<string | Cell>): Cell[] => cells.map((c) => (typeof c === 'string' ? cell(c) : c))

describe('detectSheetKind', () => {
  it('returns "project" when a GitHub link column is detected', () => {
    const grid = [
      row('id', 'name', 'repolink'),
      row('22-46001-1', 'Rahim', 'https://github.com/octocat/Hello-World'),
      row('22-46002-1', 'Karim', 'https://github.com/octocat/Spoon-Knife'),
      row('22-46003-1', 'Selim', 'https://github.com/octocat/octocat.github.io'),
    ]
    const mapping = { id: 0, name: 1, link: 2, headerRow: 0 }
    expect(detectSheetKind(grid, mapping)).toBe('project')
  })

  it('returns "performance" when there are numeric mark columns and no link column', () => {
    const grid = [
      row('id', 'name', 'midterm', 'final'),
      row('22-46001-1', 'Rahim', '30', '50'),
      row('22-46002-1', 'Karim', '28', '48'),
      row('22-46003-1', 'Selim', '25', '45'),
      row('22-46004-1', 'Jamil', '22', '40'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0 }
    expect(detectSheetKind(grid, mapping)).toBe('performance')
  })

  it('returns "project" when there is no link column and no numeric column', () => {
    const grid = [
      row('id', 'name'),
      row('22-46001-1', 'Rahim'),
      row('22-46002-1', 'Karim'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0 }
    expect(detectSheetKind(grid, mapping)).toBe('project')
  })

  it('returns "project" when the link column is set even if there are numeric columns too', () => {
    const grid = [
      row('id', 'name', 'repolink', 'score'),
      row('22-46001-1', 'Rahim', 'https://github.com/a/b', '80'),
      row('22-46002-1', 'Karim', 'https://github.com/c/d', '70'),
      row('22-46003-1', 'Selim', 'https://github.com/e/f', '60'),
    ]
    const mapping = { id: 0, name: 1, link: 2, headerRow: 0 }
    expect(detectSheetKind(grid, mapping)).toBe('project')
  })

  it('returns "performance" when only one column has numeric data (but with enough rows)', () => {
    const grid = [
      row('id', 'name', 'marks'),
      row('22-46001-1', 'Rahim', '80'),
      row('22-46002-1', 'Karim', '70'),
      row('22-46003-1', 'Selim', '60'),
      row('22-46004-1', 'Jamil', '50'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0 }
    expect(detectSheetKind(grid, mapping)).toBe('performance')
  })

  it('handles a sheet with no header row', () => {
    const grid = [
      row('22-46001-1', 'Rahim', '80'),
      row('22-46002-1', 'Karim', '70'),
      row('22-46003-1', 'Selim', '60'),
      row('22-46004-1', 'Jamil', '50'),
    ]
    const mapping = { id: null, name: null, link: null, headerRow: null }
    expect(detectSheetKind(grid, mapping)).toBe('performance')
  })

  it('does not count id and name as numeric columns', () => {
    const grid = [
      row('22-46001-1', 'Rahim', '80'),
      row('22-46002-1', 'Karim', '70'),
      row('22-46003-1', 'Selim', '60'),
      row('22-46004-1', 'Jamil', '50'),
    ]
    // Pretend the detector picked the first numeric column as id by mistake.
    const mapping = { id: 0, name: 1, link: null, headerRow: null }
    expect(detectSheetKind(grid, mapping)).toBe('performance')
  })
})

describe('markColumnIndices', () => {
  it('returns the indices of numeric columns that are not id, name, or link', () => {
    const grid = [
      row('id', 'name', 'midterm', 'final', 'notes'),
      row('22-46001-1', 'Rahim', '30', '50', 'good'),
      row('22-46002-1', 'Karim', '28', '48', 'good'),
      row('22-46003-1', 'Selim', '25', '45', 'ok'),
      row('22-46004-1', 'Jamil', '22', '40', 'fine'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0 }
    expect(markColumnIndices(grid, mapping)).toEqual([2, 3])
  })

  it('skips columns whose values are not numbers', () => {
    const grid = [
      row('id', 'name', 'feedback', 'final'),
      row('22-46001-1', 'Rahim', 'great work', '50'),
      row('22-46002-1', 'Karim', 'good', '48'),
      row('22-46003-1', 'Selim', 'okay', '45'),
      row('22-46004-1', 'Jamil', 'fine', '40'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0 }
    expect(markColumnIndices(grid, mapping)).toEqual([3])
  })

  it('returns an empty array when there are no numeric columns', () => {
    const grid = [
      row('id', 'name', 'feedback'),
      row('22-46001-1', 'Rahim', 'great'),
      row('22-46002-1', 'Karim', 'good'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0 }
    expect(markColumnIndices(grid, mapping)).toEqual([])
  })

  it('counts a column as numeric when at least three cells parse as finite numbers', () => {
    const grid = [
      row('id', 'name', 'score'),
      row('22-46001-1', 'Rahim', '80'),
      row('22-46002-1', 'Karim', '70'),
      row('22-46003-1', 'Selim', '60'),
      row('22-46004-1', 'Jamil', 'absent'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0 }
    expect(markColumnIndices(grid, mapping)).toEqual([2])
  })

  it('does not count a column with fewer than three numeric cells', () => {
    const grid = [
      row('id', 'name', 'score'),
      row('22-46001-1', 'Rahim', '80'),
      row('22-46002-1', 'Karim', 'absent'),
      row('22-46003-1', 'Selim', 'absent'),
      row('22-46004-1', 'Jamil', 'absent'),
    ]
    const mapping = { id: 0, name: 1, link: null, headerRow: 0 }
    expect(markColumnIndices(grid, mapping)).toEqual([])
  })
})
