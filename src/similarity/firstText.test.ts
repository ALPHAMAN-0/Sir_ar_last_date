import { describe, expect, it } from 'vitest'
import { formatDateTimeShort } from '../logic/time.ts'
import { at, facts, headOf, repo, type Files, type Repo } from '../test/stories.ts'
import { judgePair, sharedBlobs, type JudgeInput, type PairEvidence } from './first.ts'
import type { FirstState } from './firstRun.ts'
import { FIRST_NOTE, evidenceLines, firstLabel, firstTone, isNamed, resultLine } from './firstText.ts'

const NOW = at('30 12:00')
const when = (text: string) => formatDateTimeShort(at(text), NOW)

const README_A: Files = { 'README.md': 'readme of a' }
const README_B: Files = { 'README.md': 'readme of b' }
const WORK: Files = { 'src/app.js': 'the app', 'src/util.js': 'the helpers' }

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

const author = () =>
  repo('a/app', [
    { at: '02 09:00', files: README_A },
    { at: '12 10:14', files: { ...README_A, ...WORK } },
  ])
const copier = (day = '14 23:51') =>
  repo('b/app', [
    { at: '03 09:00', files: README_B },
    { at: day, files: { ...README_B, ...WORK } },
  ])
const ready = (evidence: PairEvidence): FirstState => ({ state: 'ready', evidence })

describe('the table cell', () => {
  it('says what state the check is in', () => {
    expect(firstLabel(undefined)).toBe('–')
    expect(firstLabel({ state: 'waiting' })).toBe('Open to check')
    expect(firstLabel({ state: 'checking' })).toBe('Checking…')
    expect(firstTone(undefined)).toBe('muted')
    expect(firstTone({ state: 'checking' })).toBe('muted')
  })

  it('names the first repo, and stays quiet about everything else', () => {
    const named = judge(author(), copier())
    expect([firstLabel(ready(named)), firstTone(ready(named)), isNamed(named)]).toEqual(['A first', 'warn', true])
    const other = judge(copier(), author())
    expect([firstLabel(ready(other)), firstTone(ready(other))]).toEqual(['B first', 'warn'])

    const close = judge(author(), copier('12 10:30'))
    expect([firstLabel(ready(close)), firstTone(ready(close)), isNamed(close)]).toEqual(['Cannot tell', 'muted', false])

    const fork = (name: string) => facts(name, { isFork: true, parent: 'teacher/starter' })
    const same = judgePair({ a: fork('a/app'), b: fork('b/app'), blobs: [] })
    expect([firstLabel(ready(same)), firstTone(ready(same))]).toEqual(['Same source', 'info'])

    const a = repo('a/app', [
      { at: '05 09:00', files: { 'src/app.js': 'the app' } },
      { at: '12 09:00', files: WORK },
    ])
    const b = repo('b/app', [
      { at: '06 09:00', files: { 'src/util.js': 'the helpers' } },
      { at: '10 09:00', files: WORK },
    ])
    const mixed = judge(a, b)
    expect([firstLabel(ready(mixed)), firstTone(ready(mixed))]).toEqual(['Each had some first', 'info'])
    expect(resultLine(mixed, 'almost_all')).toBe('Cannot tell. Each had some of the files first (A 1, B 1).')
  })
})

