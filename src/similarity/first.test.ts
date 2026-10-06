import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import { at, facts, headOf, id, iso, repo, tree, type Files, type Repo, type Step } from '../test/stories.ts'
import {
  CLEAR_GAP_MS,
  arrivalOf,
  digest,
  judgePair,
  lastPush,
  originOf,
  pairKey,
  readLog,
  sharedBlobs,
  type JudgeInput,
  type RepoHistory,
} from './first.ts'
import type { RepoFacts } from './run.ts'

const judge = (a: Repo, b: Repo, over: Partial<JudgeInput> = {}) =>
  judgePair({
    a: a.facts,
    b: b.facts,
    blobs: sharedBlobs(a.head, b.head, new Set()),
    aHistory: a.history,
    bHistory: b.history,
    aCommits: a.commits,
    bCommits: b.commits,
    ...over,
  })

const README_A = { 'README.md': 'readme of a' }
const README_B = { 'README.md': 'readme of b' }
const WORK = { 'src/app.js': 'the app', 'src/util.js': 'the helpers' }

/** A wrote the work and pushed it on the 12th. */
const author = () =>
  repo('a/app', [
    { at: '02 09:00', files: README_A },
    { at: '12 10:14', files: { ...README_A, ...WORK } },
  ])

describe('readLog', () => {
  const f = facts('a/app')
  const event = (when: string, before: string, after: string, ref = 'refs/heads/main'): ActivityEvent => ({
    ts: iso(when),
    type: 'push',
    ref,
    before,
    after,
    actor: null,
  })

  it('puts the pushes oldest first, whatever order they came in', () => {
    const log = readLog([event('05 10:00', id('1'), id('2')), event('02 10:00', ZERO_OID, id('1'))], f)
    expect(log.pushes.map((push) => push.after)).toEqual([id('1'), id('2')])
    expect(log).toMatchObject({ trusted: 2, startKnown: true })
  })

  it('leaves out a deleted branch, and still follows the chain across it', () => {
    const log = readLog(
      [
        event('02 10:00', ZERO_OID, id('1')),
        event('03 10:00', ZERO_OID, id('d1'), 'refs/heads/dev'),
        event('04 10:00', id('d1'), ZERO_OID, 'refs/heads/dev'),
        event('05 10:00', ZERO_OID, id('d2'), 'refs/heads/dev'),
      ],
      f,
    )
    expect(log.pushes.map((push) => push.after)).toEqual([id('1'), id('d1'), id('d2')])
    expect(log.trusted).toBe(3)
  })

  it('trusts the log only up to the first gap', () => {
    const log = readLog(
      [
        event('02 10:00', ZERO_OID, id('1')),
        event('03 10:00', id('1'), id('2')),
        // A push is missing here: this one does not start where the last ended.
        event('05 10:00', id('unseen'), id('4')),
        event('06 10:00', id('4'), id('5')),
      ],
      f,
    )
    expect(log.pushes).toHaveLength(4)
    expect(log).toMatchObject({ trusted: 2, startKnown: true })
  })

  it('does not know the start of a log that begins in the middle', () => {
    expect(readLog([event('05 10:00', id('older'), id('2'))], f)).toMatchObject({ trusted: 0, startKnown: false })
  })

  it('does not know the start when the main branch is never seen being created', () => {
    const log = readLog([event('05 10:00', ZERO_OID, id('d1'), 'refs/heads/dev')], f)
    expect(log).toMatchObject({ trusted: 1, startKnown: false })
  })

  it('never knows the start of a fork, a template copy, or a repo older than the log', () => {
    const events = [event('02 10:00', ZERO_OID, id('1'))]
    expect(readLog(events, facts('a/app', { isFork: true })).startKnown).toBe(false)
    expect(readLog(events, facts('a/app', { template: 't/starter' })).startKnown).toBe(false)
    expect(readLog(events, facts('a/app', { template: undefined })).startKnown).toBe(false)
    expect(readLog(events, facts('a/app', { createdAt: Date.parse('2022-05-01T00:00:00Z') })).startKnown).toBe(false)
    expect(readLog([], f)).toEqual({ pushes: [], trusted: 0, startKnown: false })
  })
})

