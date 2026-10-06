import { describe, expect, it } from 'vitest'
import type { ActivityEvent, CommitInfo, RepoOk } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import type { LinkResult } from '../sheet/parseRepoLink.ts'
import type { CommitList } from '../state/person.ts'
import { FIRST_PUSH_BY_COMMIT_NOTE, firstPush, firstPushText } from './firstPush.ts'
import { formatDateTime } from './time.ts'
import { judge, type ActivityData } from './verdict.ts'

// Deadline: 5 Oct 2026 23:59 in Dhaka = 17:59:59.999 UTC.
const DEADLINE = Date.parse('2026-10-05T17:59:59.999Z')
const FIRST = '2026-10-02T09:00:00Z'
const SECOND = '2026-10-04T12:00:00Z'
const AFTER_1 = '2026-10-05T21:19:00Z'
const AFTER_2 = '2026-10-06T03:30:00Z'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)

const link: LinkResult = { ok: true, owner: 'a', repo: 'x', key: 'a/x' }

const repo = (over: Partial<RepoOk> = {}): RepoOk => ({
  key: 'a/x',
  state: 'ok',
  nameWithOwner: 'a/x',
  isEmpty: false,
  isFork: false,
  isArchived: false,
  createdAt: '2026-10-01T00:00:00Z',
  pushedAt: SECOND,
  defaultBranch: 'main',
  headOid: C,
  headCommittedAt: SECOND,
  totalCommits: 3,
  ...over,
})

const ev = (
  ts: string,
  after: string,
  before: string = ZERO_OID,
  ref = 'refs/heads/main',
): ActivityEvent => ({ ts, type: before === ZERO_OID ? 'branch_creation' : 'push', ref, before, after, actor: 'student' })

/** Events are given newest first, as the loader stores them. */
const log = (events: ActivityEvent[], over: Partial<ActivityData> = {}): ActivityData => ({
  events,
  exhausted: true,
  capped: false,
  settled: true,
  probe: null,
  failed: false,
  ...over,
})

const commit = (oid: string, committedAt: string): CommitInfo => ({
  oid,
  committedAt,
  authoredAt: committedAt,
  headline: 'Work',
  parents: [],
  authorName: null,
  authorLogin: 'student',
})
const commits = (list: CommitInfo[], truncated = false): CommitList => ({ commits: list, truncated })

/** A person as the store judges them. */
const person = (meta: RepoOk, activity?: ActivityData) => ({
  meta,
  activity,
  verdict: judge({ link, meta, activity, deadline: DEADLINE }),
})

