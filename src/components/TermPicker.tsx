import { TERM_LABEL, TERMS } from '../logic/termFolder.ts'
import { useApp } from '../state/hooks.ts'
import { setTerm } from '../state/store.ts'

/**
 * Mid or Final, on a lab sheet. Each term keeps its own deadline, rules and
 * bonuses, and every row is judged by that term's folder in the repo.
 */
export function TermPicker() {
  const term = useApp((state) => state.term)
  return (
    <div className="terms" role="group" aria-label="Term">
      <span className="terms__label" aria-hidden="true">
        Marking
      </span>
      <div className="terms__track">
        {TERMS.map((option) => (
          <button
            key={option}
            type="button"
            className={`terms__button${option === term ? ' terms__button--on' : ''}`}
            aria-pressed={option === term}
            onClick={() => setTerm(option)}
          >
            {TERM_LABEL[option]}
          </button>
        ))}
      </div>
      <span className="terms__hint">
        Judged by the repo's {term === 'mid' ? 'Mid' : 'Final'} folder only.
      </span>
    </div>
  )
}
