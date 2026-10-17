import { describe, expect, it } from 'vitest'
import type { ActivityEvent, RepoOk, TreeDir } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import type { LinkResult } from '../sheet/parseRepoLink.ts'
import {
  judgeTerm,
  labTasks,
  termFolder,
  termOfFolder,
  type Listing,
  type ListingState,
  type Term,
} from './termFolder.ts'
import { judge, type ActivityData } from './verdict.ts'

// The Mid deadline: 5 Oct 2026 23:59 in Dhaka.
const DEADLINE = Date.parse('2026-10-05T17:59:59.999Z')
const BEFORE = '2026-10-04T10:00:00Z'
const P1 = '2026-10-06T10:00:00Z'
const P2 = '2026-10-08T12:30:00Z'
const P3 = '2026-10-12T09:15:00Z'

const sha = (letter: string) => letter.repeat(40)
const A0 = sha('a') // the commit at the deadline
const X1 = sha('b')
const X2 = sha('c')
const HEAD = sha('d')
const MID_1 = sha('1')
const MID_2 = sha('2')
const FINAL_1 = sha('3')
const FINAL_2 = sha('4')

const link: LinkResult = { ok: true, owner: 'rahim', repo: 'lab', key: 'rahim/lab' }

const repo = (over: Partial<RepoOk> = {}): RepoOk => ({
  key: 'rahim/lab',
  state: 'ok',
  nameWithOwner: 'rahim/lab',
  isEmpty: false,
  isFork: false,
  isArchived: false,
  createdAt: '2026-09-01T00:00:00Z',
  pushedAt: P3,
  defaultBranch: 'main',
  headOid: HEAD,
  headCommittedAt: P3,
  totalCommits: 9,
  ...over,
})

const push = (ts: string, after: string, before: string): ActivityEvent => ({
  ts,
  type: 'push',
  ref: 'refs/heads/main',
  before,
  after,
  actor: 'rahim',
})

const log = (events: ActivityEvent[]): ActivityData => ({
  events,
  exhausted: true,
  capped: false,
  settled: true,
  probe: null,
  failed: false,
})

const listing = (dirs: Record<string, string>, files: string[] = []): Listing => ({
  dirs: Object.entries(dirs).map(([path, tree]): TreeDir => ({ path, sha: tree })),
  files: files.map((path) => ({ path, sha: sha('f'), size: 10 })),
})

/**
 * Runs the judgement the way the store does: whatever listing it asks for is
 * fetched, then it is asked again, until it needs nothing more.
 */
function settle(
  term: Term,
  meta: RepoOk,
  activity: ActivityData | undefined,
  listings: Record<string, ListingState>,
  deadline: number | null = DEADLINE,
) {
  const verdict = judge({ link, meta, activity, deadline })
  const fetched: string[] = []
  for (let step = 0; step < 20; step++) {
    const result = judgeTerm({
      verdict,
      meta,
      activity,
      deadline,
      term,
      lookup: (commit) => (fetched.includes(commit) ? listings[commit] : undefined),
    })
    if (result.need === null) return { ...result, fetched, whole: verdict }
    fetched.push(result.need)
  }
  throw new Error('The judgement never settled')
}

/** Pushed in time, then Final work (and maybe a Mid fix) after the Mid deadline. */
const changedRepo = () => ({
  meta: repo(),
  activity: log([
    push(P3, HEAD, X2),
    push(P2, X2, X1),
    push(P1, X1, A0),
    push(BEFORE, A0, ZERO_OID),
  ]),
})

describe('termOfFolder', () => {
  it('knows the usual spellings of the two term folders', () => {
    for (const name of ['Mid', 'mid', 'MID', 'Mid Term', 'mid-term', 'Midterm', 'mid_labs', 'Mid sem', 'Midsem']) {
      expect(termOfFolder(name), name).toBe('mid')
    }
    for (const name of ['Final', 'final', 'Final Term', 'final-term', 'Finalterm', 'Finals', 'final_labs']) {
      expect(termOfFolder(name), name).toBe('final')
    }
  })

  it('does not take other folders for a term folder', () => {
    for (const name of ['middle', 'middleware', 'Lab 1', 'finalize', 'src', 'Mid.md']) {
      expect(termOfFolder(name), name).toBeNull()
    }
  })
})

describe('termFolder', () => {
  it('finds the folder of the term at the top of the repo', () => {
    const top = listing({ Final: FINAL_1, Mid: MID_1, src: sha('9') })
    expect(termFolder(top, 'mid')).toEqual({ path: 'Mid', sha: MID_1 })
    expect(termFolder(top, 'final')).toEqual({ path: 'Final', sha: FINAL_1 })
  })

  it('prefers the plainest name when two folders could be the term', () => {
    expect(termFolder(listing({ 'mid-old': MID_2, Mid: MID_1 }), 'mid')).toEqual({ path: 'Mid', sha: MID_1 })
    expect(termFolder(listing({ 'mid_v2': MID_2, 'mid_v1': MID_1 }), 'mid')).toEqual({ path: 'mid_v1', sha: MID_1 })
  })

  it('answers null when there is none', () => {
    expect(termFolder(listing({ Final: FINAL_1 }, ['Mid']), 'mid')).toBeNull()
  })
})

