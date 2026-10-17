import { describe, expect, it } from 'vitest'
import { codeTierLabel, codeTierTone, fileSize, fileUrl, percent, rangesText, tierLabel, tierTone } from './format.ts'
import type { CodeTier } from './sharedCode.ts'
import type { Tier } from './types.ts'

describe('percent', () => {
  it('formats a zero score as 0%', () => {
    expect(percent(0)).toBe('0%')
  })

  it('rounds scores at or above 10% to whole percent', () => {
    expect(percent(0.1)).toBe('10%')
    expect(percent(0.5)).toBe('50%')
    expect(percent(0.8765)).toBe('88%')
    expect(percent(1)).toBe('100%')
  })

  it('keeps one decimal place for scores below 10%', () => {
    expect(percent(0.05)).toBe('5.0%')
    expect(percent(0.087)).toBe('8.7%')
    expect(percent(0.001)).toBe('0.1%')
  })
})

describe('tierLabel and tierTone', () => {
  const tiers: Tier[] = ['almost_all', 'most', 'part', 'little', 'thin']

  it('gives each tier a label that describes files, not people', () => {
    expect(tiers.map(tierLabel)).toEqual([
      'Almost all identical',
      'Mostly identical',
      'Partly identical',
      'Small part identical',
      'Only a small file or two',
    ])
    for (const tier of tiers) expect(tierLabel(tier)).not.toMatch(/plagiar|cheat|copied/i)
  })

  it('maps tiers onto the register tones, strongest first', () => {
    expect(tiers.map(tierTone)).toEqual(['bad', 'warn', 'info', 'muted', 'muted'])
  })
})

describe('fileSize', () => {
  it('uses the unit that keeps the number short', () => {
    expect(fileSize(0)).toBe('0 B')
    expect(fileSize(850)).toBe('850 B')
    expect(fileSize(1234)).toBe('1.2 KB')
    expect(fileSize(13_057)).toBe('13 KB')
    expect(fileSize(3_400_000)).toBe('3.4 MB')
  })
})

describe('codeTierLabel and codeTierTone', () => {
  const tiers: CodeTier[] = ['almost_all', 'most', 'part', 'little', 'thin']

  it('says what the code shares, never what anyone did', () => {
    for (const tier of tiers) expect(codeTierLabel(tier)).toMatch(/shared$/)
    expect(codeTierLabel('thin')).toBe('Only a few lines shared')
  })

  it('never paints shared code red: that stays for identical files', () => {
    for (const tier of tiers) expect(codeTierTone(tier)).not.toBe('bad')
    expect(codeTierTone('almost_all')).toBe('warn')
    expect(codeTierTone('thin')).toBe('muted')
  })
})

describe('rangesText', () => {
  it('writes line ranges, and a single line once', () => {
    expect(rangesText([[3, 40], [52, 52]])).toBe('3–40, 52')
    expect(rangesText([])).toBe('')
  })

  it('names the first few and counts the rest', () => {
    expect(rangesText([[1, 2], [4, 5], [7, 8]], 2)).toBe('1–2, 4–5 +1 more')
  })
})

describe('fileUrl', () => {
  const HEAD = 'a'.repeat(40)

  it('opens the file at the compared commit, at its first shared lines', () => {
    expect(fileUrl('a/x', HEAD, 'Lab Task/form.js', [[3, 40], [52, 60]])).toBe(
      `https://github.com/a/x/blob/${HEAD}/Lab%20Task/form.js#L3-L40`,
    )
  })

  it('leaves out line numbers for a notebook and when there are none', () => {
    expect(fileUrl('a/x', HEAD, 'lab.ipynb', [[3, 4]])).toBe(`https://github.com/a/x/blob/${HEAD}/lab.ipynb`)
    expect(fileUrl('a/x', HEAD, 'a#b.js')).toBe(`https://github.com/a/x/blob/${HEAD}/a%23b.js`)
  })
})
