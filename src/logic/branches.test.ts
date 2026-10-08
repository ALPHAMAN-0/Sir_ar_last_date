import { describe, expect, it } from 'vitest'
import { branchNamesText } from './branches.ts'

describe('branchNamesText', () => {
  it('is blank when the branches are not known', () => {
    expect(branchNamesText(null, 'main')).toBe('')
  })

  it('names a single branch', () => {
    expect(branchNamesText({ total: 1, names: ['main'] }, 'main')).toBe('main')
  })

  it('puts the main branch first and keeps the rest in the order GitHub gave', () => {
    expect(branchNamesText({ total: 3, names: ['dev', 'main', 'test'] }, 'main')).toBe('main; dev; test')
  })

  it('leaves the order alone when the main branch is not among the names listed', () => {
    expect(branchNamesText({ total: 2, names: ['a', 'b'] }, 'zzz')).toBe('a; b')
    expect(branchNamesText({ total: 2, names: ['a', 'b'] }, '')).toBe('a; b')
  })

  it('says how many more branches there are than names listed', () => {
    const names = Array.from({ length: 100 }, (_, i) => `b${String(i).padStart(3, '0')}`)
    expect(branchNamesText({ total: 1150, names }, 'main')).toMatch(/^b000; b001; .*; b099; and 1,050 more$/)
    expect(branchNamesText({ total: 100, names }, 'main')).not.toContain('more')
  })
})
