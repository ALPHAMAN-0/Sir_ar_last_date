import { useState } from 'react'
import { describeColumns, type ColumnMapping } from '../sheet/columns.ts'
import { useApp } from '../state/hooks.ts'
import { remapColumns } from '../state/store.ts'

type Field = 'id' | 'name' | 'link'
const FIELDS: Array<{ field: Field; label: string }> = [
  { field: 'id', label: 'ID' },
  { field: 'name', label: 'Name' },
  { field: 'link', label: 'Repo link' },
]

/** Lets the user say which sheet column is which, when the automatic guess is wrong. */
export function ColumnPicker({ onDone }: { onDone: () => void }) {
  const columns = useApp((state) => state.columns)
  const [draft, setDraft] = useState<ColumnMapping | null>(columns?.mapping ?? null)
  if (!columns || !draft) return null

  const names = describeColumns(columns.data, columns.mapping)

  return (
    <form
      className="picker"
      onSubmit={(event) => {
        event.preventDefault()
        remapColumns(draft)
        onDone()
      }}
    >
      <p className="picker__title">Which column is which?</p>
      <div className="picker__fields">
        {FIELDS.map(({ field, label }) => (
          <label key={field} className="picker__field">
            <span>{label}</span>
            <select
              value={draft[field] ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  [field]: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            >
              <option value="">Not in the sheet</option>
              {names.map((name, index) => (
                <option key={index} value={index}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="picker__actions">
        <button type="submit" className="button button--primary">
          Use these columns
        </button>
        <button type="button" className="button button--quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
