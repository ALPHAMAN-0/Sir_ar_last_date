import { describe, expect, it } from 'vitest'
import { codeOf, printText } from './codeText.ts'
import {
  MIN_LISTED_LINES,
  STRONG_LINES,
  analyseCode,
  codePairDetail,
  codeTier,
  countLines,
  coveredRanges,
  type CodeRepo,
} from './sharedCode.ts'

/** A fake content hash: the same text always gives the same 40 characters. */
const sha = (content: string) =>
  [...content].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0').repeat(5)

/** `'src/a.js': 'code'` is a file at that path holding that code. */
function repo(name: string, files: Record<string, string>): CodeRepo {
  return {
    repo: name,
    files: Object.entries(files).map(([path, text]) => ({
      path,
      sha: sha(text),
      prints: printText(codeOf(path, text) ?? ''),
    })),
  }
}

/** `count` lines of made-up code, all different. `name` makes another person's code. */
const program = (count: number, name = 'total') =>
  Array.from({ length: count }, (_, i) => `let ${name}${i} = compute(${i}, "${name} item ${i}") + offset * ${i + 3};`).join('\n')

/** The same code with spaces, case and a few lines changed, and a comment added. */
function disguise(code: string, every = 10): string {
  const lines = code.split('\n').map((line, i) => (i % every === every - 1 ? `console.log("my own line ${i}")` : line))
  return `// written by me\n${lines.join('\r\n').toUpperCase().replace(/ = /g, '=')}`
}

const pairOf = (repos: CodeRepo[], a: string, b: string, commonLimit = 4) =>
  analyseCode(repos, { commonLimit }).pairs.find((pair) => pair.aKey === a && pair.bKey === b)

describe('coveredRanges and countLines', () => {
  const prints = { values: [1, 2, 3, 4], from: [1, 2, 6, 9], to: [3, 4, 7, 12], lines: [1, 2, 3, 4, 6, 7, 9, 10, 11, 12] }

  it('joins overlapping and touching runs into line ranges', () => {
    expect(coveredRanges(prints, () => true)).toEqual([[1, 4], [6, 7], [9, 12]])
    expect(coveredRanges(prints, (value) => value !== 2 && value !== 3)).toEqual([[1, 3], [9, 12]])
    expect(coveredRanges(prints, () => false)).toEqual([])
  })

  it('counts only lines that hold code', () => {
    // Line 5 and line 8 are blank: inside a range, but not counted.
    expect(countLines(prints.lines, [[1, 12]])).toBe(10)
    expect(countLines(prints.lines, [[1, 4], [9, 10]])).toBe(6)
    expect(countLines(prints.lines, [])).toBe(0)
  })
})

describe('codeTier', () => {
  it('labels by share when enough lines are shared, and as a few lines when not', () => {
    expect(codeTier(STRONG_LINES - 1, 1)).toBe('thin')
    expect(codeTier(STRONG_LINES, 0.8)).toBe('almost_all')
    expect(codeTier(STRONG_LINES, 0.5)).toBe('most')
    expect(codeTier(STRONG_LINES, 0.2)).toBe('part')
    expect(codeTier(STRONG_LINES, 0.19)).toBe('little')
  })
})