describe('digest', () => {
  it('finds today\'s contents under any name, and today\'s paths with other content', () => {
    const head = headOf('a/app', { 'src/app.js': 'the app', 'notes.md': 'notes v2', 'new.js': 'new' })
    const seen = digest(tree({ 'old/main.js': 'the app', 'notes.md': 'notes v1', 'gone.js': 'gone' }), head)
    expect([...seen.held]).toEqual([id('the app')])
    expect([...seen.changed]).toEqual(['notes.md'])
  })
})

describe('arrivalOf', () => {
  const X = id('the app')
  const story = (read: Partial<RepoHistory> = {}, over: Partial<RepoFacts> = {}) =>
    repo(
      'a/app',
      [
        { at: '02 09:00', files: README_A },
        { at: '05 09:00', files: { ...README_A, 'src/app.js': 'a first try' } },
        { at: '12 10:14', files: { ...README_A, ...WORK } },
      ],
      over,
      read,
    )

  it('gives an exact time when the file is seen arriving and everything before was read', () => {
    const { history, facts: f } = story()
    expect(arrivalOf(X, 'src/app.js', history, f)).toEqual({
      notBefore: at('12 10:14'),
      by: at('12 10:14'),
      push: 2,
      hadEarlierVersion: true,
    })
    expect(arrivalOf(id('the helpers'), 'src/util.js', history, f).hadEarlierVersion).toBe(false)
  })

  it('proves "had it" but not "not before" when the start of the log is not known', () => {
    const { history, facts: f } = story({ startKnown: false })
    expect(arrivalOf(X, 'src/app.js', history, f)).toMatchObject({ notBefore: f.createdAt, by: at('12 10:14'), push: 2 })
  })

  it('proves "had it" but not "not before" past a gap in the log', () => {
    const { history, facts: f } = story({ trusted: 2 })
    expect(arrivalOf(X, 'src/app.js', history, f)).toMatchObject({ notBefore: f.createdAt, by: at('12 10:14') })
  })

  it('keeps an interval for a file that was not seen in the pushes read', () => {
    const { history, facts: f } = story({ scanned: 2, stopped: 'cap' })
    expect(arrivalOf(X, 'src/app.js', history, f)).toEqual({
      notBefore: at('05 09:00'),
      by: at('30 08:00'),
      push: null,
      hadEarlierVersion: true,
    })
    const unknownStart = story({ scanned: 2, startKnown: false })
    expect(arrivalOf(X, 'src/app.js', unknownStart.history, f).notBefore).toBe(f.createdAt)
    const nothingRead = story({ scanned: 0 })
    expect(arrivalOf(X, 'src/app.js', nothingRead.history, f).notBefore).toBe(f.createdAt)
  })

  it('knows only the repo\'s own dates without a readable log', () => {
    const { history, facts: f } = story()
    const free = { notBefore: f.createdAt, by: at('30 08:00'), push: null, hadEarlierVersion: false }
    expect(arrivalOf(X, 'src/app.js', undefined, f)).toEqual(free)
    for (const log of ['none', 'failed', 'unsettled'] as const) {
      expect(arrivalOf(X, 'src/app.js', { ...history, log }, f)).toEqual(free)
    }
  })

  it('takes the creation time as the last push of a fork that was never pushed', () => {
    const fork = facts('b/app', { isFork: true, createdAt: at('10 08:00'), pushedAt: at('05 08:00') })
    expect(lastPush(fork)).toBe(at('10 08:00'))
    expect(lastPush(facts('b/app', { pushedAt: null }))).toBe(at('01 08:00'))
    expect(arrivalOf(X, 'src/app.js', undefined, fork)).toMatchObject({ notBefore: at('10 08:00'), by: at('10 08:00') })
  })
})

