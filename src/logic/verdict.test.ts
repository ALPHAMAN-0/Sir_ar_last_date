import { describe, expect, it } from 'vitest'
import type { ActivityEvent, RepoMeta, RepoOk } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import type { LinkResult } from '../sheet/parseRepoLink.ts'
import { judge, type ActivityData } from './verdict.ts'

// Deadline: 5 Oct 2026 23:59 in Dhaka = 17:59:59.999 UTC.
const DEADLINE = Date.parse('2026-10-05T17:59:59.999Z')
const BEFORE = '2026-10-05T15:10:00Z'
const AFTER_1 = '2026-10-05T21:19:00Z' // 3h 19m 0.001s after the deadline
const AFTER_2 = '2026-10-06T03:30:00Z'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const MAIN = 'refs/heads/main'

const link: LinkResult = { ok: true, owner: 'a', repo: 'x', key: 'a/x' }

const repo = (over: Partial<RepoOk> = {}): RepoMeta => ({
  key: 'a/x',
  state: 'ok',
  nameWithOwner: 'a/x',
  isEmpty: false,
  isFork: false,
  isArchived: false,
  createdAt: '2026-10-01T00:00:00Z',
  pushedAt: BEFORE,
  defaultBranch: 'main',
  headOid: C,
  headCommittedAt: BEFORE,
  totalCommits: 3,
  ...over,
})

const ev = (
  ts: string,
  after: string,
  before: string = ZERO_OID,
  type = 'push',
  ref = MAIN,
): ActivityEvent => ({ ts, type, ref, before, after, actor: 'student' })

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

describe('before any deadline logic', () => {
  it('reports a bad link with its reason', () => {
    const v = judge({ link: { ok: false, reason: 'gist' }, deadline: DEADLINE })
    expect(v).toMatchObject({ status: 'invalid_link', linkProblem: 'gist', need: null })
  })

  it('is "checking" until the repo facts arrive', () => {
    expect(judge({ link, deadline: DEADLINE })).toMatchObject({ status: 'checking', need: null })
  })

  it('separates a missing repo from a failed check', () => {
    expect(judge({ link, meta: { key: 'a/x', state: 'not_found' }, deadline: DEADLINE }).status).toBe(
      'not_found',
    )
    expect(
      judge({ link, meta: { key: 'a/x', state: 'error', code: 'forbidden' }, deadline: DEADLINE })
        .status,
    ).toBe('check_failed')
  })

  it('calls an empty repo "no submission" whatever pushedAt says', () => {
    const meta = repo({ isEmpty: true, headOid: null, defaultBranch: null, pushedAt: BEFORE })
    expect(judge({ link, meta, deadline: DEADLINE }).status).toBe('no_submission')
    expect(judge({ link, meta, deadline: null }).status).toBe('no_submission')
  })

  it('treats a fork that was never pushed to as no submission', () => {
    const meta = repo({ isFork: true, createdAt: '2026-10-01T00:00:00Z', pushedAt: '2010-12-09T00:00:00Z' })
    const v = judge({ link, meta, deadline: DEADLINE })
    expect(v.status).toBe('no_submission')
    expect(v.notes).toEqual(['fork', 'fork_never_pushed'])
  })

  it('says "submitted" when no deadline is set', () => {
    expect(judge({ link, meta: repo(), deadline: null })).toMatchObject({
      status: 'submitted',
      need: null,
    })
  })

  it('adds notes for moved, archived and duplicate repos', () => {
    const meta = repo({ nameWithOwner: 'new-owner/x', isArchived: true })
    const v = judge({ link, meta, deadline: null, duplicate: true })
    expect(v.notes).toEqual(['duplicate_link', 'moved', 'archived'])
  })
})

