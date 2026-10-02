import { formatDateTime, formatDuration, parseDeadlineInput } from '../logic/time.ts'
import { useApp, useNow } from '../state/hooks.ts'
import { applyDeadline, setDeadlineInput } from '../state/store.ts'

/**
 * The one deadline for the whole sheet. It takes effect on the button, not while
 * typing, because moving it can start downloads for every row.
 */
export function DeadlineBox() {
  const input = useApp((state) => state.deadlineInput)
  const deadline = useApp((state) => state.deadline)
  const shifted = useApp((state) => state.deadlineShifted)
  const now = useNow()

  const typed = input ? (parseDeadlineInput(input)?.ms ?? null) : null
  const changed = typed !== deadline
  const invalid = input !== '' && typed === null

  return (
    <form
      className="deadline"
      onSubmit={(event) => {
        event.preventDefault()
        applyDeadline()
      }}
    >
      <div className="deadline__field">
        <label className="deadline__label" htmlFor="deadline-input">
          Deadline
        </label>
        <input
          id="deadline-input"
          className="deadline__input"
          type="datetime-local"
          value={input}
          onChange={(event) => setDeadlineInput(event.target.value)}
        />
        <button type="submit" className="button button--primary" disabled={!changed || invalid}>
          {deadline === null ? 'Set deadline' : 'Change deadline'}
        </button>
        {deadline !== null ? (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              setDeadlineInput('')
              applyDeadline()
            }}
          >
            Remove
          </button>
        ) : null}
      </div>

      <p className="deadline__state" aria-live="polite">
        {deadline === null ? (
          'No deadline is set, so the register shows dates only.'
        ) : (
          <>
            <strong>{formatDateTime(deadline)}</strong>
            {now > deadline
              ? ` passed ${formatDuration(now - deadline)} ago.`
              : ` is in ${formatDuration(deadline - now)}.`}{' '}
            Work pushed during that minute still counts as on time.
          </>
        )}
      </p>
      {shifted && deadline !== null ? (
        <p className="notice notice--warn">
          That clock time does not exist on that day because the clocks change. The nearest valid
          time is used instead.
        </p>
      ) : null}
    </form>
  )
}