describe('firstPush', () => {
  it('is the push that created the main branch', () => {
    const pushed = person(repo(), log([ev(SECOND, B, A), ev(FIRST, A)]))
    expect(firstPush(pushed, undefined)).toEqual({ kind: 'recorded', at: FIRST })
  })

  it('is the time the verdict names for a late row', () => {
    // Main was created after an earlier branch, and both came after the deadline.
    const late = person(
      repo({ pushedAt: AFTER_2 }),
      log([ev(AFTER_2, C)], { probe: [ev(AFTER_1, B, ZERO_OID, 'refs/heads/dev')] }),
    )
    expect(late.verdict).toMatchObject({ status: 'late', firstPushAt: AFTER_1 })
    expect(firstPush(late, undefined)).toEqual({ kind: 'recorded', at: AFTER_1 })
  })

  it('gives the date of the oldest commit when GitHub has no push log', () => {
    // Like octocat/Hello-World: last pushed before GitHub began to keep push times.
    const old = person(repo({ createdAt: '2011-01-26T19:01:12Z', pushedAt: '2012-03-06T23:06:50Z' }), log([]))
    const list = commits([
      commit(C, '2012-03-06T23:06:50Z'),
      commit(A, '2011-01-26T19:06:08Z'),
      commit(B, '2011-09-14T04:42:41Z'),
    ])
    expect(firstPush(old, list)).toEqual({ kind: 'commit_date', at: '2011-01-26T19:06:08Z' })
  })

  it('does not take a later push for the first one when the log starts in the middle', () => {
    // An older repo: the first push GitHub recorded already had commits under it.
    const old = person(repo({ createdAt: '2020-01-01T00:00:00Z' }), log([ev(SECOND, C, B)]))
    expect(firstPush(old, commits([commit(C, SECOND), commit(A, '2020-01-02T08:00:00Z')]))).toEqual({
      kind: 'commit_date',
      at: '2020-01-02T08:00:00Z',
    })
  })

  it('does not take the oldest push it read for the first one when the log goes on', () => {
    const busy = person(repo(), log([ev(SECOND, B)], { exhausted: false, capped: true }))
    expect(firstPush(busy, commits([commit(B, SECOND), commit(A, FIRST)]))).toEqual({
      kind: 'commit_date',
      at: FIRST,
    })
  })

  it('takes the first push a fork got from its owner', () => {
    const fork = person(repo({ isFork: true }), log([ev(SECOND, C, B)]))
    expect(firstPush(fork, undefined)).toEqual({ kind: 'recorded', at: SECOND })
  })

  it('never gives the date of a commit the fork was born with', () => {
    const fork = person(repo({ isFork: true }), log([]))
    expect(firstPush(fork, commits([commit(A, '2015-05-05T05:05:05Z')]))).toEqual({ kind: 'unknown' })
  })

  it('waits for the push log, and for the commits only when it needs them', () => {
    expect(firstPush(person(repo()), commits([commit(A, FIRST)]))).toEqual({ kind: 'loading' })
    expect(firstPush(person(repo(), log([])), undefined)).toEqual({ kind: 'loading' })
    expect(firstPush(person(repo(), log([ev(FIRST, A)])), undefined)).toEqual({ kind: 'recorded', at: FIRST })
  })

  it('says so when the push log could not be loaded', () => {
    const failed = person(repo(), log([], { failed: true }))
    expect(firstPush(failed, commits([commit(A, FIRST)]))).toEqual({ kind: 'failed' })
  })

  it('admits it when there is no commit date to give either', () => {
    const old = person(repo(), log([]))
    expect(firstPush(old, null)).toEqual({ kind: 'unknown' })
    expect(firstPush(old, commits([commit(A, FIRST)], true))).toEqual({ kind: 'unknown' })
    expect(firstPush(old, commits([]))).toEqual({ kind: 'unknown' })
  })

  it('has nothing to tell when nothing was pushed', () => {
    const empty = person(repo({ isEmpty: true, headOid: null, defaultBranch: null }))
    expect(firstPush(empty, undefined)).toEqual({ kind: 'none' })

    const untouchedFork = person(
      repo({ isFork: true, createdAt: '2026-10-01T00:00:00Z', pushedAt: '2010-12-09T00:00:00Z' }),
      log([]),
    )
    expect(firstPush(untouchedFork, commits([commit(A, '2010-12-09T00:00:00Z')]))).toEqual({ kind: 'none' })
  })
})

describe('firstPushText', () => {
  it('writes a time for a push and for a commit date alike', () => {
    expect(firstPushText({ kind: 'recorded', at: FIRST })).toBe(formatDateTime(FIRST))
    expect(firstPushText({ kind: 'commit_date', at: FIRST })).toBe(formatDateTime(FIRST))
  })

  it('never leaves a missing time unexplained', () => {
    expect(firstPushText({ kind: 'loading' })).toBe('…')
    expect(firstPushText({ kind: 'failed' })).toBe('Could not be loaded')
    expect(firstPushText({ kind: 'unknown' })).toBe('Not known')
    expect(firstPushText({ kind: 'none' })).toBe('—')
  })

  it('has a note that tells a commit date from a push time', () => {
    expect(FIRST_PUSH_BY_COMMIT_NOTE).toBe('Date of the first commit. The push time is not known.')
  })
})