describe('sharedBlobs', () => {
  it('lists each shared content once, without starter files, at the same path when it can', () => {
    const a = headOf('a/app', { 'src/app.js': 'the app', 'copy/app.js': 'the app', 'x.js': 'x', 'starter.md': 'given', 'own.js': 'mine' })
    const b = headOf('b/app', { 'lib/main.js': 'the app', 'x.js': 'x', 'other/x.js': 'x', 'starter.md': 'given' })
    expect(sharedBlobs(a, b, new Set([id('given')]))).toEqual([
      { sha: id('the app'), aPath: 'src/app.js', bPath: 'lib/main.js', size: 500 },
      { sha: id('x'), aPath: 'x.js', bPath: 'x.js', size: 500 },
    ])
  })
})

describe('judgePair: push times', () => {
  it('names the repo that pushed the files first', () => {
    const a = author()
    const b = repo('b/app', [
      { at: '03 09:00', files: README_B },
      { at: '14 23:51', files: { ...README_B, ...WORK } },
    ])
    const evidence = judge(a, b)
    expect(evidence).toMatchObject({
      verdict: 'a_first',
      basis: 'push_times',
      reason: null,
      shared: 2,
      undecided: 0,
      gapMs: at('14 23:51') - at('12 10:14'),
    })
    expect(evidence.a).toMatchObject({ first: 2, seen: 2, firstAt: at('12 10:14'), lastAt: at('12 10:14'), arrivalPushes: 1, whole: 2 })
    expect(evidence.b).toMatchObject({ first: 0, firstAt: at('14 23:51'), commitsByOther: 0 })
    // The same pair looked at from the other side.
    expect(judge(b, a)).toMatchObject({ verdict: 'b_first', basis: 'push_times' })
  })

  it('still dates a file that was removed and put back', () => {
    const a = repo('a/app', [
      { at: '02 09:00', files: README_A },
      { at: '10 09:00', files: { ...README_A, ...WORK } },
    ])
    const b = repo('b/app', [
      { at: '05 09:00', files: { ...README_B, ...WORK } },
      { at: '08 09:00', files: README_B },
      { at: '15 09:00', files: { ...README_B, ...WORK } },
    ])
    expect(judge(a, b)).toMatchObject({ verdict: 'b_first', basis: 'push_times' })
  })

  it('counts a file first pushed to a side branch', () => {
    const a = repo('a/app', [
      { at: '02 09:00', files: README_A },
      { at: '10 09:00', files: { ...README_A, ...WORK } },
    ])
    const b = repo('b/app', [
      { at: '02 10:00', files: README_B },
      { at: '05 09:00', files: { ...README_B, ...WORK }, ref: 'dev' },
      { at: '15 09:00', files: { ...README_B, ...WORK } },
    ])
    expect(judge(a, b)).toMatchObject({ verdict: 'b_first' })
  })

  it('counts what a force push later took away', () => {
    const a = repo('a/app', [
      { at: '02 09:00', files: README_A },
      { at: '10 09:00', files: { ...README_A, ...WORK } },
    ])
    const b = repo('b/app', [
      { at: '05 09:00', files: { ...README_B, ...WORK } },
      { at: '06 09:00', files: README_B, type: 'force_push' },
      { at: '15 09:00', files: { ...README_B, ...WORK } },
    ])
    expect(judge(a, b)).toMatchObject({ verdict: 'b_first' })
  })

  it('cannot tell when an old state of the other repo can no longer be read', () => {
    const b = repo(
      'b/app',
      [
        { at: '02 10:00', files: README_B },
        { at: '05 09:00', files: README_B },
        { at: '15 09:00', files: { ...README_B, ...WORK } },
      ],
      {},
      { scanned: 1, stopped: 'gone' },
    )
    expect(judge(author(), b)).toMatchObject({ verdict: 'unknown', reason: 'not_observed' })
  })

  it('cannot tell without a push log while both repos existed', () => {
    const b = repo('b/app', [{ at: '14 09:00', files: { ...README_B, ...WORK } }], {}, { log: 'none' })
    expect(judge(author(), b)).toMatchObject({ verdict: 'unknown', reason: 'not_observed' })
    const failed = repo('b/app', [{ at: '14 09:00', files: { ...README_B, ...WORK } }], {}, { log: 'failed' })
    expect(judge(author(), failed)).toMatchObject({ verdict: 'unknown', reason: 'not_observed' })
  })

  it('cannot tell when the other repo was pushed minutes ago', () => {
    const b = repo(
      'b/app',
      [
        { at: '03 09:00', files: README_B },
        { at: '14 23:51', files: { ...README_B, ...WORK } },
      ],
      {},
      { log: 'unsettled' },
    )
    expect(judge(author(), b)).toMatchObject({ verdict: 'unknown', reason: 'not_observed' })
  })

  it('never proves a repo later when its log starts in the middle', () => {
    const b = repo('b/app', [
      { at: '03 09:00', files: README_B, before: id('before the log') },
      { at: '14 23:51', files: { ...README_B, ...WORK } },
    ])
    expect(b.history).toMatchObject({ trusted: 0, startKnown: false })
    expect(judge(author(), b)).toMatchObject({ verdict: 'unknown', reason: 'not_observed' })
  })

  it('cannot tell when the log was cut before the file arrived', () => {
    const b = repo(
      'b/app',
      [
        { at: '02 10:00', files: README_B },
        { at: '03 09:00', files: README_B },
        { at: '14 23:51', files: { ...README_B, ...WORK } },
      ],
      {},
      { scanned: 2, stopped: 'cap' },
    )
    expect(judge(author(), b)).toMatchObject({ verdict: 'unknown', reason: 'not_observed' })
  })

  it('does not rank two pushes within the hour', () => {
    const b = (when: string) =>
      repo('b/app', [
        { at: '03 09:00', files: README_B },
        { at: when, files: { ...README_B, ...WORK } },
      ])
    expect(judge(author(), b('12 10:14'))).toMatchObject({ verdict: 'unknown', reason: 'too_close' })
    expect(judge(author(), b('12 11:13'))).toMatchObject({ verdict: 'unknown', reason: 'too_close' })
    expect(judge(author(), b('12 11:15'))).toMatchObject({ verdict: 'a_first', gapMs: CLEAR_GAP_MS + 60_000 })
  })

  it('says "each had some first" when the files went both ways', () => {
    const a = repo('a/app', [
      { at: '05 09:00', files: { ...README_A, 'src/app.js': 'the app' } },
      { at: '12 09:00', files: { ...README_A, ...WORK } },
    ])
    const b = repo('b/app', [
      { at: '06 09:00', files: { ...README_B, 'src/util.js': 'the helpers' } },
      { at: '10 09:00', files: { ...README_B, ...WORK } },
    ])
    const evidence = judge(a, b)
    expect(evidence).toMatchObject({ verdict: 'mixed', undecided: 0 })
    expect([evidence.a.first, evidence.b.first]).toEqual([1, 1])
  })

  it('does not name anyone on one dated file out of thirty', () => {
    const many: Files = {}
    for (let i = 0; i < 30; i++) many[`src/part${i}.js`] = `part ${i}`
    const a = repo(
      'a/app',
      [
        { at: '05 09:00', files: { 'src/part0.js': 'part 0' } },
        { at: '20 09:00', files: many },
      ],
      {},
      { scanned: 1, stopped: 'cap' },
    )
    const b = repo(
      'b/app',
      [
        { at: '02 10:00', files: README_B },
        { at: '10 09:00', files: { ...README_B, 'src/part0.js': 'part 0' } },
        { at: '21 09:00', files: { ...README_B, ...many } },
      ],
      {},
      { scanned: 2, stopped: 'cap' },
    )
    const evidence = judge(a, b)
    expect(evidence).toMatchObject({ verdict: 'unknown', reason: 'mostly_unobserved', shared: 30, undecided: 29 })
    expect(evidence.a.first).toBe(1)
  })
})

