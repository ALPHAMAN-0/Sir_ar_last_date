// Input rules shared by the browser and the Worker.
// The Worker only ever forwards values that pass these checks to GitHub.

export const ZERO_OID = '0'.repeat(40)

// Enterprise-managed accounts may contain "_", so it is allowed here.
const OWNER_RE = /^[a-z\d][a-z\d_-]{0,38}$/
const NAME_RE = /^[a-z\d._-]{1,100}$/
const SHA_RE = /^[0-9a-f]{40}$/
const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const ACTIVITY_CURSOR_RE = /^[A-Za-z0-9+/=_-]{1,400}$/
const COMMIT_CURSOR_RE = /^[0-9a-f]{40} \d{1,7}$/
// Git forbids these in ref names; everything else is passed URL-encoded.
// eslint-disable-next-line no-control-regex
const BRANCH_RE = /^(?!-)(?!.*\.\.)[^\x00-\x20\x7f~^:?*[\\]{1,255}$/

export function isOwner(value: string): boolean {
  return OWNER_RE.test(value)
}

export function isRepoName(value: string): boolean {
  return (
    NAME_RE.test(value) &&
    value !== '.' &&
    value !== '..' &&
    !value.endsWith('.git')
  )
}

/** Canonical repo key: lowercase `owner/name`. */
export function isRepoKey(value: string): boolean {
  const slash = value.indexOf('/')
  if (slash <= 0 || slash !== value.lastIndexOf('/')) return false
  return isOwner(value.slice(0, slash)) && isRepoName(value.slice(slash + 1))
}

export function splitRepoKey(key: string): { owner: string; name: string } {
  const slash = key.indexOf('/')
  return { owner: key.slice(0, slash), name: key.slice(slash + 1) }
}

export function isSha(value: string): boolean {
  return SHA_RE.test(value)
}

export function isIsoTime(value: string): boolean {
  return ISO_TIME_RE.test(value) && !Number.isNaN(Date.parse(value))
}

export function isBranchName(value: string): boolean {
  return BRANCH_RE.test(value)
}

export function isActivityCursor(value: string): boolean {
  return ACTIVITY_CURSOR_RE.test(value)
}

/** A history cursor is "<head sha> <offset>" and must belong to the page's head. */
export function isCommitCursor(value: string, headOid: string): boolean {
  return COMMIT_CURSOR_RE.test(value) && value.startsWith(`${headOid} `)
}
