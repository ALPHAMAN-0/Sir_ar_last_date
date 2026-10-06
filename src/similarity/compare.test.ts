import { describe, expect, it } from 'vitest'
import type { TreeFile } from '../../shared/api.ts'
import {
  analyse,
  defaultCommonLimit,
  pairCount,
  pairDetail,
  sharedSets,
  tier,
} from './compare.ts'
import { noSkips } from './rules.ts'
import type { RepoFiles } from './types.ts'

/** A fake content hash: the same word always gives the same 40 characters. */
const sha = (content: string) =>
  [...content].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0').repeat(5)

/** `'src/a.js': 'hello'` is a file at that path whose content is "hello". Size defaults to 2 KB. */
function repo(name: string, files: Record<string, string | [content: string, size: number]>, headOid = sha(name)): RepoFiles {
  const list: TreeFile[] = Object.entries(files).map(([path, value]) => {
    const [content, size] = typeof value === 'string' ? [value, 2000] : value
    return { path, sha: sha(content), size }
  })
  return { repo: name, branch: 'main', headOid, files: list, skipped: noSkips(), unopened: 0 }
}

const pairOf = (repos: RepoFiles[], a: string, b: string, commonLimit?: number) =>
  analyse(repos, { commonLimit }).pairs.find((pair) => pair.aKey === a && pair.bKey === b)

describe('defaultCommonLimit', () => {
  it('is a fifth of the class, between 4 and 10', () => {
    expect(defaultCommonLimit(0)).toBe(4)
    expect(defaultCommonLimit(3)).toBe(4)
    expect(defaultCommonLimit(20)).toBe(4)
    expect(defaultCommonLimit(30)).toBe(6)
    expect(defaultCommonLimit(40)).toBe(8)
    expect(defaultCommonLimit(200)).toBe(10)
  })
})

describe('pairCount', () => {
  it('counts the pairs N repos can form', () => {
    expect([0, 1, 2, 3, 4, 200].map(pairCount)).toEqual([0, 0, 1, 3, 6, 19900])
  })
})

describe('analyse: identical content', () => {
  it('finds a full copy', () => {
    const files = { 'index.html': 'page', 'app.js': 'logic', 'style.css': 'look' }
    const pair = pairOf([repo('a/x', files), repo('b/y', files)], 'a/x', 'b/y')
    expect(pair).toMatchObject({
      identical: 3,
      aIdentical: 3,
      bIdentical: 3,
      aOwn: 3,
      bOwn: 3,
      aShare: 1,
      bShare: 1,
      score: 1,
      tier: 'almost_all',
    })
  })

  it('finds a copy whose files were all renamed and moved', () => {
    const pair = pairOf(
      [
        repo('a/x', { 'index.html': 'page', 'app.js': 'logic', 'style.css': 'look' }),
        repo('b/y', { 'home.html': 'page', 'js/main.js': 'logic', 'css/theme.css': 'look' }),
      ],
      'a/x',
      'b/y',
    )
    expect(pair).toMatchObject({ identical: 3, score: 1, sameName: 0, tier: 'almost_all' })
  })

  it('does not match files that only share a name', () => {
    const result = analyse([
      repo('a/x', { 'index.html': 'mine', 'app.js': 'my logic', 'style.css': 'my look' }),
      repo('b/y', { 'index.html': 'yours', 'app.js': 'your logic', 'style.css': 'your look' }),
    ])
    expect(result.pairs).toEqual([])
    expect(result.totalPairs).toBe(1)
  })

  it('gives each side its own percentage when one repo holds all of the other', () => {
    const small = { 'a.js': 'one', 'b.js': 'two', 'c.js': 'three' }
    const big = { ...small, 'd.js': 'four', 'e.js': 'five', 'f.js': 'six', 'g.js': 'seven', 'h.js': 'eight', 'i.js': 'nine' }
    const pair = pairOf([repo('a/small', small), repo('b/big', big)], 'a/small', 'b/big')
    expect(pair).toMatchObject({ aIdentical: 3, aOwn: 3, aShare: 1, bIdentical: 3, bOwn: 9, score: 1 })
    expect(pair?.bShare).toBeCloseTo(1 / 3)
  })

  it('counts a content once even when a repo keeps two copies of it', () => {
    const pair = pairOf(
      [
        repo('a/x', { 'a.js': 'same', 'copy/a.js': 'same', 'own.js': 'mine' }),
        repo('b/y', { 'a.js': 'same', 'other.js': 'theirs' }),
      ],
      'a/x',
      'b/y',
    )
    expect(pair).toMatchObject({ identical: 1, aIdentical: 2, bIdentical: 1, identicalBytes: 2000 })
  })

  it('notes when two repos are at the very same commit', () => {
    const files = { 'a.js': 'one', 'b.js': 'two', 'c.js': 'three' }
    const head = 'f'.repeat(40)
    expect(pairOf([repo('a/x', files, head), repo('b/y', files, head)], 'a/x', 'b/y')?.sameCommit).toBe(true)
    expect(pairOf([repo('a/x', files), repo('b/y', files)], 'a/x', 'b/y')?.sameCommit).toBe(false)
  })

  it('returns nothing for no repos, one repo, or empty repos', () => {
    expect(analyse([]).pairs).toEqual([])
    expect(analyse([repo('a/x', { 'a.js': 'one' })]).pairs).toEqual([])
    expect(analyse([repo('a/x', {}), repo('b/y', {})]).pairs).toEqual([])
  })

  it('counts possible pairs only among repos that have files of their own', () => {
    const result = analyse([repo('a/x', { 'a.js': 'one' }), repo('b/y', { 'b.js': 'two' }), repo('c/empty', {})])
    expect(result.totalPairs).toBe(1)
    expect(result.repos.find((entry) => entry.repo === 'c/empty')).toEqual({ repo: 'c/empty', counted: 0, starter: 0, own: 0 })
  })

  it('does not change its input', () => {
    const a = repo('a/x', { 'b.js': 'two', 'a.js': 'one' })
    const before = JSON.stringify(a)
    analyse([a, repo('b/y', { 'a.js': 'one' })])
    expect(JSON.stringify(a)).toBe(before)
  })
})