describe('labTasks', () => {
  it('lists the lab task folders in the term folder, in natural order', () => {
    expect(labTasks(listing({ 'Lab 10': sha('5'), 'Lab 2': sha('6'), 'Lab 1': sha('7') }))).toEqual([
      'Lab 1',
      'Lab 2',
      'Lab 10',
    ])
  })

  it('lists the files when the lab tasks are files, and skips hidden ones', () => {
    expect(labTasks(listing({}, ['lab2.cpp', '.DS_Store', 'lab1.cpp', '.gitkeep']))).toEqual(['lab1.cpp', 'lab2.cpp'])
  })
})

describe('judgeTerm', () => {
  it('waits for the listing of the head commit first', () => {
    const { meta, activity } = changedRepo()
    const verdict = judge({ link, meta, activity, deadline: DEADLINE })
    const result = judgeTerm({ verdict, meta, activity, deadline: DEADLINE, term: 'mid', lookup: () => undefined })
    expect(result.need).toBe(HEAD)
    expect(result.verdict.status).toBe('checking')
  })

  it('reads On time when only another folder changed after the deadline', () => {
    const { meta, activity } = changedRepo()
    const result = settle('mid', meta, activity, {
      [HEAD]: listing({ Mid: MID_1, Final: FINAL_2 }),
      [A0]: listing({ Mid: MID_1 }),
    })
    expect(result.whole.status).toBe('changed_after')
    expect(result.verdict).toMatchObject({ status: 'on_time', lateByMs: null, needsReview: false })
    expect(result.verdict.notes).toContain('term_untouched_after_deadline')
    expect(result.folder).toEqual({ path: 'Mid', sha: MID_1 })
    expect(result.fetched).toEqual([HEAD, A0])
  })

  it('reads Changed after when the term folder changed, and dates it by the last push that changed it', () => {
    const { meta, activity } = changedRepo()
    const result = settle('mid', meta, activity, {
      [HEAD]: listing({ Mid: MID_2, Final: FINAL_2 }),
      [A0]: listing({ Mid: MID_1 }),
      [X1]: listing({ Mid: MID_1, Final: FINAL_1 }),
      [X2]: listing({ Mid: MID_2, Final: FINAL_1 }),
    })
    expect(result.verdict).toMatchObject({ status: 'changed_after', lateByMs: Date.parse(P2) - DEADLINE })
    expect(result.folder).toEqual({ path: 'Mid', sha: MID_2 })
  })

  it('finds the push by halving, not by reading every push', () => {
    const { meta, activity } = changedRepo()
    const result = settle('mid', meta, activity, {
      [HEAD]: listing({ Mid: MID_2 }),
      [A0]: listing({ Mid: MID_1 }),
      [X1]: listing({ Mid: MID_1 }),
      [X2]: listing({ Mid: MID_2 }),
    })
    // Head, the deadline, then two halvings of the three pushes after it.
    expect(result.fetched).toEqual([HEAD, A0, X2, X1])
  })

  it('reads Late when the term folder first came after the deadline, dated by the push that brought it', () => {
    const { meta, activity } = changedRepo()
    const result = settle('final', meta, activity, {
      [HEAD]: listing({ Mid: MID_2, Final: FINAL_2 }),
      [A0]: listing({ Mid: MID_1 }),
      [X1]: listing({ Mid: MID_1, Final: FINAL_1 }),
      [X2]: listing({ Mid: MID_2, Final: FINAL_1 }),
    })
    expect(result.verdict).toMatchObject({ status: 'late', lateByMs: Date.parse(P1) - DEADLINE, firstPushAt: P1 })
  })

  it('reads No submission when the repo has no folder for the term', () => {
    const { meta, activity } = changedRepo()
    const result = settle('final', meta, activity, {
      [HEAD]: listing({ Mid: MID_2 }),
      [A0]: listing({ Mid: MID_1 }),
    })
    expect(result.verdict).toMatchObject({ status: 'no_submission', lateByMs: null })
    expect(result.verdict.notes).toContain('term_folder_missing')
    expect(result.folder).toBeNull()
  })

  it('flags a term folder removed after the deadline for a person to look at', () => {
    const { meta, activity } = changedRepo()
    const result = settle('mid', meta, activity, {
      [HEAD]: listing({ Final: FINAL_2 }),
      [A0]: listing({ Mid: MID_1 }),
    })
    expect(result.verdict).toMatchObject({ status: 'changed_after', needsReview: true })
    expect(result.verdict.notes).toContain('term_folder_removed')
  })

  it('keeps On time when nothing was pushed after the deadline and the folder is there', () => {
    const meta = repo({ pushedAt: BEFORE, headOid: A0 })
    const result = settle('mid', meta, undefined, { [A0]: listing({ Mid: MID_1 }) })
    expect(result.verdict.status).toBe('on_time')
    expect(result.fetched).toEqual([A0])
  })

  it('reads No submission for an on-time repo without the folder', () => {
    const meta = repo({ pushedAt: BEFORE, headOid: A0 })
    const result = settle('final', meta, undefined, { [A0]: listing({ Mid: MID_1 }) })
    expect(result.verdict.status).toBe('no_submission')
  })

  it('dates a late repo by the push that brought the term folder, not by its first push', () => {
    const meta = repo({ createdAt: P1 })
    const activity = log([push(P2, HEAD, X1), push(P1, X1, ZERO_OID)])
    const result = settle('mid', meta, activity, {
      [HEAD]: listing({ Mid: MID_1 }),
      [X1]: listing({}, ['README.md']),
    })
    expect(result.whole).toMatchObject({ status: 'late', lateByMs: Date.parse(P1) - DEADLINE })
    expect(result.verdict).toMatchObject({ status: 'late', lateByMs: Date.parse(P2) - DEADLINE, firstPushAt: P2 })
  })

  it('reads No submission for a late repo that never got the folder', () => {
    const meta = repo({ createdAt: P1 })
    const activity = log([push(P2, HEAD, X1), push(P1, X1, ZERO_OID)])
    const result = settle('mid', meta, activity, { [HEAD]: listing({ Final: FINAL_1 }) })
    expect(result.verdict.status).toBe('no_submission')
  })

  it('looks only at the folder when no deadline is set', () => {
    const meta = repo()
    expect(settle('mid', meta, undefined, { [HEAD]: listing({ Mid: MID_1 }) }, null).verdict.status).toBe('submitted')
    expect(settle('final', meta, undefined, { [HEAD]: listing({ Mid: MID_1 }) }, null).verdict.status).toBe(
      'no_submission',
    )
  })

  it('reads Check failed when a listing could not be read, never a mark against the student', () => {
    const { meta, activity } = changedRepo()
    expect(settle('mid', meta, activity, { [HEAD]: 'failed' }).verdict.status).toBe('check_failed')
    expect(
      settle('mid', meta, activity, { [HEAD]: listing({ Mid: MID_2 }), [A0]: 'failed' }).verdict.status,
    ).toBe('check_failed')
  })

  it('reads Check failed when a push in the middle of the search cannot be read', () => {
    const { meta, activity } = changedRepo()
    const result = settle('mid', meta, activity, {
      [HEAD]: listing({ Mid: MID_2 }),
      [A0]: listing({ Mid: MID_1 }),
      [X2]: 'failed',
    })
    expect(result.verdict.status).toBe('check_failed')
  })

  it('keeps the whole-repo lateness when the push log was not read to its end', () => {
    const meta = repo({ createdAt: P1 })
    const activity = { ...log([push(P2, HEAD, X1), push(P1, X1, ZERO_OID)]), exhausted: false, capped: true }
    const result = settle('mid', meta, activity, { [HEAD]: listing({ Mid: MID_1 }) })
    expect(result.verdict.status).toBe('late')
    expect(result.verdict.lateByMs).toBe(result.whole.lateByMs)
    expect(result.fetched).toEqual([HEAD])
  })

  it('keeps the whole-repo verdict when the commit at the deadline is not known, unless the folder is missing', () => {
    const { meta, activity } = changedRepo()
    const verdict = { ...judge({ link, meta, activity, deadline: DEADLINE }), atDeadlineOid: null, needsReview: true }
    const run = (head: Listing) =>
      judgeTerm({ verdict, meta, activity, deadline: DEADLINE, term: 'mid', lookup: (commit) => (commit === HEAD ? head : undefined) })
    expect(run(listing({ Mid: MID_2 })).verdict).toMatchObject({ status: 'changed_after', needsReview: true })
    expect(run(listing({ Final: FINAL_1 })).verdict.status).toBe('no_submission')
  })

  it('keeps the whole-repo date when even the last push does not show the folder in its final state', () => {
    // The head moved without a logged push (say, a push the log has not caught up with).
    const meta = repo({ headOid: sha('e') })
    const activity = changedRepo().activity
    const result = settle('mid', meta, activity, {
      [sha('e')]: listing({ Mid: MID_2 }),
      [A0]: listing({ Mid: MID_1 }),
      [HEAD]: listing({ Mid: sha('9') }),
    })
    expect(result.verdict).toMatchObject({ status: 'changed_after', lateByMs: result.whole.lateByMs })
  })

  it('passes through rows that have nothing to look at', () => {
    const meta = repo({ isEmpty: true, headOid: null })
    const result = settle('mid', meta, undefined, {})
    expect(result.verdict.status).toBe('no_submission')
    expect(result.fetched).toEqual([])
  })

  it('passes through a row still waiting for its push log', () => {
    const { meta } = changedRepo()
    const result = settle('mid', meta, undefined, {})
    expect(result.verdict.need).toBe('activity')
    expect(result.fetched).toEqual([])
  })
})