describe('analyseCode', () => {
  it('finds a copy that changed spaces, case, comments and some lines', () => {
    const original = program(60)
    const pair = pairOf([repo('a', { 'index.js': original }), repo('b', { 'main.js': disguise(original) })], 'a', 'b')
    expect(pair).toBeDefined()
    expect(pair?.aShare).toBeGreaterThan(0.8)
    expect(pair?.bShare).toBeGreaterThan(0.8)
    expect(pair?.tier).toBe('almost_all')
    expect(pair?.aFiles).toBe(1)
    expect(pair?.bFiles).toBe(1)
  })

  it('finds nothing between two people who wrote their own code', () => {
    const analysis = analyseCode([repo('a', { 'a.js': program(60, 'alpha') }), repo('b', { 'b.js': program(60, 'beta') })], {
      commonLimit: 4,
    })
    expect(analysis.pairs).toEqual([])
  })

  it('does not count code that more repos have than the limit allows', () => {
    const handedOut = program(40, 'starter')
    // Five repos hold the handed-out code, each with its own code after it.
    const names = ['a', 'b', 'c', 'd', 'e']
    const repos = names.map((name) => repo(name, { 'index.js': `${handedOut}\n${program(20, name)}` }))
    const analysis = analyseCode(repos, { commonLimit: 4 })
    expect(analysis.pairs).toEqual([])
    // Only each person's own 20 lines are theirs, not the 40 starter lines. A run
    // that crosses from the starter code into their own also counts the line it starts on.
    for (const stats of analysis.repos) {
      expect(stats.own).toBeGreaterThanOrEqual(19)
      expect(stats.own).toBeLessThanOrEqual(22)
    }
    expect(analysis.common.length).toBeGreaterThan(0)
    // With a higher limit the same code counts, and every pair shares it.
    expect(analyseCode(repos, { commonLimit: 5 }).pairs).toHaveLength(10)
  })

  it('weighs a copy against what each side wrote: all of A, a small part of B', () => {
    const shared = program(30, 'shared')
    const pair = pairOf([repo('a', { 'x.js': shared }), repo('b', { 'x.js': shared, 'y.js': program(120, 'more') })], 'a', 'b')
    expect(pair?.aShare).toBe(1)
    expect(pair?.bShare).toBeCloseTo(30 / 150, 1)
    expect(pair?.score).toBe(1)
    expect(pair?.aShared).toBe(pair?.bShared)
  })

  it('counts the same content once, however many folders hold it', () => {
    const shared = program(30, 'shared')
    const own = program(30, 'own')
    const pair = pairOf(
      [repo('a', { 'lab/x.js': shared, 'backup/x.js': shared, 'own.js': own }), repo('b', { 'x.js': shared })],
      'a',
      'b',
    )
    expect(pair?.aShare).toBeCloseTo(0.5, 1)
  })

  it('says "a few lines" for a small match, and leaves out the very smallest', () => {
    const few = program(STRONG_LINES - 5, 'few')
    const thin = pairOf([repo('a', { 'a.js': `${few}\n${program(40, 'alpha')}` }), repo('b', { 'b.js': `${few}\n${program(40, 'beta')}` })], 'a', 'b')
    expect(thin?.tier).toBe('thin')

    const tiny = program(Math.max(1, MIN_LISTED_LINES - 3), 'tiny')
    const none = pairOf([repo('a', { 'a.js': `${tiny}\n${program(40, 'alpha')}` }), repo('b', { 'b.js': `${tiny}\n${program(40, 'beta')}` })], 'a', 'b')
    expect(none).toBeUndefined()
  })

  it('lists the strongest pairs first and keeps the order of the repos within a pair', () => {
    const strong = program(60, 'strong')
    const weak = program(30, 'weak')
    const analysis = analyseCode(
      [
        repo('a', { 'a.js': `${weak}\n${program(90, 'alpha')}` }),
        repo('b', { 'b.js': strong }),
        repo('c', { 'c.js': `${weak}\n${program(90, 'gamma')}` }),
        repo('d', { 'd.js': disguise(strong) }),
      ],
      { commonLimit: 4 },
    )
    expect(analysis.pairs.map((pair) => `${pair.aKey}-${pair.bKey}`)).toEqual(['b-d', 'a-c'])
  })

  it('describes each repo: files read, lines of code and its own lines', () => {
    const analysis = analyseCode([repo('a', { 'a.js': program(30), 'b.js': program(10, 'other') })], { commonLimit: 4 })
    expect(analysis.repos).toEqual([{ repo: 'a', files: 2, lines: 40, own: expect.any(Number) }])
    expect(analysis.repos[0].own).toBeGreaterThan(30)
  })

  it('raises a limit below 2 to 2, so that a pair stays possible', () => {
    expect(analyseCode([], { commonLimit: 0 }).commonLimit).toBe(2)
  })
})

describe('codePairDetail', () => {
  it('names the file in each repo and the lines they share, also under another name', () => {
    const original = program(60)
    const a = repo('a', { 'lab3/index.js': original, 'lab3/notes.js': program(20, 'notes') })
    const b = repo('b', { 'task/main.js': disguise(original), 'other.js': program(20, 'other') })
    const detail = codePairDetail(a, b, new Set(analyseCode([a, b], { commonLimit: 4 }).common))
    expect(detail).toHaveLength(1)
    const [file] = detail
    expect(file.aPath).toBe('lab3/index.js')
    expect(file.bPath).toBe('task/main.js')
    expect(file.aShared).toBeGreaterThan(48)
    expect(file.aShared).toBeLessThanOrEqual(file.aOwn)
    expect(file.bShared).toBeGreaterThan(48)
    expect(file.aRanges[0][0]).toBeLessThanOrEqual(3)
    // The disguised copy starts one line lower: its first line is a comment.
    expect(file.bRanges[0][0]).toBeGreaterThanOrEqual(2)
  })

  it('leaves out code that many repos have', () => {
    const handedOut = program(40, 'starter')
    const a = repo('a', { 'a.js': handedOut })
    const b = repo('b', { 'b.js': handedOut })
    const common = new Set(analyseCode([a, b, repo('c', { 'c.js': handedOut })], { commonLimit: 2 }).common)
    expect(codePairDetail(a, b, common)).toEqual([])
  })

  it('lists the files that share the most lines first', () => {
    const big = program(50, 'big')
    const small = program(20, 'small')
    const a = repo('a', { 'a/small.js': small, 'a/big.js': big })
    const b = repo('b', { 'b/small.js': small, 'b/big.js': big })
    expect(codePairDetail(a, b, new Set()).map((file) => file.aPath)).toEqual(['a/big.js', 'a/small.js'])
  })
})
