// Who had a shared file on GitHub first. Pure: no network, no DOM.
//
// Two repos hold the same file. To say which of them had it first, only things
// GitHub itself recorded are used: the push log (the time GitHub received each
// push, which the author cannot change) and the files at each pushed commit.
//
// For one file in one repo that gives an interval: the repo had the file `by` a
// certain time, and did not have it before `notBefore`. Seeing a file proves
// "had it"; "did not have it" is only proven when every earlier state of the
// repo was seen. Whatever was not seen stays an open interval, and an open
// interval never names anyone.
//
// A result that names a repo as the later one is an accusation against a
// student. Every rule below leans the same way: when in doubt, "cannot tell".

import type { ActivityEvent, CommitInfo, TreeFile } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import { attributePushes } from '../logic/pushAttribution.ts'
import type { RepoFacts } from './run.ts'
import type { RepoFiles } from './types.ts'

/**
 * Two pushes closer together than this are not ranked. Students who sit side
 * by side push within minutes of each other, in either order.
 */
export const CLEAR_GAP_MS = 3_600_000

/**
 * GitHub has kept push logs only since 2023. A repo created before this date
 * may have received pushes its log does not show, so nothing is ever claimed
 * about what such a repo did NOT hold.
 */
export const LOG_KEPT_SINCE = Date.parse('2024-01-01T00:00:00Z')

/** One push from GitHub's log: a branch moved from `before` to `after` at `ts`. */
export type Push = { ts: number; ref: string; before: string; after: string; type: string }

/** What one pushed commit says about the files the repo holds today. */
export type Digest = {
  /** Contents of today's files that were already there, under any name. */
  held: ReadonlySet<string>
  /** Paths of today's files that were there with OTHER content: an earlier version. */
  changed: ReadonlySet<string>
}

export type RepoHistory = {
  repo: string
  headOid: string
  /**
   * `ok`: the push log was read. `none`: GitHub has no log for this repo.
   * `failed`: it could not be loaded. `unsettled`: pushed minutes ago, and the
   * log may still be catching up.
   */
  log: 'ok' | 'none' | 'failed' | 'unsettled'
  /** Oldest first, all branches. */
  pushes: Push[]
  /** False when the log has more pushes than were read. */
  logComplete: boolean
  /** The log begins where the repo began, so "not there before" can be proven. */
  startKnown: boolean
  /** How many pushes from the start follow each other without a gap. */
  trusted: number
  /** How many pushes from the start had their files read. */
  scanned: number
  /** One per scanned push. */
  digests: Digest[]
  /** Why reading stopped. `all_seen`: every file looked for was found. */
  stopped: 'all_seen' | 'end' | 'cap' | 'budget' | 'too_large' | 'gone' | 'failed' | null
}

/** When one file reached one repo. `by === notBefore` is an exact time. */
export type Arrival = {
  /** The repo did not hold the file before this time. */
  notBefore: number
  /** The repo held the file at this time at the latest. */
  by: number
  /** The push that brought it, as an index into `pushes`. Null when it was not seen arriving. */
  push: number | null
  /** The file's path held other content before: it was worked on here, not dropped in. */
  hadEarlierVersion: boolean
}

/** A content both repos hold, outside the starter files. */
export type SharedBlob = { sha: string; aPath: string; bPath: string; size: number }

/** The commit list of one repo. `truncated`: only its newest part. */
export type Commits = { commits: readonly CommitInfo[]; truncated: boolean }

/** Another repo of the sheet that holds the same file. */
export type Rival = { repo: string; arrival: Arrival }

/**
 * `a_first` / `b_first`: that repo had the files first, and nothing speaks
 * against it. `mixed`: each had some first. `common_source`: both come from a
 * third repo. `unknown`: cannot tell; `reason` says why.
 */
export type FirstVerdict = 'a_first' | 'b_first' | 'mixed' | 'common_source' | 'unknown'

export type FirstReason =
  /** Both repos belong to one GitHub account. */
  | 'same_owner'
  /** One of them is a fork or a template copy of a repo outside this pair. */
  | 'outside_source'
  /** Pushed within `CLEAR_GAP_MS` of each other. */
  | 'too_close'
  /** Another repo of the sheet may have had the files before either. */
  | 'third_repo'
  /** GitHub does not show enough of what happened. */
  | 'not_observed'
  /** One repo was first on a few files only; the rest could not be dated. */
  | 'mostly_unobserved'
  /** The commit history could not be read, so the checks below could not run. */
  | 'commits_unread'
  /** The push times point one way and something else points the other way. */
  | 'conflict'

