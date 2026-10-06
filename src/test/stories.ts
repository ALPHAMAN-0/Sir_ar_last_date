// Helpers for the tests of "who had the files first": a repo is written down
// as the pushes it received, and everything GitHub would say about it (push
// log, file list at each push, commit list) follows from that.

import type { ActivityEvent, CommitInfo, TreeFile } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import { digest, readLog, type Commits, type RepoHistory } from '../similarity/first.ts'
import { noSkips } from '../similarity/rules.ts'
import type { RepoFacts } from '../similarity/run.ts'
import type { RepoFiles } from '../similarity/types.ts'

/** A 40-character id made from a label, the same for the same label. */
export function id(label: string): string {
  let hash = 7
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash.toString(16).padStart(8, '0').repeat(5)
}

/** "12 10:14" is 12 September 2026, 10:14 UTC. */
export const iso = (when: string) => `2026-09-${when.replace(' ', 'T')}:00Z`
export const at = (when: string) => Date.parse(iso(when))

/** Path to content. Two files with the same content label are identical. */
export type Files = Record<string, string>
export const tree = (files: Files): TreeFile[] =>
  Object.entries(files).map(([path, content]) => ({ path, sha: id(content), size: 500 }))

export function facts(repo: string, over: Partial<RepoFacts> = {}): RepoFacts {
  return {
    repo,
    nameWithOwner: repo,
    owner: repo.slice(0, repo.indexOf('/')),
    branch: 'main',
    headOid: id(`${repo}@head`),
    createdAt: at('01 08:00'),
    pushedAt: at('30 08:00'),
    version: iso('30 08:00'),
    isFork: false,
    parent: null,
    template: null,
    totalCommits: 5,
    ...over,
  }
}

export const headOf = (repo: string, files: Files): RepoFiles => ({
  repo,
  branch: 'main',
  headOid: id(`${repo}@head`),
  files: tree(files),
  skipped: noSkips(),
  unopened: 0,
})

/** One push: when, what the branch held afterwards, and the commit it brought. */
export type Step = {
  at: string
  files: Files
  /** Branch name. Default `main`. */
  ref?: string
  /** What the event says the branch pointed to before. Default: the previous push on that branch. */
  before?: string
  type?: string
  /** A label for the pushed commit, to give two repos the very same commit. */
  commit?: string
  /** When the commit says it was written. Default: five minutes before the push. */
  written?: string
  /** The account that wrote the commit. Default: the repo's owner. */
  by?: string | null
}

export type Repo = {
  facts: RepoFacts
  /** The files it holds today. */
  head: RepoFiles
  /** Its history, read from start to end. */
  history: RepoHistory
  commits: Commits
  /** The push log as GitHub gives it, oldest first. */
  events: ActivityEvent[]
  /** The file list at each pushed commit, by commit id. */
  snapshots: Map<string, TreeFile[]>
}

/** A repo with its whole story. The files it holds today are those of its last push. */
export function repo(
  name: string,
  steps: Step[],
  over: Partial<RepoFacts> = {},
  read: Partial<RepoHistory> = {},
): Repo {
  const f = facts(name, over)
  const head = headOf(name, steps.at(-1)?.files ?? {})
  const heads = new Map<string, string>()
  const commits: CommitInfo[] = []
  const snapshots = new Map<string, TreeFile[]>()
  const events: ActivityEvent[] = steps.map((step, index) => {
    const ref = `refs/heads/${step.ref ?? 'main'}`
    const previous = heads.get(ref) ?? ZERO_OID
    const before = step.before ?? previous
    const after = id(step.commit ?? `${name}#${index}`)
    heads.set(ref, after)
    snapshots.set(after, tree(step.files))
    const written = step.written ? iso(step.written) : new Date(at(step.at) - 300_000).toISOString()
    commits.push({
      oid: after,
      committedAt: written,
      authoredAt: written,
      headline: 'work',
      parents: previous === ZERO_OID ? [] : [previous],
      authorName: null,
      authorLogin: step.by === undefined ? f.owner : step.by,
    })
    return {
      ts: iso(step.at),
      type: step.type ?? (before === ZERO_OID ? 'branch_creation' : 'push'),
      ref,
      before,
      after,
      actor: null,
    }
  })
  const history: RepoHistory = {
    repo: name,
    headOid: f.headOid,
    log: 'ok',
    ...readLog(events, f),
    logComplete: true,
    scanned: steps.length,
    digests: steps.map((step) => digest(tree(step.files), head)),
    stopped: 'end',
    ...read,
  }
  return { facts: f, head, history, commits: { commits, truncated: false }, events, snapshots }
}