describe('judgePair: where a repo comes from', () => {
  const a = () => facts('a/app')
  const blobs = sharedBlobs(headOf('a/app', WORK), headOf('b/app', WORK), new Set())

  it('takes a fork of the other repo as decided, without any log', () => {
    const b = facts('b/app', { isFork: true, parent: 'a/app' })
    expect(judgePair({ a: a(), b, blobs })).toMatchObject({ verdict: 'a_first', basis: 'fork' })
    expect(judgePair({ a: b, b: a(), blobs })).toMatchObject({ verdict: 'b_first', basis: 'fork' })
  })

  it('gives no direction to two copies of the same repo', () => {
    const fork = (name: string) => facts(name, { isFork: true, parent: 'teacher/starter' })
    expect(judgePair({ a: fork('a/app'), b: fork('b/app'), blobs })).toMatchObject({ verdict: 'common_source', basis: null })
    const made = (name: string) => facts(name, { template: 'teacher/template' })
    expect(judgePair({ a: made('a/app'), b: made('b/app'), blobs })).toMatchObject({ verdict: 'common_source' })
  })

  it('cannot tell when one of them is a fork or a template copy of something else', () => {
    for (const b of [
      facts('b/app', { isFork: true, parent: 'someone/else' }),
      // GitHub hides the parent.
      facts('b/app', { isFork: true, parent: null }),
      facts('b/app', { template: 'teacher/template' }),
    ]) {
      expect(judgePair({ a: a(), b, blobs })).toMatchObject({ verdict: 'unknown', reason: 'outside_source' })
      expect(judgePair({ a: b, b: a(), blobs })).toMatchObject({ verdict: 'unknown', reason: 'outside_source' })
    }
  })

  it('cannot tell while the server has not said where a repo comes from', () => {
    const old = facts('b/app', { parent: undefined, template: undefined })
    expect(judgePair({ a: a(), b: old, blobs })).toMatchObject({ verdict: 'unknown', reason: 'not_observed' })
  })

  it('gives no direction to two repos of the same account', () => {
    const second = facts('a/other', { isFork: true, parent: 'a/app' })
    expect(judgePair({ a: a(), b: second, blobs })).toMatchObject({ verdict: 'unknown', reason: 'same_owner' })
  })

  it('says for itself which pairs need no history at all', () => {
    expect(originOf(a(), facts('b/app'))).toBeNull()
    expect(originOf(a(), facts('b/app', { isFork: true, parent: 'a/app' }))).toEqual({ verdict: 'a_first', basis: 'fork', reason: null })
    expect(originOf(a(), facts('a/second'))).toMatchObject({ verdict: 'unknown', reason: 'same_owner' })
  })

  it('names the repo that already held the files when the other one was created', () => {
    const first = repo('a/app', [{ at: '10 09:00', files: WORK }], { pushedAt: at('10 09:00') })
    const later = repo('b/app', [{ at: '13 09:00', files: WORK }], { createdAt: at('12 09:00') })
    // No push log at all: the two creation and push dates are enough.
    const evidence = judge(first, later, { aHistory: undefined, bHistory: undefined })
    expect(evidence).toMatchObject({ verdict: 'a_first', basis: 'created_after', gapMs: at('12 09:00') - at('10 09:00') })
    expect(evidence.a).toMatchObject({ log: 'not_read', seen: 0, unseen: 2, firstAt: null })
  })
})