/** Which check withheld the result, for the `conflict` reason. */
export type Conflict = 'earlier_versions' | 'commits_by_later_owner' | 'older_commits'

export type SideEvidence = {
  createdAt: number
  /** The latest moment the repo's files can have arrived: its last push. */
  end: number
  log: RepoHistory['log'] | 'not_read'
  stopped: RepoHistory['stopped']
  startKnown: boolean
  /** Pushes in the log, and how many of them had their files read. */
  logPushes: number
  scanned: number
  logComplete: boolean
  /** Shared files seen arriving in a push, and those that were not. */
  seen: number
  unseen: number
  /** The first and the last of those arrivals. Null when none was seen. */
  firstAt: number | null
  lastAt: number | null
  /** In how many different pushes they arrived. */
  arrivalPushes: number
  /** Shared files this repo provably had first. */
  first: number
  /** Of the files seen arriving: paths that held an earlier version, and paths that did not. */
  grew: number
  whole: number
  totalCommits: number
  /** Commits in this repo written by the OTHER repo's owner. Null when the commits were not read. */
  commitsByOther: number | null
  isFork: boolean
  /** What this repo was forked from, or generated from. */
  parent: string | null
  template: string | null
}

export type PairEvidence = {
  verdict: FirstVerdict
  basis: 'fork' | 'created_after' | 'push_times' | null
  reason: FirstReason | null
  conflict: Conflict | null
  /** Shared files looked at. */
  shared: number
  /** Shared files for which neither repo was provably first. */
  undecided: number
  /** For the first repo's files: the shortest time by which the other was later. */
  gapMs: number | null
  /** Shared files that other repos of the sheet hold too, and how many repos those are. */
  elsewhere: number
  otherRepos: number
  /** Commits that are in both histories. Null when the commits were not read. */
  sharedCommits: number | null
  /** The account that wrote shared commits, when it is neither repo's owner. */
  thirdAuthor: string | null
  a: SideEvidence
  b: SideEvidence
}

/** Pairs are named the way the comparison lists them: A's repo, then B's. */
export function pairKey(aKey: string, bKey: string): string {
  return `${aKey}|${bKey}`
}

/** The latest moment a repo's present files can have reached GitHub. */
export function lastPush(facts: RepoFacts): number {
  // A fork copies its parent's pushedAt until its owner pushes something.
  return Math.max(facts.createdAt, facts.pushedAt ?? facts.createdAt)
}

/**
 * Puts the push log in order and works out how far it can be trusted.
 *
 * The log is a chain: on every branch, each event starts where the one before
 * ended, and the first one starts from nothing. Where the chain breaks, pushes
 * are missing, and from there on a file that was not seen may still have been
 * there.
 */
export function readLog(
  events: readonly ActivityEvent[],
  facts: RepoFacts,
): Pick<RepoHistory, 'pushes' | 'startKnown' | 'trusted'> {
  const ordered = events
    .map((event) => ({
      ts: Date.parse(event.ts),
      ref: event.ref,
      before: event.before,
      after: event.after,
      type: event.type,
    }))
    .filter((event) => !Number.isNaN(event.ts))
    .sort((x, y) => x.ts - y.ts)

  const pushes: Push[] = []
  const heads = new Map<string, string>()
  const mainRef = `refs/heads/${facts.branch}`
  let trusted = 0
  let broken = false
  let mainCreated = false
  for (const event of ordered) {
    if (!broken) {
      if (event.before !== (heads.get(event.ref) ?? ZERO_OID)) broken = true
      else {
        heads.set(event.ref, event.after)
        if (event.ref === mainRef && event.before === ZERO_OID) mainCreated = true
      }
    }
    // A deleted branch moves to nothing: there are no files to read.
    if (event.after === ZERO_OID) continue
    pushes.push(event)
    if (!broken) trusted = pushes.length
  }

  // A fork or a template copy starts with files nobody pushed into it.
  const startKnown =
    !facts.isFork &&
    facts.template === null &&
    facts.createdAt >= LOG_KEPT_SINCE &&
    trusted > 0 &&
    mainCreated
  return { pushes, startKnown, trusted }
}

/**
 * What one pushed commit says about the repo's present files. Taken against
 * all of them, so that it does not depend on which pair is being looked at.
 */
export function digest(files: readonly TreeFile[], head: RepoFiles): Digest {
  const contents = new Set<string>()
  const byPath = new Map<string, string>()
  for (const file of files) {
    contents.add(file.sha)
    byPath.set(file.path, file.sha)
  }
  const held = new Set<string>()
  const changed = new Set<string>()
  for (const file of head.files) {
    if (contents.has(file.sha)) held.add(file.sha)
    const there = byPath.get(file.path)
    if (there !== undefined && there !== file.sha) changed.add(file.path)
  }
  return { held, changed }
}

