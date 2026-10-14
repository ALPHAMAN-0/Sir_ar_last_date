import { useApp } from '../state/hooks.ts'

/**
 * A small pill in the masthead that says which kind of sheet is loaded.
 * For a project-base sheet it reads "Project base"; for a performance-base
 * sheet "Performance base". Pure presentational, no click handler.
 */
export function KindBadge() {
  const kind = useApp((state) => state.sheet?.kind ?? null)
  if (kind === null) return null
  const label = kind === 'project' ? 'Project base' : 'Performance base'
  return <span className={`kind-badge kind-badge--${kind}`}>{label}</span>
}