describe('the result in one sentence', () => {
  it('says "likely copied" only of a pair that is mostly identical', () => {
    const evidence = judge(author(), copier())
    expect(resultLine(evidence, 'almost_all')).toBe('B likely copied from A')
    expect(resultLine(evidence, 'most')).toBe('B likely copied from A')
    for (const tier of ['part', 'little', 'thin'] as const) {
      expect(resultLine(evidence, tier)).toBe('A had these files first')
    }
    const other = judge(copier(), author())
    expect(resultLine(other, 'most')).toBe('A likely copied from B')
    expect(resultLine(other, 'thin')).toBe('B had these files first')
  })

  it('says why it cannot tell', () => {
    const a = author()
    const blobs = sharedBlobs(headOf('a/app', WORK), headOf('b/app', WORK), new Set())
    const from = (b: Parameters<typeof facts>[1], aOver: Parameters<typeof facts>[1] = {}) =>
      resultLine(judgePair({ a: facts('a/app', aOver), b: facts('b/app', b), blobs }), 'most')

    expect(resultLine(judge(a, copier('12 10:30')), 'most')).toBe(
      'Cannot tell. The two pushed these files within an hour of each other.',
    )
    expect(from({ isFork: true, parent: 'teacher/starter' }, { isFork: true, parent: 'teacher/starter' })).toBe(
      'Cannot tell. Both repos are forks of teacher/starter, so the files may come from there.',
    )
    expect(from({ template: 'teacher/template' }, { template: 'teacher/template' })).toBe(
      'Cannot tell. Both repos were generated from teacher/template, so the files may come from there.',
    )
    expect(from({ isFork: true, parent: 'someone/else' })).toBe(
      "Cannot tell. B's repo is a fork of someone/else, so the files may come from there.",
    )
    expect(from({ isFork: true, parent: null })).toBe(
      "Cannot tell. B's repo is a fork, and GitHub does not show of what, so the files may come from there.",
    )
    expect(from({}, { template: 'teacher/template' })).toBe(
      "Cannot tell. A's repo was generated from teacher/template, so the files may come from there.",
    )
    expect(resultLine(judgePair({ a: facts('a/app'), b: facts('a/other'), blobs }), 'most')).toBe(
      'Cannot tell. Both repos belong to the same GitHub account.',
    )
    expect(resultLine(judge(a, copier(), { bCommits: null }), 'most')).toBe(
      'Cannot tell. The commit history could not be read. Try again later.',
    )
    const noLog = repo('b/app', [{ at: '14 09:00', files: WORK }], {}, { log: 'none' })
    expect(resultLine(judge(a, noLog), 'most')).toBe('Cannot tell. GitHub does not show enough of what happened.')

    const rivals = new Map(
      Object.values(WORK).map((content) => [
        sharedBlobs(headOf('x/y', { f: content }), headOf('x/z', { f: content }), new Set())[0].sha,
        [{ repo: 'c/app', arrival: { notBefore: at('05 09:00'), by: at('05 09:00'), push: null, hadEarlierVersion: false } }],
      ]),
    )
    expect(resultLine(judge(a, copier(), { rivals }), 'most')).toBe(
      'Cannot tell. Another repo of this sheet may have had these files before both.',
    )
  })

  it('names the sign that spoke against the push times', () => {
    const drafted = repo('b/app', [
      { at: '03 09:00', files: { ...README_B, 'src/app.js': 'a first try' } },
      { at: '14 23:51', files: { ...README_B, ...WORK } },
    ])
    expect(resultLine(judge(author(), drafted), 'most')).toBe(
      "Cannot tell. A had the files first, but B's repo held earlier versions of them.",
    )
    const tookHistory = repo('a/app', [
      { at: '02 09:00', files: README_A },
      { at: '12 10:14', files: { ...README_A, ...WORK }, by: 'b' },
    ])
    expect(resultLine(judge(tookHistory, copier()), 'most')).toBe(
      "Cannot tell. A had the files first, but A's repo contains commits written by B's account.",
    )
    const wroteEarlier = repo('b/app', [
      { at: '03 09:00', files: README_B },
      { at: '14 23:51', files: { ...README_B, ...WORK }, written: '09 20:00' },
    ])
    expect(resultLine(judge(author(), wroteEarlier), 'most')).toBe(
      "Cannot tell. A pushed the files first, but B's own commits are dated earlier. Commit dates are set by the author.",
    )
    // The same, with the sides the other way round.
    expect(resultLine(judge(wroteEarlier, author()), 'most')).toBe(
      "Cannot tell. B pushed the files first, but A's own commits are dated earlier. Commit dates are set by the author.",
    )
  })

  it('counts the files it could date when they are too few', () => {
    const many: Files = {}
    for (let i = 0; i < 30; i++) many[`src/part${i}.js`] = `part ${i}`
    const a = repo('a/app', [{ at: '05 09:00', files: { 'src/part0.js': 'part 0' } }, { at: '20 09:00', files: many }], {}, { scanned: 1, stopped: 'cap' })
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
    expect(resultLine(evidence, 'almost_all')).toBe('Cannot tell. Only 1 of the 30 files could be dated.')
    expect(evidenceLines(evidence, NOW)).toEqual(
      expect.arrayContaining([
        `A pushed 1 of them ${when('05 09:00')}`,
        "Only the first 1 push of A's repo were read",
        "Only the first 2 pushes of B's repo were read",
      ]),
    )
  })
})