/**
 * When the content `sha`, which the repo holds today at `headPath`, reached it.
 * Without a history only the repo's own dates are known: it cannot have held
 * anything before it was created, and it holds everything since its last push.
 */
export function arrivalOf(
  sha: string,
  headPath: string,
  history: RepoHistory | undefined,
  facts: RepoFacts,
): Arrival {
  const end = lastPush(facts)
  if (!history || history.log !== 'ok') {
    return { notBefore: facts.createdAt, by: end, push: null, hadEarlierVersion: false }
  }
  let hadEarlierVersion = false
  for (let i = 0; i < history.scanned; i++) {
    const seen = history.digests[i]
    if (seen.held.has(sha)) {
      const ts = history.pushes[i].ts
      // "Not before" holds only when every earlier state of the repo was read.
      const exact = history.startKnown && i < history.trusted
      return { notBefore: exact ? ts : facts.createdAt, by: ts, push: i, hadEarlierVersion }
    }
    if (seen.changed.has(headPath)) hadEarlierVersion = true
  }
  const limit = Math.min(history.scanned, history.trusted)
  const notBefore = history.startKnown && limit > 0 ? history.pushes[limit - 1].ts : facts.createdAt
  return { notBefore, by: end, push: null, hadEarlierVersion }
}

/** The contents two repos share, each once, without the starter files. */
export function sharedBlobs(a: RepoFiles, b: RepoFiles, starter: ReadonlySet<string>): SharedBlob[] {
  const inB = new Map<string, TreeFile[]>()
  for (const file of b.files) {
    if (starter.has(file.sha)) continue
    const same = inB.get(file.sha)
    if (same) same.push(file)
    else inB.set(file.sha, [file])
  }
  const done = new Set<string>()
  const blobs: SharedBlob[] = []
  for (const file of a.files) {
    if (starter.has(file.sha) || done.has(file.sha)) continue
    const twins = inB.get(file.sha)
    if (!twins) continue
    done.add(file.sha)
    // Prefer the twin at the same path, as the file list of a pair does.
    const twin = twins.find((other) => other.path === file.path) ?? twins[0]
    blobs.push({ sha: file.sha, aPath: file.path, bPath: twin.path, size: file.size })
  }
  return blobs
}

/**
 * What the two repos' own facts already settle, before any history is read.
 * Null when they settle nothing and the push times have to be looked at.
 */
export function originOf(
  a: RepoFacts,
  b: RepoFacts,
): Pick<PairEvidence, 'verdict' | 'basis' | 'reason'> | null {
  const unknown = (reason: FirstReason) => ({ verdict: 'unknown', basis: null, reason }) as const
  if (a.owner === b.owner) return unknown('same_owner')
  // A fork is a copy by definition, and GitHub itself says of what.
  if (b.parent && b.parent === a.repo) return { verdict: 'a_first', basis: 'fork', reason: null }
  if (a.parent && a.parent === b.repo) return { verdict: 'b_first', basis: 'fork', reason: null }
  if ((a.parent && a.parent === b.parent) || (a.template && a.template === b.template)) {
    return { verdict: 'common_source', basis: null, reason: null }
  }
  // Files that came with a fork or a template were never pushed by its owner.
  if (a.isFork || b.isFork || a.template || b.template) return unknown('outside_source')
  // An answer from before the server said where a repo comes from.
  if (a.template === undefined || b.template === undefined) return unknown('not_observed')
  return null
}

export type JudgeInput = {
  a: RepoFacts
  b: RepoFacts
  blobs: readonly SharedBlob[]
  aHistory?: RepoHistory
  bHistory?: RepoHistory
  /** By content: the other repos of the sheet that hold it, and when they could have had it. */
  rivals?: ReadonlyMap<string, readonly Rival[]>
  /** Undefined: not asked for. Null: could not be read. */
  aCommits?: Commits | null
  bCommits?: Commits | null
}

type Dated = { blob: SharedBlob; a: Arrival; b: Arrival; rivals: readonly Rival[] }
type Winner = 'a' | 'b' | null
type Why = 'too_close' | 'third_repo' | 'not_observed'

