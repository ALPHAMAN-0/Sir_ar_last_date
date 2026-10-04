import { describe, expect, it } from 'vitest'
import { percent, tierLabel, tierTone } from './format.ts'

describe('percent', () => {
  it('renders 0% for zero', () => {
    expect(percent(0)).toBe('0%')
  })

  it('rounds large values to a whole percent', () => {
    expect(percent(0.876)).toBe('88%')
    expect(percent(1)).toBe('100%')
    expect(percent(0.999)).toBe('100%')
  })

  it('keeps one decimal below 10%', () => {
    expect(percent(0.05)).toBe('5.0%')
    expect(percent(0.099)).toBe('9.9%')
  })
})

describe('tierLabel', () => {
  it('returns a label for every tier', () => {
    expect(tierLabel('very_similar')).toBe('Very similar')
    expect(tierLabel('similar')).toBe('Similar')
    expect(tierLabel('some_overlap')).toBe('Some overlap')
    expect(tierLabel('different')).toBe('Different')
  })
})

describe('tierTone', () => {
  it('maps tiers to the register tone vocabulary', () => {
    expect(tierTone('very_similar')).toBe('bad')
    expect(tierTone('similar')).toBe('warn')
    expect(tierTone('some_overlap')).toBe('info')
    expect(tierTone('different')).toBe('muted')
  })
})