describe('analyse: starter files', () => {
  // Six students. Everyone has the teacher's two files; only a/1 and a/2 share their own work.
  const starter = { 'starter/helpers.js': 'handed out', 'starter/data.json': 'handed out too' }
  const klass = [
    repo('a/1', { ...starter, 'app.js': 'copied work', 'view.js': 'copied view', 'x.js': 'copied x' }),
    repo('a/2', { ...starter, 'app.js': 'copied work', 'view.js': 'copied view', 'x.js': 'copied x' }),
    repo('a/3', { ...starter, 'app.js': 'work 3' }),
    repo('a/4', { ...starter, 'app.js': 'work 4' }),
    repo('a/5', { ...starter, 'app.js': 'work 5' }),
    repo('a/6', { ...starter, 'app.js': 'work 6' }),
  ]

  it('leaves files that most repos share out of both sides of the percentage', () => {
    const result = analyse(klass)
    expect(result.commonLimit).toBe(4)
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]).toMatchObject({ aKey: 'a/1', bKey: 'a/2', identical: 3, aOwn: 3, score: 1 })
    expect(result.repos.find((r) => r.repo === 'a/3')).toEqual({ repo: 'a/3', counted: 3, starter: 2, own: 1 })
  })

  it('lists the starter files, most widespread first', () => {
    expect(analyse(klass).starter).toEqual([
      { sha: sha('handed out too'), path: 'starter/data.json', size: 2000, repos: 6 },
      { sha: sha('handed out'), path: 'starter/helpers.js', size: 2000, repos: 6 },
    ])
  })

  it('counts them again when the limit is raised above the class size', () => {
    const result = analyse(klass, { commonLimit: 6 })
    expect(result.starter).toEqual([])
    expect(result.pairs).toHaveLength(15)
    expect(result.pairs[0]).toMatchObject({ aKey: 'a/1', bKey: 'a/2', identical: 5, aOwn: 5 })
  })

  it('still catches a group of four that all hold the same solution', () => {
    const solution = { 'app.js': 'the solution', 'view.js': 'its view', 'util.js': 'its helpers' }
    const ring = ['r/1', 'r/2', 'r/3', 'r/4'].map((name) => repo(name, solution))
    const others = ['o/1', 'o/2', 'o/3', 'o/4', 'o/5', 'o/6'].map((name) => repo(name, { 'app.js': `own ${name}` }))
    const result = analyse([...ring, ...others])
    expect(result.pairs).toHaveLength(6)
    expect(result.pairs.every((pair) => pair.score === 1 && pair.tier === 'almost_all')).toBe(true)
  })

  it('never lets the limit drop below 2, or no pair could ever match', () => {
    const files = { 'a.js': 'one', 'b.js': 'two', 'c.js': 'three' }
    const result = analyse([repo('a/x', files), repo('b/y', files)], { commonLimit: 0 })
    expect(result.commonLimit).toBe(2)
    expect(result.pairs).toHaveLength(1)
  })

  it('names a starter file after what most repos call it', () => {
    const repos = [
      repo('a/1', { 'lib/util.js': 'shared' }),
      repo('a/2', { 'lib/util.js': 'shared' }),
      repo('a/3', { 'helpers.js': 'shared' }),
    ]
    expect(analyse(repos, { commonLimit: 2 }).starter[0]).toMatchObject({ path: 'lib/util.js', repos: 3 })
  })
})

