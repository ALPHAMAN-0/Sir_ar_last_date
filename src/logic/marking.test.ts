import { describe, expect, it } from 'vitest'
import { formatMark, markFor, NO_RULES, readRules, readBonus, type Rules } from './marking.ts'

const RULES: Rules = { total: 10, late: 2, changed: 1, noSubmission: 0 }

describe('markFor', () => {
  it('gives the full total to work that was on time', () => {
    expect(markFor('on_time', RULES)).toEqual({ final: 10, rule: '', bonus: 0 })
  })

  it('gives the full total when no deadline is set and the repo has work', () => {
    expect(markFor('submitted', RULES).final).toBe(10)
  })

  it('takes the late marks off a late row and says so', () => {
    expect(markFor('late', RULES)).toEqual({ final: 8, rule: 'Late −2', bonus: 0 })
  })

  it('takes the changed-after marks off a row changed after the deadline', () => {
    expect(markFor('changed_after', RULES)).toEqual({ final: 9, rule: 'Changed after deadline −1', bonus: 0 })
  })

  it('gives the no-submission mark to an empty repo, a missing repo and a bad link', () => {
    const rules = { ...RULES, noSubmission: 1 }
    for (const status of ['no_submission', 'not_found', 'invalid_link'] as const) {
      expect(markFor(status, rules)).toEqual({ final: 1, rule: 'No submission: 1', bonus: 0 })
    }
  })

  it('gives no mark while a row is being checked or when the check failed, so a hiccup never costs marks', () => {
    expect(markFor('checking', RULES, 3)).toEqual({ final: null, rule: '', bonus: 3 })
    expect(markFor('check_failed', RULES, 3)).toEqual({ final: null, rule: '', bonus: 3 })
  })

  it('adds the bonus after the rules', () => {
    expect(markFor('late', RULES, 1).final).toBe(9)
    expect(markFor('no_submission', RULES, 2).final).toBe(2)
  })

  it('never goes above the total, whatever the bonus', () => {
    expect(markFor('on_time', RULES, 2).final).toBe(10)
  })

  it('never goes below 0, whatever the rules or a negative bonus', () => {
    expect(markFor('late', { ...RULES, late: 15 }).final).toBe(0)
    expect(markFor('on_time', RULES, -12).final).toBe(0)
  })

  it('still says which rule applied when the clamp hides it', () => {
    expect(markFor('late', { ...RULES, late: 15 }).rule).toBe('Late −15')
  })

  it('writes nothing for a rule of 0', () => {
    expect(markFor('late', { ...RULES, late: 0 })).toEqual({ final: 10, rule: '', bonus: 0 })
    expect(markFor('changed_after', { ...RULES, changed: 0 }).rule).toBe('')
  })

  it('gives no mark until the total is set', () => {
    expect(markFor('on_time', NO_RULES, 2)).toEqual({ final: null, rule: '', bonus: 2 })
    expect(markFor('late', { ...RULES, total: null }).final).toBeNull()
  })

  it('works with half marks', () => {
    expect(markFor('late', { ...RULES, late: 1.5 }, 0.25)).toEqual({ final: 8.75, rule: 'Late −1.5', bonus: 0.25 })
  })
})

describe('formatMark', () => {
  it('writes whole numbers without a decimal point and trims the rest to two places', () => {
    expect(formatMark(8)).toBe('8')
    expect(formatMark(8.5)).toBe('8.5')
    expect(formatMark(8.25)).toBe('8.25')
    expect(formatMark(1 / 3)).toBe('0.33')
    expect(formatMark(null)).toBe('')
  })
})

describe('readRules', () => {
  it('reads what the teacher typed', () => {
    expect(readRules({ total: '10', late: '2', changed: '1', noSubmission: '0' })).toEqual({
      ok: true,
      rules: RULES,
    })
  })

  it('treats blank deductions as 0 and a blank total as not set yet', () => {
    expect(readRules({ total: '', late: '', changed: ' ', noSubmission: '' })).toEqual({ ok: true, rules: NO_RULES })
  })

  it('names each field it cannot use, and keeps going for the others', () => {
    const result = readRules({ total: '0', late: '-2', changed: 'abc', noSubmission: '1e999' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.bad.sort()).toEqual(['changed', 'late', 'noSubmission', 'total'])
  })

  it('refuses a number too large to be a mark', () => {
    expect(readRules({ total: '100001', late: '', changed: '', noSubmission: '' }).ok).toBe(false)
  })
})

describe('readBonus', () => {
  it('reads a bonus, a half mark and a minus sign (marks taken off for a wrong answer)', () => {
    expect(readBonus('2')).toEqual({ ok: true, value: 2 })
    expect(readBonus(' 0.5 ')).toEqual({ ok: true, value: 0.5 })
    expect(readBonus('-1')).toEqual({ ok: true, value: -1 })
    expect(readBonus('−1')).toEqual({ ok: true, value: -1 })
  })

  it('reads a blank box as no bonus', () => {
    expect(readBonus('')).toEqual({ ok: true, value: null })
  })

  it('refuses text, half-typed numbers and huge values', () => {
    expect(readBonus('two').ok).toBe(false)
    expect(readBonus('1.2.3').ok).toBe(false)
    expect(readBonus('Infinity').ok).toBe(false)
    expect(readBonus('999999').ok).toBe(false)
  })
})
