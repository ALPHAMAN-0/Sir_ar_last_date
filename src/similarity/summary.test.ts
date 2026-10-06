import { describe, expect, it } from 'vitest'
import type { TreeFile } from '../../shared/api.ts'
import { analyse } from './compare.ts'
import { noSkips } from './rules.ts'
import type { Plan, RepoGroup } from './run.ts'
import { ONLY_STARTER, summarise } from './summary.ts'
import type { Loaded, TreeError } from './trees.ts'
import type { RepoFiles } from './types.ts'

const sha = (content: string) =>
  [...content].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0').repeat(5)

function tree(repo: string, files: Record<string, string>, skipped = noSkips()): RepoFiles {
  const list: TreeFile[] = Object.entries(files).map(([path, content]) => ({ path, sha: sha(content), size: 2000 }))
  return { repo, branch: 'main', headOid: sha(repo), files: list, skipped, unopened: 0 }
}

const who = (rowNumber: number, name: string) => ({ rowId: `r${rowNumber}`, rowNumber, id: `ID-${rowNumber}`, name })
const group = (repo: string, ...people: ReturnType<typeof who>[]): RepoGroup => ({
  repo,
  nameWithOwner: repo,
  isFork: false,
  people,
})

function build(groups: RepoGroup[], trees: RepoFiles[], errors: Record<string, TreeError> = {}, leftOut: Plan['leftOut'] = []) {
  const plan: Plan = {
    groups,
    inputs: groups.map((entry) => ({ repo: entry.repo, headOid: sha(entry.repo), branch: 'main' })),
    leftOut,
    waiting: 0,
  }
  const loaded: Loaded = {
    trees: new Map(trees.map((entry) => [entry.repo, entry])),
    errors: new Map(Object.entries(errors)),
  }
  return summarise(plan, loaded, analyse(trees))
}

const work = { 'app.js': 'the work', 'view.js': 'the view', 'data.js': 'the data' }
const NOTHING =
  'Nothing left to compare. Left out: 900 in third-party or build folders, 3 tool settings and lock files, 12 pictures, fonts and compiled files, 1 almost empty'