describe('on time', () => {
  it('needs no push log when the last push is before the deadline', () => {
    expect(judge({ link, meta: repo(), deadline: DEADLINE })).toMatchObject({
      status: 'on_time',
      need: null,
      notes: [],
    })
  })

  it('counts the whole deadline minute, and nothing after it', () => {
    const at = new Date(DEADLINE).toISOString()
    expect(judge({ link, meta: repo({ pushedAt: at }), deadline: DEADLINE }).status).toBe('on_time')
    const after = new Date(DEADLINE + 1).toISOString()
    expect(judge({ link, meta: repo({ pushedAt: after }), deadline: DEADLINE })).toMatchObject({
      status: 'checking',
      need: 'activity',
    })
  })

  it('stays on time when only another branch was pushed later', () => {
    const meta = repo({ pushedAt: AFTER_1 })
    const activity = log([ev(BEFORE, C, B)])
    const v = judge({ link, meta, activity, deadline: DEADLINE })
    expect(v).toMatchObject({ status: 'on_time', lastOnTimePushAt: BEFORE })
    expect(v.notes).toEqual(['other_branch_pushed_later'])
  })

  it('is provisional while the push log may still be catching up', () => {
    const meta = repo({ pushedAt: AFTER_1 })
    const v = judge({ link, meta, activity: log([ev(BEFORE, C, B)], { settled: false }), deadline: DEADLINE })
    expect(v.status).toBe('on_time')
    expect(v.notes).toEqual(['provisional'])
  })

  it('is on time when a later force push put the branch back where it was', () => {
    const meta = repo({ pushedAt: AFTER_2, headOid: B })
    const activity = log([
      ev(AFTER_2, B, C, 'force_push'),
      ev(AFTER_1, C, B),
      ev(BEFORE, B, A),
    ])
    const v = judge({ link, meta, activity, deadline: DEADLINE })
    expect(v).toMatchObject({ status: 'on_time', atDeadlineOid: B })
    expect(v.notes).toEqual(['identical_after_deadline'])
  })
})

describe('changed after deadline', () => {
  it('reports the late pushes, the last on-time push and the commit at the deadline', () => {
    const meta = repo({ pushedAt: AFTER_2 })
    const activity = log([ev(AFTER_2, C, B), ev(AFTER_1, B, A), ev(BEFORE, A)])
    expect(judge({ link, meta, activity, deadline: DEADLINE })).toMatchObject({
      status: 'changed_after',
      latePushes: 2,
      lateByMs: Date.parse(AFTER_2) - DEADLINE,
      atDeadlineOid: A,
      lastOnTimePushAt: BEFORE,
      forcePushed: false,
      needsReview: false,
      need: null,
    })
  })

  it('flags a force push after the deadline', () => {
    const meta = repo({ pushedAt: AFTER_1 })
    const activity = log([ev(AFTER_1, C, B, 'force_push'), ev(BEFORE, B, A)])
    expect(judge({ link, meta, activity, deadline: DEADLINE })).toMatchObject({
      status: 'changed_after',
      forcePushed: true,
      atDeadlineOid: B,
    })
  })

  it('asks for more pages until the log reaches the deadline', () => {
    const meta = repo({ pushedAt: AFTER_2 })
    const activity = log([ev(AFTER_2, C, B), ev(AFTER_1, B, A)], { exhausted: false })
    expect(judge({ link, meta, activity, deadline: DEADLINE })).toMatchObject({
      status: 'checking',
      need: 'activity',
    })
  })

  it('uses the commit before the first logged push when the log starts mid-history', () => {
    // Older repo: the log does not reach back to creation, but `before` shows
    // the branch already had commits.
    const meta = repo({ pushedAt: AFTER_1, createdAt: '2019-01-01T00:00:00Z' })
    const activity = log([ev(AFTER_1, C, B)])
    expect(judge({ link, meta, activity, deadline: DEADLINE })).toMatchObject({
      status: 'changed_after',
      atDeadlineOid: B,
      latePushes: 1,
    })
  })

  it('falls back to commit dates when GitHub has no push log at all', () => {
    const base = { pushedAt: AFTER_1, createdAt: '2012-01-01T00:00:00Z' }
    const later = judge({
      link,
      meta: repo({ ...base, headCommittedAt: AFTER_1 }),
      activity: log([]),
      deadline: DEADLINE,
    })
    expect(later).toMatchObject({ status: 'changed_after', needsReview: true })
    expect(later.notes).toEqual(['by_commit_date'])

    const earlier = judge({
      link,
      meta: repo({ ...base, headCommittedAt: BEFORE }),
      activity: log([]),
      deadline: DEADLINE,
    })
    expect(earlier.status).toBe('on_time')
    expect(earlier.notes).toEqual(['by_commit_date'])
  })

  it('reports a failed push-log download as a failed check, not as late', () => {
    const meta = repo({ pushedAt: AFTER_1 })
    const v = judge({ link, meta, activity: log([], { failed: true }), deadline: DEADLINE })
    expect(v.status).toBe('check_failed')
  })
})

