// The branches of a repo, as the results report writes them.

import type { RepoBranches } from '../../shared/api.ts'

/**
 * "main; dev; feature-login": the main branch first, then the rest as GitHub
 * lists them (A to Z). A repo with more branches than were listed says so.
 * Blank when the branches are not known.
 */
export function branchNamesText(branches: RepoBranches | null, defaultBranch: string): string {
  if (branches === null) return ''
  const others = branches.names.filter((name) => name !== defaultBranch)
  const names = others.length === branches.names.length ? others : [defaultBranch, ...others]
  const more = branches.total - branches.names.length
  if (more > 0) names.push(`and ${more.toLocaleString('en')} more`)
  return names.join('; ')
}
