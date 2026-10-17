// The marking rules: the teacher's rules table turns each row's status into a
// mark, and the teacher's bonus for that student is added on top. Pure
// functions, no time, no DOM, no state.

import type { Status } from './verdict.ts'

/** The rules table. One per project sheet, one per term of a lab sheet. */
export type Rules = {
  /** Full marks. Null until the teacher types it: no mark is worked out without it. */
  total: number | null
  /** Marks taken off a late row. */
  late: number
  /** Marks taken off a row changed after the deadline. */
  changed: number
  /** The mark of a row with nothing to mark: an empty repo, a missing repo or a bad link. */
  noSubmission: number
}

export const NO_RULES: Rules = { total: null, late: 0, changed: 0, noSubmission: 0 }

export type RuleField = keyof Rules
export const RULE_FIELDS: readonly RuleField[] = ['total', 'late', 'changed', 'noSubmission']
/** What the teacher typed in each field of the rules table. */
export type RulesInput = Record<RuleField, string>

export type Mark = {
  /** Null when no mark can be given yet: no total, or the row's check is not finished or failed. */
  final: number | null
  /** What the rules did to the row, e.g. "Late −2". Empty when they did nothing. */
  rule: string
  bonus: number
}

/** Large enough for any mark scheme, small enough that a slip of the keyboard is caught. */
const MAX_MARK = 100_000

/** "8", "8.5", "8.25": no trailing zeros, at most two decimals. */
export function formatMark(value: number | null): string {
  if (value === null) return ''
  return String(Math.round(value * 100) / 100)
}

/**
 * The final mark of one row: the status picks the starting mark from the
 * rules table, the bonus is added, and the result stays between 0 and the total.
 */
export function markFor(status: Status, rules: Rules, bonus = 0): Mark {
  const { total } = rules
  // A row still being checked, or one GitHub could not answer, is never marked:
  // a failure of the check must not cost the student marks.
  if (total === null || status === 'checking' || status === 'check_failed') {
    return { final: null, rule: '', bonus }
  }
  let start = total
  let rule = ''
  switch (status) {
    case 'on_time':
    case 'submitted':
      break
    case 'late':
      start = total - rules.late
      if (rules.late !== 0) rule = `Late −${formatMark(rules.late)}`
      break
    case 'changed_after':
      start = total - rules.changed
      if (rules.changed !== 0) rule = `Changed after deadline −${formatMark(rules.changed)}`
      break
    case 'no_submission':
    case 'not_found':
    case 'invalid_link':
      start = rules.noSubmission
      rule = `No submission: ${formatMark(rules.noSubmission)}`
      break
  }
  const final = Math.min(total, Math.max(0, start + bonus))
  return { final, rule, bonus }
}

// "12", "1.5", "1.", ".5", with an optional minus. Written so that it never backtracks.
const NUMBER = /^-?(\d+(\.\d*)?|\.\d+)$/

/** A typed number, or null for a blank box. Undefined when the text is not a usable number. */
function readNumber(text: string): number | null | undefined {
  // A typographic minus, as in "−2", is read like the keyboard's hyphen.
  const clean = text.trim().replace(/^−/, '-')
  if (clean === '') return null
  if (!NUMBER.test(clean)) return undefined
  const value = Number(clean)
  return Number.isFinite(value) && Math.abs(value) <= MAX_MARK ? value : undefined
}

export type RulesReading = { ok: true; rules: Rules } | { ok: false; bad: RuleField[] }

/**
 * Reads the rules table. A blank total means "not set yet"; a blank deduction
 * means 0. Every field that cannot be used is named, so the box can mark each one.
 */
export function readRules(input: RulesInput): RulesReading {
  const bad: RuleField[] = []
  const total = readNumber(input.total)
  if (total === undefined || (total !== null && total <= 0)) bad.push('total')
  const amount = (field: Exclude<RuleField, 'total'>): number => {
    const value = readNumber(input[field])
    if (value === undefined || (value !== null && value < 0)) {
      bad.push(field)
      return 0
    }
    return value ?? 0
  }
  const late = amount('late')
  const changed = amount('changed')
  const noSubmission = amount('noSubmission')
  if (bad.length > 0) return { ok: false, bad }
  return { ok: true, rules: { total: total ?? null, late, changed, noSubmission } }
}

/** The rules as the table shows them again, e.g. after a reload. */
export function rulesInput(rules: Rules): RulesInput {
  return {
    total: rules.total === null ? '' : String(rules.total),
    late: rules.late === 0 ? '' : String(rules.late),
    changed: rules.changed === 0 ? '' : String(rules.changed),
    noSubmission: rules.noSubmission === 0 ? '' : String(rules.noSubmission),
  }
}

/** A bonus: any number, a minus sign taking marks off. Blank means no bonus. */
export function readBonus(text: string): { ok: true; value: number | null } | { ok: false } {
  const value = readNumber(text)
  return value === undefined ? { ok: false } : { ok: true, value }
}
