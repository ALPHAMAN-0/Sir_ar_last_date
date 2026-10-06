// "Who had it first" on the similarity tab: the table cell and the evidence
// inside an opened pair. The rules and the words live in src/similarity; these
// two only draw them.

import type { FirstState } from '../similarity/firstRun.ts'
import {
  FIRST_NOTE,
  NO_FIRST,
  evidenceLines,
  firstLabel,
  firstTone,
  isNamed,
  resultLine,
} from '../similarity/firstText.ts'
import type { Tier } from '../similarity/types.ts'
import { useNow } from '../state/hooks.ts'

/** The cell of one pair. `state` is undefined for a repo handed in by several people. */
export function FirstCell({ state, tier }: { state: FirstState | undefined; tier: Tier }) {
  if (!state) return <span className="similarity__dim">{NO_FIRST}</span>
  const tone = state.state === 'checking' ? 'busy' : firstTone(state)
  return (
    <>
      <span className={`stamp stamp--${tone}`}>{firstLabel(state)}</span>
      {state.state === 'ready' && isNamed(state.evidence) ? (
        <span className="entry__notes">{resultLine(state.evidence, tier)}</span>
      ) : null}
    </>
  )
}

/** What was seen about one pair, and what follows from it. */
export function FirstEvidence({
  state,
  tier,
  onCheck,
}: {
  state: FirstState | undefined
  tier: Tier
  /** Starts the check of a pair that is still waiting. */
  onCheck: () => void
}) {
  const now = useNow()
  if (!state) return null
  const named = state.state === 'ready' && isNamed(state.evidence)
  return (
    <section className={`similarity__paths similarity__first${named ? ' similarity__paths--warn' : ''}`}>
      <h4 className="similarity__paths-title">Who had these files on GitHub first?</h4>
      {state.state === 'checking' ? (
        <p className="similarity__result" role="status">
          Reading when each repo was pushed…
        </p>
      ) : state.state === 'waiting' ? (
        <p className="similarity__result">
          Not checked yet.{' '}
          <button type="button" className="linkish" onClick={onCheck}>
            Check now
          </button>
        </p>
      ) : (
        <>
          <ul className="similarity__facts">
            {evidenceLines(state.evidence, now).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="similarity__result">
            <strong>Result:</strong> {resultLine(state.evidence, tier)}
          </p>
          {named ? <p className="similarity__dim similarity__first-note">{FIRST_NOTE}</p> : null}
        </>
      )}
    </section>
  )
}
