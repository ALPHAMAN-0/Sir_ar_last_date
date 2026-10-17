import { formatMark, type RuleField } from '../logic/marking.ts'
import { TERM_LABEL } from '../logic/termFolder.ts'
import { useApp } from '../state/hooks.ts'
import { setRuleInput } from '../state/store.ts'

const FIELDS: ReadonlyArray<{ field: RuleField; label: string; placeholder: string; problem: string }> = [
  { field: 'total', label: 'Total mark', placeholder: 'e.g. 10', problem: 'a number above 0' },
  { field: 'late', label: 'Marks off for late', placeholder: '0', problem: 'a number of 0 or more' },
  {
    field: 'changed',
    label: 'Marks off for changed after deadline',
    placeholder: '0',
    problem: 'a number of 0 or more',
  },
  { field: 'noSubmission', label: 'Mark for no submission', placeholder: '0', problem: 'a number of 0 or more' },
]

/**
 * The rules table: one set of rules applied to every student by their status.
 * It is in force as it is typed, with no button: working out marks asks GitHub
 * for nothing, so there is nothing to hold back. A value that cannot be used is
 * named, and the marks keep the last good rules meanwhile.
 */
export function MarkingBox() {
  const input = useApp((state) => state.rulesInput)
  const bad = useApp((state) => state.rulesBad)
  const rules = useApp((state) => state.rules)
  const kind = useApp((state) => state.sheet?.kind)
  const term = useApp((state) => state.term)

  const total = rules.total
  return (
    <section className="marking" aria-labelledby="marking-title">
      <div className="marking__head">
        <h2 id="marking-title" className="marking__title">
          Marking rules
        </h2>
        <p className="marking__scope">
          {kind === 'lab' ? `${TERM_LABEL[term]}, for every student` : 'For every student'}
        </p>
      </div>
      <div className="marking__fields">
        {FIELDS.map(({ field, label, placeholder }) => (
          <label key={field} className="marking__field">
            <span className="marking__label">{label}</span>
            <input
              className="marking__input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={placeholder}
              value={input[field]}
              aria-invalid={bad.includes(field) ? true : undefined}
              onChange={(event) => setRuleInput(field, event.target.value)}
            />
          </label>
        ))}
      </div>
      {bad.length > 0 ? (
        <p className="notice notice--bad" role="alert">
          {FIELDS.filter(({ field }) => bad.includes(field))
            .map(({ label, problem }) => `${label}: use ${problem}.`)
            .join(' ')}{' '}
          The marks keep the last rules that worked.
        </p>
      ) : null}
      <p className="marking__formula">
        {total === null ? (
          'Type the total mark to see final marks.'
        ) : (
          <>
            Final mark = <strong>{formatMark(total)}</strong>, minus the marks off for late or changed
            after, plus the bonus; never below 0 or above {formatMark(total)}. No submission gets{' '}
            <strong>{formatMark(rules.noSubmission)}</strong>.
          </>
        )}
      </p>
    </section>
  )
}