describe('late', () => {
  it('is late at once when the repo was created after the deadline', () => {
    // pushedAt can be misleading, so creation time is checked first.
    const meta = repo({ createdAt: AFTER_1, pushedAt: '2010-01-01T00:00:00Z' })
    expect(judge({ link, meta, deadline: DEADLINE })).toMatchObject({
      status: 'late',
      need: 'activity',
      lateByMs: null,
    })
  })

  it('measures lateness to the FIRST push once the log is loaded', () => {
    const meta = repo({ createdAt: '2026-10-05T18:30:00Z', pushedAt: AFTER_2 })
    const activity = log([ev(AFTER_2, C, B), ev(AFTER_1, B, ZERO_OID, 'branch_creation')])
    expect(judge({ link, meta, activity, deadline: DEADLINE })).toMatchObject({
      status: 'late',
      lateByMs: Date.parse(AFTER_1) - DEADLINE,
      firstPushAt: AFTER_1,
      need: null,
    })
  })

  it('uses the creation time when the push log cannot be loaded', () => {
    const meta = repo({ createdAt: '2026-10-05T18:30:00Z', pushedAt: AFTER_2 })
    const v = judge({ link, meta, activity: log([], { failed: true }), deadline: DEADLINE })
    expect(v).toMatchObject({
      status: 'late',
      lateByMs: Date.parse('2026-10-05T18:30:00Z') - DEADLINE,
    })
  })

  it('checks every branch before calling an early-created repo late', () => {
    // Repo created before the deadline, main branch first pushed after it.
    const meta = repo({ pushedAt: AFTER_2 })
    const events = [ev(AFTER_2, C, B), ev(AFTER_1, B, ZERO_OID, 'branch_creation')]

    expect(judge({ link, meta, activity: log(events), deadline: DEADLINE })).toMatchObject({
      status: 'checking',
      need: 'probe',
    })

    // Nothing on any branch by the deadline: Late, measured to the first push anywhere.
    const nothingEarly = log(events, { probe: [ev(AFTER_1, B, ZERO_OID, 'branch_creation')] })
    expect(judge({ link, meta, activity: nothingEarly, deadline: DEADLINE })).toMatchObject({
      status: 'late',
      lateByMs: Date.parse(AFTER_1) - DEADLINE,
      firstPushAt: AFTER_1,
    })
  })
})

describe('default branch renamed or created after the deadline', () => {
  const meta = repo({ pushedAt: AFTER_2 })
  const onMaster = (after: string) => ev(BEFORE, after, ZERO_OID, 'branch_creation', 'refs/heads/master')

  it('does not turn a rename into a false Late', () => {
    // "master" had commit B before the deadline; "main" was created at B after it.
    const events = [ev(AFTER_2, C, B), ev(AFTER_1, B, ZERO_OID, 'branch_creation')]
    const v = judge({ link, meta, activity: log(events, { probe: [onMaster(B)] }), deadline: DEADLINE })
    expect(v).toMatchObject({ status: 'changed_after', atDeadlineOid: B })
    expect(v.notes).toEqual(['default_branch_renamed'])
  })

  it('is on time when the renamed branch was not changed afterwards', () => {
    const events = [ev(AFTER_1, C, ZERO_OID, 'branch_creation')]
    const v = judge({ link, meta, activity: log(events, { probe: [onMaster(C)] }), deadline: DEADLINE })
    expect(v.status).toBe('on_time')
    expect(v.notes).toEqual(['default_branch_renamed', 'identical_after_deadline'])
  })

  it('asks a person to review when the new main branch has different content', () => {
    const events = [ev(AFTER_1, C, ZERO_OID, 'branch_creation')]
    const v = judge({ link, meta, activity: log(events, { probe: [onMaster(A)] }), deadline: DEADLINE })
    expect(v).toMatchObject({ status: 'changed_after', needsReview: true, atDeadlineOid: null })
    expect(v.notes).toEqual(['default_branch_created_late'])
  })
})

describe('page limit reached before the deadline', () => {
  const meta = repo({ pushedAt: AFTER_2 })
  const capped = (probe: ActivityEvent[] | null) =>
    log([ev(AFTER_2, C, B), ev(AFTER_1, B, A)], { exhausted: false, capped: true, probe })

  it('asks for the oldest events', () => {
    expect(judge({ link, meta, activity: capped(null), deadline: DEADLINE })).toMatchObject({
      status: 'checking',
      need: 'probe',
    })
  })

  it('is late when even the oldest push is after the deadline', () => {
    const v = judge({ link, meta, activity: capped([ev(AFTER_1, A)]), deadline: DEADLINE })
    expect(v).toMatchObject({ status: 'late', firstPushAt: AFTER_1 })
  })

  it('is changed-after with a review flag when something was pushed in time', () => {
    const v = judge({ link, meta, activity: capped([ev(BEFORE, A)]), deadline: DEADLINE })
    expect(v).toMatchObject({ status: 'changed_after', needsReview: true })
    expect(v.notes).toEqual(['many_pushes_after_deadline'])
  })
})
