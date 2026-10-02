import { isOwner, isRepoName } from '../../shared/validate.ts'

export type LinkProblem = 'empty' | 'not_github' | 'not_a_repo' | 'gist' | 'pages' | 'malformed'

export type LinkResult =
  | { ok: true; owner: string; repo: string; key: string }
  | { ok: false; reason: LinkProblem }

// First path segments on github.com that are site pages, not account names.
const SITE_PAGES = new Set([
  'about', 'account', 'apps', 'codespaces', 'collections', 'contact', 'customer-stories',
  'dashboard', 'enterprise', 'events', 'explore', 'features', 'issues', 'join', 'login',
  'marketplace', 'new', 'notifications', 'organizations', 'orgs', 'pricing', 'pulls',
  'readme', 'search', 'security', 'settings', 'site', 'sponsors', 'team', 'topics',
  'trending', 'users',
])

// What people type when they have no link yet.
const PLACEHOLDERS = new Set(['n/a', 'na', 'none', 'nil', 'null', 'tbd', '-', '--', '?'])

const fail = (reason: LinkProblem): LinkResult => ({ ok: false, reason })

function build(ownerRaw: string, repoRaw: string): LinkResult {
  let owner: string
  let repo: string
  try {
    owner = decodeURIComponent(ownerRaw).toLowerCase()
    repo = decodeURIComponent(repoRaw).toLowerCase().replace(/\.git$/, '')
  } catch {
    return fail('malformed')
  }
  if (!isOwner(owner) || !isRepoName(repo)) return fail('malformed')
  return { ok: true, owner, repo, key: `${owner}/${repo}` }
}

/**
 * Turns whatever is in the sheet cell into `owner/repo`. Accepts full links
 * (with or without https, www, .git, /tree/..., ?query), SSH links and the
 * short `owner/repo` form. The result is only ever built from validated parts;
 * the cell text itself is never used as a link.
 */
export function parseRepoLink(input: string | null | undefined): LinkResult {
  const text = (input ?? '').trim().replace(/^[<"'\s]+|[>"'\s]+$/g, '')
  if (!text || PLACEHOLDERS.has(text.toLowerCase())) return fail('empty')

  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/\s]+)\/([^/\s]+?)\/?$/i.exec(text)
  if (ssh) return build(ssh[1], ssh[2])

  if (/^[A-Za-z\d][\w-]*\/[\w.-]+$/.test(text)) {
    const [owner, repo] = text.split('/')
    return build(owner, repo)
  }

  let url: URL
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return fail('malformed')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail('not_github')
  if (url.username || url.password) return fail('malformed')

  const host = url.hostname.toLowerCase()
  if (host === 'gist.github.com') return fail('gist')
  if (host.endsWith('.github.io')) return fail('pages')
  if (host !== 'github.com' && host !== 'www.github.com') return fail('not_github')

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 2 || SITE_PAGES.has(segments[0].toLowerCase())) return fail('not_a_repo')
  return build(segments[0], segments[1])
}

export const LINK_PROBLEM_TEXT: Record<LinkProblem, string> = {
  empty: 'No link in this row',
  not_github: 'Not a GitHub link',
  not_a_repo: 'Link to a profile or page, not a repo',
  gist: 'Gist link, not a repo',
  pages: 'Website link (github.io), not a repo',
  malformed: 'Link could not be read',
}