describe('judgePair: other repos that hold the same files', () => {
  const b = () =>
    repo('b/app', [
      { at: '03 09:00', files: README_B },
      { at: '14 23:51', files: { ...README_B, ...WORK } },
    ])
  const rivals = (notBefore: number, by: number) =>
    new Map(
      Object.values(WORK).map((content) => [
        id(content),
        [{ repo: 'c/app', arrival: { notBefore, by, push: null, hadEarlierVersion: false } }],
      ]),
    )

  it('does not rank two repos when a third had the files before both', () => {
    const evidence = judge(author(), b(), { rivals: rivals(at('05 09:00'), at('05 09:00')) })
    expect(evidence).toMatchObject({ verdict: 'unknown', reason: 'third_repo', elsewhere: 2, otherRepos: 1 })
  })

  it('still names the first when the third got them later', () => {
    expect(judge(author(), b(), { rivals: rivals(at('20 09:00'), at('20 09:00')) })).toMatchObject({ verdict: 'a_first' })
  })

  it('does not count a file a third repo may have had earlier', () => {
    // Nothing is known about the third repo but that it existed before A pushed.
    expect(judge(author(), b(), { rivals: rivals(at('01 08:00'), at('30 08:00')) })).toMatchObject({
      verdict: 'unknown',
      reason: 'third_repo',
    })
  })
})