describe('summarise', () => {
  it('numbers the pairs strongest first and attaches the people', () => {
    const summary = build(
      [group('a/x', who(2, 'Rahim')), group('b/y', who(3, 'Karim')), group('c/z', who(4, 'Salma'))],
      [tree('a/x', work), tree('b/y', work), tree('c/z', { 'app.js': 'the work', 'own1.js': 'o1', 'own2.js': 'o2', 'own3.js': 'o3', 'own4.js': 'o4', 'own5.js': 'o5' })],
    )
    expect(summary.pairs.map((pair) => [pair.number, pair.a.people[0].name, pair.b.people[0].name, pair.summary.tier])).toEqual([
      [1, 'Rahim', 'Karim', 'almost_all'],
      [2, 'Rahim', 'Salma', 'part'],
      [3, 'Karim', 'Salma', 'part'],
    ])
    expect(summary.compared).toBe(3)
    expect(summary.onlyStarter).toBe(0)
    expect(summary.notCompared).toEqual([])
  })

  it('gives every person their closest match and counts their strong pairs', () => {
    const summary = build(
      [group('a/x', who(2, 'Rahim')), group('b/y', who(3, 'Karim')), group('c/z', who(4, 'Salma'))],
      [tree('a/x', work), tree('b/y', work), tree('c/z', { 'solo.js': 'nobody else' })],
    )
    const [rahim, karim, salma] = summary.people
    expect(rahim).toMatchObject({ compared: true, closest: { label: 'ID-3 · Karim', score: 1, tier: 'almost_all' }, strongPairs: 1 })
    expect(karim.closest?.label).toBe('ID-2 · Rahim')
    expect(salma).toMatchObject({ compared: true, closest: null, strongPairs: 0, note: '' })
  })

  it('lists a repo that several people handed in, and says so on each of their rows', () => {
    const summary = build(
      [group('a/x', who(2, 'Rahim'), who(5, 'Farhana'), who(8, 'Arif')), group('b/y', who(3, 'Karim'))],
      [tree('a/x', work), tree('b/y', { 'other.js': 'other' })],
    )
    expect(summary.sameRepo.map((entry) => entry.repo)).toEqual(['a/x'])
    expect(summary.people.map((line) => [line.person.rowNumber, line.note])).toEqual([
      [2, 'Same repo as rows 5, 8'],
      [3, ''],
      [5, 'Same repo as rows 2, 8'],
      [8, 'Same repo as rows 2, 5'],
    ])
    expect(summary.compared).toBe(2)
  })

  it('puts each repo handed in by several people first, as a 100% match, and numbers the rest after it', () => {
    const summary = build(
      [
        group('a/x', who(2, 'Rahim'), who(5, 'Nusrat'), who(7, 'Arif')),
        group('b/y', who(3, 'Karim')),
        group('c/z', who(4, 'Salma'), who(6, 'Tanvir')),
      ],
      [tree('a/x', work), tree('b/y', work), tree('c/z', { 'solo.js': 'her own' })],
    )
    expect(summary.pairs.map((pair) => [pair.number, pair.kind, pair.a.repo, pair.b.repo, pair.summary.score, pair.summary.tier])).toEqual([
      [1, 'same_repo', 'a/x', 'a/x', 1, 'same_repo'],
      [2, 'same_repo', 'c/z', 'c/z', 1, 'same_repo'],
      [3, 'repos', 'a/x', 'b/y', 1, 'almost_all'],
    ])
    // Every file of the repo counts as identical: it is the same repo.
    expect(summary.pairs[0].summary).toMatchObject({ identical: 3, aOwn: 3, aShare: 1, identicalBytes: 6000 })
  })

  it('names the repo of every closest match', () => {
    const summary = build(
      [group('a/x', who(2, 'Rahim'), who(4, 'Nusrat')), group('b/y', who(3, 'Karim'))],
      [tree('a/x', work), tree('b/y', work)],
    )
    const closest = Object.fromEntries(summary.people.map((line) => [line.person.name, line.closest]))
    expect(closest.Rahim).toEqual({ label: 'Same repo as ID-4 · Nusrat', repo: 'a/x', score: 1, tier: 'same_repo' })
    expect(closest.Nusrat).toEqual({ label: 'Same repo as ID-2 · Rahim', repo: 'a/x', score: 1, tier: 'same_repo' })
    expect(closest.Karim).toEqual({ label: 'ID-2 · Rahim, ID-4 · Nusrat', repo: 'a/x', score: 1, tier: 'almost_all' })
    // The same repo and the copy in another repo both count as strong.
    expect(summary.people.find((line) => line.person.name === 'Rahim')?.strongPairs).toBe(2)
  })

  it('still calls a shared repo a 100% match when its files could not be read', () => {
    const summary = build(
      [group('a/x', who(2, 'Rahim'), who(3, 'Nusrat'))],
      [],
      { 'a/x': { kind: 'not_found', message: 'GitHub no longer shows this repo.' } },
    )
    expect(summary.pairs).toHaveLength(1)
    expect(summary.pairs[0].summary).toMatchObject({ score: 1, identical: 0, tier: 'same_repo' })
  })

  it('accounts for every row that could not be compared, with the reason', () => {
    const summary = build(
      [group('a/x', who(2, 'Rahim')), group('b/gone', who(3, 'Karim'), who(6, 'Nayeem')), group('c/assets', who(4, 'Salma'))],
      [tree('a/x', work), tree('c/assets', {}, { thirdParty: 900, tool: 3, binary: 12, tiny: 1 })],
      { 'b/gone': { kind: 'not_found', message: 'GitHub no longer shows this repo. It may be private or deleted now.' } },
      [{ person: who(5, 'Fahim'), rawLink: 'will send later', reason: 'Link could not be read' }],
    )
    expect(summary.compared).toBe(1)
    expect(summary.notCompared).toEqual([
      { label: 'ID-5 · Fahim', repo: null, reason: 'Link could not be read' },
      { label: 'ID-3 · Karim, ID-6 · Nayeem', repo: 'b/gone', reason: 'GitHub no longer shows this repo. It may be private or deleted now.' },
      { label: 'ID-4 · Salma', repo: 'c/assets', reason: NOTHING },
    ])
    expect(summary.people.map((line) => [line.person.rowNumber, line.compared, line.note])).toEqual([
      [2, true, ''],
      [3, false, 'Same repo as row 6; GitHub no longer shows this repo. It may be private or deleted now.'],
      [4, false, NOTHING],
      [5, false, 'Link could not be read'],
      [6, false, 'Same repo as row 3; GitHub no longer shows this repo. It may be private or deleted now.'],
    ])
    const salma = summary.people[2]
    expect(salma.skipped).toBe(916)
    expect(summary.people[3]).toMatchObject({ repo: null, rawLink: 'will send later', stats: null, skipped: null })
  })

  it('points out a repo that holds nothing but files many others have', () => {
    // Six repos hold the same solution: more than the limit of 4, so it counts as starter code.
    const ring = ['r/1', 'r/2', 'r/3', 'r/4', 'r/5', 'r/6'].map((repo, i) => group(repo, who(i + 2, `Student ${i}`)))
    const summary = build(ring, ring.map((entry) => tree(entry.repo, work)))
    expect(summary.compared).toBe(0)
    expect(summary.onlyStarter).toBe(6)
    expect(summary.pairs).toEqual([])
    expect(summary.notCompared).toHaveLength(6)
    expect(summary.notCompared.every((entry) => entry.reason === ONLY_STARTER)).toBe(true)
  })
})