describe('analyse: same names, other content', () => {
  it('does not list a pair without one identical file, even when every name matches', () => {
    const edited = (by: string) => ({
      'src/GradeBook.java': `gradebook ${by}`,
      'src/StudentRecord.java': `record ${by}`,
      'src/ReportPrinter.java': `printer ${by}`,
    })
    expect(analyse([repo('a/x', edited('a')), repo('b/y', edited('b'))]).pairs).toEqual([])
  })

  it('reports same-name files next to identical ones', () => {
    const pair = pairOf(
      [
        repo('a/x', { 'a.js': 'same', 'b.js': 'same too', 'c.js': 'same three', 'd.js': 'edited by a' }),
        repo('b/y', { 'a.js': 'same', 'b.js': 'same too', 'c.js': 'same three', 'd.js': 'edited by b' }),
      ],
      'a/x',
      'b/y',
    )
    expect(pair).toMatchObject({ identical: 3, sameName: 1, tier: 'most' })
    expect(pair?.score).toBeCloseTo(0.75)
  })

  it('ignores a path that most of the class uses', () => {
    // Everyone has src/App.jsx with their own content; only a/1 and a/2 share a file.
    const repos = ['1', '2', '3', '4', '5'].map((n) =>
      repo(`a/${n}`, { 'src/App.jsx': `app ${n}`, 'src/util.js': n === '1' || n === '2' ? 'shared util' : `util ${n}` }),
    )
    const pair = pairOf(repos, 'a/1', 'a/2', 4)
    expect(pair).toMatchObject({ identical: 1, sameName: 0 })
  })

  it('does not call a moved file a same-name file', () => {
    // b/y holds a/x's a.js under the name b.js, and something else at a.js.
    const pair = pairOf(
      [
        repo('a/x', { 'a.js': 'alpha', 'b.js': 'beta', 'c.js': 'gamma' }),
        repo('b/y', { 'a.js': 'beta', 'b.js': 'alpha', 'c.js': 'gamma' }),
      ],
      'a/x',
      'b/y',
    )
    expect(pair).toMatchObject({ identical: 3, sameName: 0 })
  })
})

describe('tier', () => {
  it('follows the share when there is enough material', () => {
    const many = { identical: 5, identicalBytes: 5000 }
    expect(tier({ ...many, score: 1 })).toBe('almost_all')
    expect(tier({ ...many, score: 0.8 })).toBe('almost_all')
    expect(tier({ ...many, score: 0.79 })).toBe('most')
    expect(tier({ ...many, score: 0.5 })).toBe('most')
    expect(tier({ ...many, score: 0.49 })).toBe('part')
    expect(tier({ ...many, score: 0.2 })).toBe('part')
    expect(tier({ ...many, score: 0.19 })).toBe('little')
  })

  it('calls one or two small files thin, however big their share', () => {
    expect(tier({ identical: 1, identicalBytes: 300, score: 1 })).toBe('thin')
    expect(tier({ identical: 2, identicalBytes: 1023, score: 0.9 })).toBe('thin')
    expect(tier({ identical: 1, identicalBytes: 300, score: 0.05 })).toBe('thin')
  })

  it('accepts one file as real material once it is a kilobyte, or three files of any size', () => {
    expect(tier({ identical: 1, identicalBytes: 1024, score: 1 })).toBe('almost_all')
    expect(tier({ identical: 3, identicalBytes: 300, score: 1 })).toBe('almost_all')
    expect(tier({ identical: 1, identicalBytes: 1024, score: 0.1 })).toBe('little')
  })
})