describe('judgePair: signs that the later repo is where the files were written', () => {
  it('holds back when the later repo worked on the files and the earlier one got them complete', () => {
    const b = repo('b/app', [
      { at: '03 09:00', files: { ...README_B, 'src/app.js': 'a first try' } },
      { at: '14 23:51', files: { ...README_B, ...WORK } },
    ])
    const evidence = judge(author(), b)
    expect(evidence).toMatchObject({ verdict: 'unknown', reason: 'conflict', conflict: 'earlier_versions' })
    expect([evidence.a.grew, evidence.b.grew]).toEqual([0, 1])
  })

  it('lets the result stand when both worked on the files', () => {
    const a = repo('a/app', [
      { at: '02 09:00', files: { ...README_A, 'src/app.js': 'draft of a' } },
      { at: '12 10:14', files: { ...README_A, ...WORK } },
    ])
    const b = repo('b/app', [
      { at: '03 09:00', files: { ...README_B, 'src/app.js': 'draft of b' } },
      { at: '14 23:51', files: { ...README_B, ...WORK } },
    ])
    expect(judge(a, b)).toMatchObject({ verdict: 'a_first', conflict: null })
  })

  it('holds back when the earlier repo carries commits of the later repo\'s owner', () => {
    const a = repo('a/app', [
      { at: '02 09:00', files: README_A },
      { at: '12 10:14', files: { ...README_A, ...WORK }, by: 'b' },
    ])
    const b = repo('b/app', [
      { at: '03 09:00', files: README_B },
      { at: '14 23:51', files: { ...README_B, ...WORK } },
    ])
    const evidence = judge(a, b)
    expect(evidence).toMatchObject({ verdict: 'unknown', reason: 'conflict', conflict: 'commits_by_later_owner' })
    expect(evidence.a.commitsByOther).toBe(1)
  })

  it('holds back when the later repo\'s own commits are dated before the earlier one had the files', () => {
    const b = repo('b/app', [
      { at: '03 09:00', files: README_B },
      // Pushed on the 14th, but the commit says it was written on the 9th.
      { at: '14 23:51', files: { ...README_B, ...WORK }, written: '09 20:00' },
    ])
    expect(judge(author(), b)).toMatchObject({ verdict: 'unknown', reason: 'conflict', conflict: 'older_commits' })
  })

  it('looks only at the commits of the push that brought the files', () => {
    const b = repo('b/app', [
      // An older commit of B's own, in an earlier push: it says nothing about these files.
      { at: '03 09:00', files: README_B, written: '01 09:00' },
      { at: '14 23:51', files: { ...README_B, ...WORK } },
    ])
    expect(judge(author(), b)).toMatchObject({ verdict: 'a_first' })
  })

  it('looks at every commit when the files were not seen arriving', () => {
    const first = repo('a/app', [{ at: '10 09:00', files: WORK }], { pushedAt: at('10 09:00') })
    const later = repo('b/app', [{ at: '13 09:00', files: WORK, written: '04 09:00' }], { createdAt: at('12 09:00') })
    expect(judge(first, later, { aHistory: undefined, bHistory: undefined })).toMatchObject({
      verdict: 'unknown',
      reason: 'conflict',
      conflict: 'older_commits',
    })
  })

  it('does not hold back for commits the later repo took over from the earlier one', () => {
    const a = author()
    // B pushed A's own commit: the very same commit is in both repos.
    const cloned = repo('b/app', [
      { at: '03 09:00', files: README_B },
      { at: '14 23:51', files: { ...README_B, ...WORK }, commit: 'a/app#1', written: '12 10:09', by: null },
    ])
    const evidence = judge(a, cloned)
    expect(evidence).toMatchObject({ verdict: 'a_first', sharedCommits: 1, thirdAuthor: null })

    // Or B committed A's files again, and the commit still names A as its author.
    const recommitted = repo('b/app', [
      { at: '03 09:00', files: README_B },
      { at: '14 23:51', files: { ...README_B, ...WORK }, written: '09 20:00', by: 'a' },
    ])
    const again = judge(a, recommitted)
    expect(again).toMatchObject({ verdict: 'a_first', sharedCommits: 0 })
    expect(again.b.commitsByOther).toBe(1)
  })

  it('sees a common source in shared commits that a third account wrote', () => {
    const shared: Step = { at: '02 09:00', files: README_A, commit: 'tutorial#1', by: 'tutor' }
    const a = repo('a/app', [shared, { at: '12 10:14', files: { ...README_A, ...WORK } }])
    const b = repo('b/app', [{ ...shared, at: '03 09:00' }, { at: '14 23:51', files: { ...README_A, ...WORK } }])
    expect(judge(a, b)).toMatchObject({ verdict: 'common_source', sharedCommits: 1, thirdAuthor: 'tutor' })
  })

  it('reads nothing into shared commits without an account', () => {
    const shared: Step = { at: '02 09:00', files: README_A, commit: 'tutorial#1', by: null }
    const a = repo('a/app', [shared, { at: '12 10:14', files: { ...README_A, ...WORK } }])
    const b = repo('b/app', [{ ...shared, at: '03 09:00' }, { at: '14 23:51', files: { ...README_A, ...WORK } }])
    expect(judge(a, b)).toMatchObject({ verdict: 'a_first', sharedCommits: 1, thirdAuthor: null })
  })

  it('names nobody while a commit history could not be read', () => {
    const b = repo('b/app', [
      { at: '03 09:00', files: README_B },
      { at: '14 23:51', files: { ...README_B, ...WORK } },
    ])
    const a = author()
    expect(judge(a, b, { bCommits: null })).toMatchObject({ verdict: 'unknown', reason: 'commits_unread' })
    expect(judge(a, b, { aCommits: undefined })).toMatchObject({ verdict: 'unknown', reason: 'commits_unread' })
    expect(judge(a, b, { bCommits: { ...b.commits, truncated: true } })).toMatchObject({ reason: 'commits_unread' })
    // The commits of the push that brought the files are on a branch that was not read.
    const withoutLast = { commits: b.commits.commits.slice(0, 1), truncated: false }
    expect(judge(a, b, { bCommits: withoutLast })).toMatchObject({ verdict: 'unknown', reason: 'commits_unread' })
    expect(judge(a, b, { bCommits: null }).b.commitsByOther).toBeNull()
  })
})

describe('pairKey', () => {
  it('names a pair the way the comparison lists it', () => {
    expect(pairKey('a/app', 'b/app')).toBe('a/app|b/app')
  })
})