/** Which of the two provably had this one file first, or why neither. */
function rank({ a, b, rivals }: Dated): { winner: Winner; why: Why | null } {
  const beats = (early: Arrival, late: Arrival) => early.by + CLEAR_GAP_MS <= late.notBefore
  // Two who both copied from a third must not be ranked against each other.
  const unrivalled = (early: Arrival) => rivals.every((rival) => early.by <= rival.arrival.notBefore)
  for (const [side, early, late] of [['a', a, b], ['b', b, a]] as const) {
    if (!beats(early, late)) continue
    return unrivalled(early) ? { winner: side, why: null } : { winner: null, why: 'third_repo' }
  }
  const ordered = a.by <= b.notBefore || b.by <= a.notBefore
  return { winner: null, why: ordered ? 'too_close' : 'not_observed' }
}

const login = (commit: CommitInfo) => commit.authorLogin?.toLowerCase() ?? null

/** The repo's commits by the push that brought them, keyed by the push's time. */
function commitsByPush(history: RepoHistory | undefined, commits: Commits): Map<number, CommitInfo[]> {
  const grouped = new Map<number, CommitInfo[]>()
  if (!history || history.log !== 'ok') return grouped
  const events: ActivityEvent[] = history.pushes.map((push) => ({
    ts: new Date(push.ts).toISOString(),
    type: push.type,
    ref: push.ref,
    before: push.before,
    after: push.after,
    actor: null,
  }))
  const pushed = attributePushes(commits.commits, events)
  for (const commit of commits.commits) {
    const at = pushed.get(commit.oid)?.pushedAt
    if (!at) continue
    const ts = Date.parse(at)
    const list = grouped.get(ts)
    if (list) list.push(commit)
    else grouped.set(ts, [commit])
  }
  return grouped
}

type Side = { facts: RepoFacts; history: RepoHistory | undefined; commits: Commits; pick: (dated: Dated) => Arrival }

/**
 * The checks a result must pass before a repo is named as the later one. Each
 * looks for a sign that the "later" repo is where the files were written.
 */
function conflictOf(early: Side, late: Side, counted: readonly Dated[]): Conflict | 'unread' | null {
  // The files were worked on in the later repo, and only dropped into the earlier one.
  const grewLate = counted.some((dated) => late.pick(dated).hadEarlierVersion)
  const grewEarly = counted.some((dated) => early.pick(dated).hadEarlierVersion)
  if (grewLate && !grewEarly) return 'earlier_versions'

  // The earlier repo carries commits of the later repo's owner: it took that history.
  if (early.commits.commits.some((commit) => login(commit) === late.facts.owner)) {
    return 'commits_by_later_owner'
  }

  // The later repo's own commits are dated before the earlier repo had the
  // files: its owner may have written them at home and pushed late. Commit
  // dates can be set by the author, so they only ever hold a result back.
  const inEarly = new Set(early.commits.commits.map((commit) => commit.oid))
  const own = (commit: CommitInfo) => !inEarly.has(commit.oid) && login(commit) !== early.facts.owner
  const byPush = commitsByPush(late.history, late.commits)
  for (const dated of counted) {
    const arrival = late.pick(dated)
    const brought =
      arrival.push !== null && late.history
        ? (byPush.get(late.history.pushes[arrival.push].ts) ?? [])
        : late.commits.commits
    // The push that brought a file always brings commits. None here means they
    // sit on a branch whose history was not read, so this check cannot run.
    if (brought.length === 0) return 'unread'
    const had = early.pick(dated).by
    if (brought.some((commit) => own(commit) && Date.parse(commit.authoredAt) < had)) return 'older_commits'
  }
  return null
}

function sideEvidence(
  facts: RepoFacts,
  history: RepoHistory | undefined,
  arrivals: readonly Arrival[],
  first: number,
  commitsByOther: number | null,
): SideEvidence {
  const seen = arrivals.filter((arrival) => arrival.push !== null)
  const times = seen.map((arrival) => arrival.by)
  const grew = seen.filter((arrival) => arrival.hadEarlierVersion).length
  return {
    createdAt: facts.createdAt,
    end: lastPush(facts),
    log: history?.log ?? 'not_read',
    stopped: history?.stopped ?? null,
    startKnown: history?.startKnown ?? false,
    logPushes: history?.pushes.length ?? 0,
    scanned: history?.scanned ?? 0,
    logComplete: history?.logComplete ?? false,
    seen: seen.length,
    unseen: arrivals.length - seen.length,
    firstAt: times.length > 0 ? Math.min(...times) : null,
    lastAt: times.length > 0 ? Math.max(...times) : null,
    arrivalPushes: new Set(seen.map((arrival) => arrival.push)).size,
    first,
    grew,
    whole: seen.length - grew,
    totalCommits: facts.totalCommits,
    commitsByOther,
    isFork: facts.isFork,
    parent: facts.parent ?? null,
    template: facts.template ?? null,
  }
}