describe('analyse: order', () => {
  it('puts the strongest label first and thin matches last, whatever their share', () => {
    const big = { 'a.js': 'A', 'b.js': 'B', 'c.js': 'C', 'd.js': 'D', 'e.js': 'E' }
    const repos = [
      repo('p/full', big),
      repo('p/full-copy', big),
      repo('q/half', { 'm.js': 'q1', 'n.js': 'q2', 'o.js': 'q3', 'p.js': 'q4' }),
      repo('q/half-copy', { 'm.js': 'q1', 'n.js': 'q2', 'o.js': 'q3', 'p.js': 'other' }),
      repo('r/tiny', { 'only.js': ['tiny', 100] }),
      repo('r/tiny-copy', { 'only.js': ['tiny', 100], 'more.js': 'something' }),
      repo('s/few', { 'k.js': 'few', 'k1.js': 's1', 'k2.js': 's2', 'k3.js': 's3', 'k4.js': 's4', 'k5.js': 's5', 'k6.js': 's6', 'k7.js': 's7', 'k8.js': 's8', 'k9.js': 's9' }),
      repo('s/few-copy', { 'k.js': 'few', 'l1.js': 't1', 'l2.js': 't2', 'l3.js': 't3', 'l4.js': 't4', 'l5.js': 't5', 'l6.js': 't6', 'l7.js': 't7', 'l8.js': 't8', 'l9.js': 't9' }),
    ]
    expect(analyse(repos, { commonLimit: 10 }).pairs.map((pair) => `${pair.aKey}~${pair.bKey} ${pair.tier}`)).toEqual([
      'p/full~p/full-copy almost_all',
      'q/half~q/half-copy most',
      's/few~s/few-copy little',
      'r/tiny~r/tiny-copy thin',
    ])
  })

  it('gives the same order for the same input', () => {
    const files = { 'a.js': 'one', 'b.js': 'two', 'c.js': 'three' }
    const repos = ['d/1', 'b/1', 'c/1', 'a/1'].map((name) => repo(name, files))
    const keys = (list: RepoFiles[]) => analyse(list).pairs.map((pair) => `${pair.aKey}~${pair.bKey}`)
    expect(keys(repos)).toEqual(keys(repos))
    expect(keys(repos)).toHaveLength(6)
  })
})

describe('analyse: a whole class', () => {
  it('handles 200 repos of 100 files quickly and returns only the pairs that share something', () => {
    const repos: RepoFiles[] = []
    for (let s = 0; s < 200; s++) {
      const files: Record<string, string> = {}
      // 20 handed-out files, 80 of the student's own.
      for (let f = 0; f < 20; f++) files[`starter/file${f}.js`] = `starter ${f}`
      for (let f = 0; f < 80; f++) files[`src/File${f}.js`] = `student ${s} file ${f}`
      repos.push(repo(`s${s}/project`, files))
    }
    // Student 7 copied half of student 3's work.
    for (let f = 0; f < 40; f++) repos[7].files[20 + f] = { ...repos[3].files[20 + f] }

    const started = performance.now()
    const result = analyse(repos)
    const elapsed = performance.now() - started

    expect(result.totalPairs).toBe(19900)
    expect(result.starter).toHaveLength(20)
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]).toMatchObject({ aKey: 's3/project', bKey: 's7/project', identical: 40, aOwn: 80 })
    expect(result.pairs[0].score).toBeCloseTo(0.5)
    expect(elapsed).toBeLessThan(2000)
  })
})

describe('pairDetail', () => {
  const a = repo('a/x', {
    'app.js': ['shared logic', 5000],
    'style.css': ['shared look', 900],
    'report.md': 'report by a',
    'notes.txt': 'only a has this',
    'starter.js': 'handed out',
  })
  const b = repo('b/y', {
    'js/main.js': ['shared logic', 5000],
    'style.css': ['shared look', 900],
    'report.md': 'report by b',
    'extra.py': 'only b has this',
    'another.py': 'only b has this too',
    'starter.js': 'handed out',
  })
  const filler = ['c/1', 'c/2', 'c/3', 'c/4'].map((name) => repo(name, { 'starter.js': 'handed out', 'own.js': `own ${name}` }))
  const analysis = analyse([a, b, ...filler])
  const detail = pairDetail(a, b, sharedSets(analysis))

  it('lists identical files with both paths, largest first', () => {
    expect(detail.identical).toEqual([
      { aPath: 'app.js', bPath: 'js/main.js', size: 5000 },
      { aPath: 'style.css', bPath: 'style.css', size: 900 },
    ])
  })

  it('lists files with the same path and other content', () => {
    expect(detail.sameName).toEqual([{ path: 'report.md', aSize: 2000, bSize: 2000 }])
  })

  it('counts what only one side has, and the starter files both have', () => {
    expect(detail.onlyA).toBe(1)
    expect(detail.onlyB).toBe(2)
    expect(detail.starter).toBe(1)
  })

  it('agrees with the numbers in the summary', () => {
    const summary = analysis.pairs.find((pair) => pair.aKey === 'a/x' && pair.bKey === 'b/y')
    expect(summary).toMatchObject({
      aIdentical: detail.identical.length,
      sameName: detail.sameName.length,
      aOwn: detail.identical.length + detail.sameName.length + detail.onlyA,
    })
  })

  it('points at the twin with the same path when a content sits in two places', () => {
    const left = repo('l/x', { 'lib/a.js': 'twin' })
    const right = repo('r/y', { 'backup/a.js': 'twin', 'lib/a.js': 'twin' })
    const result = pairDetail(left, right, { starter: new Set(), commonPaths: new Set() })
    expect(result.identical).toEqual([{ aPath: 'lib/a.js', bPath: 'lib/a.js', size: 2000 }])
  })
})