describe('the evidence, line by line', () => {
  it('tells when each repo pushed the files and how far apart', () => {
    expect(evidenceLines(judge(author(), copier()), NOW)).toEqual([
      `A pushed them ${when('12 10:14')}`,
      `B pushed them ${when('14 23:51')}`,
      'B got them 2d 13h later',
      "A's repo has 5 commits in all, B's has 5",
    ])
  })

  it('tells how the files arrived when one repo got them bit by bit', () => {
    const a = repo('a/app', [
      { at: '02 09:00', files: { ...README_A, 'src/app.js': 'draft of the app' } },
      { at: '05 09:00', files: { ...README_A, 'src/app.js': 'the app' } },
      { at: '12 10:14', files: { ...README_A, ...WORK } },
    ])
    expect(evidenceLines(judge(a, copier()), NOW)).toEqual([
      `In A's repo they arrived over 2 pushes, ${when('05 09:00')} to ${when('12 10:14')}`,
      `B pushed them ${when('14 23:51')}`,
      'B got them 2d 13h later',
      "In B's repo all 2 of these files arrived in one push",
      "A's repo held earlier versions of 1 of these files; in B's they arrived complete",
      "A's repo has 5 commits in all, B's has 5",
    ])
  })

  it('tells that the later repo did not exist yet', () => {
    const first = repo('a/app', [{ at: '10 09:00', files: WORK }], { pushedAt: at('10 09:00'), totalCommits: 1 })
    const later = repo('b/app', [{ at: '13 09:00', files: WORK }], { createdAt: at('12 09:00') })
    const evidence = judge(first, later, { aHistory: undefined, bHistory: undefined })
    expect(evidenceLines(evidence, NOW)).toEqual([
      `A had them by ${when('10 09:00')}; when exactly cannot be seen`,
      `B had them by ${when('30 08:00')}; when exactly cannot be seen`,
      `B's repo did not exist until ${when('12 09:00')}`,
      "B's repo was created 2d after the other had them",
      "A's repo has 1 commit in all, B's has 5",
    ])
  })

  it('tells who wrote the commits', () => {
    const recommitted = repo('b/app', [
      { at: '03 09:00', files: README_B },
      { at: '14 23:51', files: { ...README_B, ...WORK }, by: 'a' },
    ])
    expect(evidenceLines(judge(author(), recommitted), NOW)).toContain(
      "1 commit in B's repo is written by A's GitHub account",
    )
    const shared = { at: '02 09:00', files: README_A, commit: 'tutorial#1', by: 'tutor' }
    const a = repo('a/app', [shared, { at: '12 10:14', files: { ...README_A, ...WORK } }])
    const b = repo('b/app', [{ ...shared, at: '03 09:00' }, { at: '14 23:51', files: { ...README_A, ...WORK } }])
    const evidence = judge(a, b)
    expect(evidenceLines(evidence, NOW)).toContain('The two repos share 1 commit, written by the account tutor')
    expect(resultLine(evidence, 'most')).toBe(
      'Cannot tell. Both repos contain commits written by tutor, so both may come from a third repo.',
    )
  })

  it('tells where a repo comes from, and that other repos hold the files too', () => {
    const blobs = sharedBlobs(headOf('a/app', WORK), headOf('b/app', WORK), new Set())
    const fork = judgePair({ a: facts('a/app'), b: facts('b/app', { isFork: true, parent: 'a/app' }), blobs })
    expect(evidenceLines(fork, NOW)[0]).toBe("B's repo is a GitHub fork of A's repo")
    expect(evidenceLines(judgePair({ a: facts('b/app', { isFork: true, parent: 'a/app' }), b: facts('a/app'), blobs }), NOW)[0]).toBe(
      "A's repo is a GitHub fork of B's repo",
    )
    const outside = judgePair({ a: facts('a/app', { template: 't/starter' }), b: facts('b/app', { isFork: true, parent: 'x/y' }), blobs })
    expect(evidenceLines(outside, NOW).slice(0, 2)).toEqual([
      "A's repo was generated from t/starter",
      "B's repo is a fork of x/y",
    ])

    const rivals = new Map(
      blobs.map((blob) => [
        blob.sha,
        [{ repo: 'c/app', arrival: { notBefore: at('20 09:00'), by: at('20 09:00'), push: null, hadEarlierVersion: false } }],
      ]),
    )
    expect(evidenceLines(judge(author(), copier(), { rivals }), NOW)).toContain(
      '2 of these files are also in 1 other repo of this sheet',
    )
  })

  it('tells what could not be seen', () => {
    const a = author()
    const lines = (read: Parameters<typeof repo>[3], over: Parameters<typeof repo>[2] = {}) =>
      evidenceLines(
        judge(
          a,
          repo('b/app', [{ at: '03 09:00', files: README_B }, { at: '14 23:51', files: { ...README_B, ...WORK } }], over, read),
        ),
        NOW,
      )
    expect(lines({ log: 'none' })).toContain("GitHub has no push log for B's repo")
    expect(lines({ log: 'failed' })).toContain("The push log of B's repo could not be loaded")
    expect(lines({ log: 'unsettled' })).toContain("B's repo was pushed minutes ago; check again shortly")
    expect(lines({ scanned: 1, stopped: 'too_large' })).toContain("B's repo is too large to look back in time")
    expect(lines({ scanned: 1, stopped: 'gone' })).toContain("An older state of B's repo can no longer be read")
    expect(lines({ scanned: 1, stopped: 'failed' })).toContain("Reading B's repo stopped at an error; try again")
    expect(lines({}, { createdAt: Date.parse('2022-03-01T00:00:00Z') })).toContain(
      "GitHub's push log does not show how B's repo began",
    )
    // Nothing is missing for a repo that was read from its first push to its last.
    expect(lines({}).join(' ')).not.toMatch(/cannot|could not|no push log|Only the first/)
  })

  it('carries one fixed note for every named result', () => {
    expect(FIRST_NOTE).toMatch(/outside GitHub/)
  })
})