/**
 * Who had the shared files of one pair first. The rules are tried in order and
 * the first that applies decides; see the README for the list in plain words.
 */
export function judgePair(input: JudgeInput): PairEvidence {
  const { a, b, blobs } = input
  const dated: Dated[] = blobs.map((blob) => ({
    blob,
    a: arrivalOf(blob.sha, blob.aPath, input.aHistory, a),
    b: arrivalOf(blob.sha, blob.bPath, input.bHistory, b),
    rivals: input.rivals?.get(blob.sha) ?? [],
  }))
  const ranked = dated.map((entry) => ({ entry, ...rank(entry) }))
  const firstA = ranked.filter((row) => row.winner === 'a')
  const firstB = ranked.filter((row) => row.winner === 'b')

  const aCommits = input.aCommits ?? null
  const bCommits = input.bCommits ?? null
  let sharedCommits: number | null = null
  let thirdAuthor: string | null = null
  if (aCommits && bCommits) {
    const inA = new Set(aCommits.commits.map((commit) => commit.oid))
    const both = bCommits.commits.filter((commit) => inA.has(commit.oid))
    sharedCommits = both.length
    // Commits that neither owner wrote: both repos were started from someone else's.
    thirdAuthor =
      both.map(login).find((author) => author !== null && author !== a.owner && author !== b.owner) ?? null
  }
  const writtenBy = (commits: Commits | null, owner: string) =>
    commits ? commits.commits.filter((commit) => login(commit) === owner).length : null

  const rivalRepos = new Set<string>()
  for (const entry of dated) for (const rival of entry.rivals) rivalRepos.add(rival.repo)

  const evidence: PairEvidence = {
    verdict: 'unknown',
    basis: null,
    reason: null,
    conflict: null,
    shared: blobs.length,
    undecided: blobs.length - firstA.length - firstB.length,
    gapMs: null,
    elsewhere: dated.filter((entry) => entry.rivals.length > 0).length,
    otherRepos: rivalRepos.size,
    sharedCommits,
    thirdAuthor,
    a: sideEvidence(a, input.aHistory, dated.map((entry) => entry.a), firstA.length, writtenBy(aCommits, b.owner)),
    b: sideEvidence(b, input.bHistory, dated.map((entry) => entry.b), firstB.length, writtenBy(bCommits, a.owner)),
  }
  const unknown = (reason: FirstReason, conflict: Conflict | null = null): PairEvidence => ({
    ...evidence,
    reason,
    conflict,
  })

  const origin = originOf(a, b)
  if (origin) return { ...evidence, ...origin }

  if (firstA.length > 0 && firstB.length > 0) return { ...evidence, verdict: 'mixed' }
  if (firstA.length === 0 && firstB.length === 0) {
    const count = (why: Why) => ranked.filter((row) => row.why === why).length
    // The reason that covers the most files; with equal counts, the more telling one.
    const reasons: Why[] = ['third_repo', 'too_close', 'not_observed']
    const reason = reasons.reduce((best, why) => (count(why) > count(best) ? why : best))
    return unknown(blobs.length === 0 ? 'not_observed' : reason)
  }

  const aWins = firstA.length > 0
  const counted = (aWins ? firstA : firstB).map((row) => row.entry)
  if (counted.length * 2 < blobs.length) return unknown('mostly_unobserved')

  if (!aCommits || !bCommits || aCommits.truncated || bCommits.truncated) return unknown('commits_unread')
  if (thirdAuthor) return { ...evidence, verdict: 'common_source' }

  const sideA: Side = { facts: a, history: input.aHistory, commits: aCommits, pick: (entry) => entry.a }
  const sideB: Side = { facts: b, history: input.bHistory, commits: bCommits, pick: (entry) => entry.b }
  const [early, late] = aWins ? [sideA, sideB] : [sideB, sideA]
  const conflict = conflictOf(early, late, counted)
  if (conflict === 'unread') return unknown('commits_unread')
  if (conflict) return unknown('conflict', conflict)

  // Did the later repo simply not exist yet, or was its own push seen arriving later?
  const byCreation = counted.every((entry) => late.pick(entry).notBefore === late.facts.createdAt)
  return {
    ...evidence,
    verdict: aWins ? 'a_first' : 'b_first',
    basis: byCreation ? 'created_after' : 'push_times',
    gapMs: Math.min(...counted.map((entry) => late.pick(entry).notBefore - early.pick(entry).by)),
  }
}
