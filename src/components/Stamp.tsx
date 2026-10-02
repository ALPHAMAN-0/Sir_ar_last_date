import { STATUS_TONE, statusLabel } from '../logic/people.ts'
import type { Status } from '../logic/verdict.ts'

type Props = {
  status: Status
  deadlinePassed: boolean
  /** Extra text after the label, e.g. "by 3h 20m". */
  detail?: string
  large?: boolean
}

/** The status, drawn like a rubber stamp on the register. Always text, never colour alone. */
export function Stamp({ status, deadlinePassed, detail, large = false }: Props) {
  const tone = STATUS_TONE[status]
  return (
    <span className={`stamp stamp--${tone}${large ? ' stamp--large' : ''}`}>
      <span className="stamp__label">{statusLabel(status, deadlinePassed)}</span>
      {/* A real space, so screen readers and copied text do not read "Lateby". */}
      {detail ? <span className="stamp__detail"> {detail}</span> : null}
    </span>
  )
}
