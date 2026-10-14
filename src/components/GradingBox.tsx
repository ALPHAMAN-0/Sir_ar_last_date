import { useState } from 'react'
import { useApp } from '../state/hooks.ts'
import { applyGrading, setGradingInput } from '../state/store.ts'

/**
 * The grading controls: total mark, marks off for late, marks off for changed
 * after deadline. Like the deadline box, values are typed first and only take
 * effect when the teacher presses the button.
 */
export function GradingBox() {
  const input = useApp((state) => state.gradingInput)
  const grading = useApp((state) => state.grading)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number>(0)

  const handleApply = (event?: React.FormEvent) => {
    event?.preventDefault()
    const ok = applyGrading()
    if (ok) {
      setError(null)
      setSavedAt(Date.now())
    } else {
      setError('Please enter non-negative numbers. Leave Total blank for no upper bound.')
    }
  }

  const formatDeduction = (value: number): string => (value === 0 ? '0' : `−${value}`)
  const totalText = grading.totalMark === null ? 'no upper bound' : String(grading.totalMark)

  return (
    <form className="grading" onSubmit={handleApply} aria-label="Grading controls">
      <div className="grading__field">
        <label className="grading__label" htmlFor="grading-total">
          Total mark
        </label>
        <input
          id="grading-total"
          className="grading__input"
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          placeholder="e.g. 100"
          value={input.total}
          onChange={(event) => setGradingInput('total', event.target.value)}
        />
      </div>
      <div className="grading__field">
        <label className="grading__label" htmlFor="grading-late">
          Marks off for late
        </label>
        <input
          id="grading-late"
          className="grading__input"
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          placeholder="e.g. 20"
          value={input.offLate}
          onChange={(event) => setGradingInput('offLate', event.target.value)}
        />
      </div>
      <div className="grading__field">
        <label className="grading__label" htmlFor="grading-changed">
          Marks off for changed after deadline
        </label>
        <input
          id="grading-changed"
          className="grading__input"
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          placeholder="e.g. 10"
          value={input.offChanged}
          onChange={(event) => setGradingInput('offChanged', event.target.value)}
        />
      </div>
      <div className="grading__actions">
        <button type="submit" className="button button--primary">
          {savedAt === 0 ? 'Apply grading' : 'Change grading'}
        </button>
      </div>
      {error ? (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      ) : null}
      <p className="grading__state" aria-live="polite">
        <strong>Total:</strong> {totalText}.{' '}
        <strong>Late:</strong> {formatDeduction(grading.offForLate)}.{' '}
        <strong>Changed:</strong> {formatDeduction(grading.offForChanged)}.
      </p>
    </form>
  )
}