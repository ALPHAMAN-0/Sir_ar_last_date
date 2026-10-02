import type { RepoOk } from '../../shared/api.ts'
import { isRepoKey } from '../../shared/validate.ts'

/**
 * The repo's current `owner/name`, lowercase and validated. Used for API calls
 * and for every link to GitHub, so a link is only ever built from checked parts.
 * It differs from the sheet's link when the repo was renamed or moved.
 */
export function apiRepoName(meta: RepoOk): string {
  const lower = meta.nameWithOwner.toLowerCase()
  return isRepoKey(lower) ? lower : meta.key
}
