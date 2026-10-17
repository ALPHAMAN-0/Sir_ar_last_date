import { describe, expect, it } from 'vitest'
import {
  K,
  MAX_NOTEBOOK_BYTES,
  MAX_TEXT_BYTES,
  W,
  codeOf,
  fingerprints,
  isReadable,
  printText,
  stripComments,
  tokens,
} from './codeText.ts'

const file = (path: string, size = 2000) => ({ path, sha: 'a'.repeat(40), size })

/** Fingerprints of a text read as `path`. */
const prints = (text: string, path = 'a.js') => new Set(fingerprints(codeOf(path, text) ?? ''))

/** How many of `a`'s fingerprints are also in `b`, as a share of `a`'s. */
function shareOf(a: Set<number>, b: Set<number>): number {
  let both = 0
  for (const value of a) if (b.has(value)) both++
  return a.size === 0 ? 0 : both / a.size
}

/** A long piece of made-up code: `count` different statements, one per line. */
const program = (count: number, name = 'total') =>
  Array.from({ length: count }, (_, i) => `let ${name}${i} = compute(${i}, "item ${i}") + offset * ${i + 3};`).join('\n')

describe('isReadable', () => {
  it('reads code and markup, not prose, data or settings', () => {
    for (const path of ['index.html', 'css/style.css', 'src/App.jsx', 'api/login.php', 'main.py', 'Main.java', 'lab.ipynb', 'q.sql']) {
      expect(isReadable(file(path)), path).toBe(true)
    }
    for (const path of ['README.md', 'notes.txt', 'data.json', 'list.csv', 'config.yml', 'report.docx', 'Makefile']) {
      expect(isReadable(file(path)), path).toBe(false)
    }
  })

  it('leaves out files too big to be anyone’s own typing', () => {
    expect(isReadable(file('a.js', MAX_TEXT_BYTES))).toBe(true)
    expect(isReadable(file('a.js', MAX_TEXT_BYTES + 1))).toBe(false)
    // A notebook carries its outputs, so it may be bigger.
    expect(isReadable(file('lab.ipynb', MAX_NOTEBOOK_BYTES))).toBe(true)
    expect(isReadable(file('lab.ipynb', MAX_NOTEBOOK_BYTES + 1))).toBe(false)
  })

  it('ignores the case of the extension', () => {
    expect(isReadable(file('INDEX.HTML'))).toBe(true)
  })
})

describe('stripComments', () => {
  it('removes // and /* */ comments from code, but not inside strings', () => {
    const code = 'const url = "https://example.com" // the site\n/* old:\nfetch(x) */ go(url)'
    const kept = stripComments(code, 'code')
    expect(kept).toContain('"https://example.com"')
    expect(kept).not.toContain('the site')
    expect(kept).not.toContain('fetch(x)')
    expect(kept).toContain('go(url)')
  })

  it('removes <!-- --> and /* */ from markup, and keeps links whole', () => {
    const html = '<!-- my header -->\n<a href="https://x.org/a">Home</a>\n<style>/* red */ p { color: red }</style>'
    const kept = stripComments(html, 'markup')
    expect(kept).not.toContain('my header')
    expect(kept).not.toContain('red */')
    expect(kept).toContain('https://x.org/a')
    expect(kept).toContain('color: red')
  })

  it('keeps # in CSS, where it starts a selector or a colour', () => {
    const kept = stripComments('#main { color: #fff } /* note */', 'css')
    expect(kept).toContain('#main')
    expect(kept).toContain('#fff')
    expect(kept).not.toContain('note')
  })

  it('removes # comments from Python, but not a # inside a string', () => {
    const kept = stripComments('colour = "#ff0000"  # red\nprint(colour)', 'hash')
    expect(kept).toContain('"#ff0000"')
    expect(kept).not.toContain('red')
    expect(kept).toContain('print(colour)')
  })

  it('removes -- comments from SQL', () => {
    const kept = stripComments('SELECT * FROM users -- every user\nWHERE id = 1', 'sql')
    expect(kept).not.toContain('every user')
    expect(kept).toContain('WHERE id = 1')
  })

  it('removes all three kinds from PHP, which mixes markup and code', () => {
    const php = '<!-- page -->\n<?php\n// check\n# also\n/* block */\necho "#1 <b>"; ?>'
    const kept = stripComments(php, 'php')
    for (const gone of ['page', 'check', 'also', 'block']) expect(kept).not.toContain(gone)
    expect(kept).toContain('echo "#1 <b>"')
  })

  it('stops a string at the end of its line, so one stray quote cannot hide the rest of a file', () => {
    const kept = stripComments("let a = 'it's\n// gone\nlet b = 2", 'code')
    expect(kept).not.toContain('gone')
    expect(kept).toContain('let b = 2')
  })

  it('keeps the line breaks of a comment, so every line keeps its number', () => {
    const kept = stripComments('a\n/* one\ntwo\nthree */ b\n<!-- x\ny --> c', 'mixed')
    expect(kept.split('\n').map((line) => line.trim())).toEqual(['a', '', '', 'b', '', 'c'])
  })

  it('handles a comment that is never closed', () => {
    expect(stripComments('a /* open', 'code')).not.toContain('open')
    expect(stripComments('a <!-- open', 'markup')).not.toContain('open')
  })
})

describe('codeOf', () => {
  it('reads only the cell sources of a notebook, not its outputs', () => {
    const notebook = JSON.stringify({
      cells: [
        { cell_type: 'markdown', source: ['# Lab 2\n', 'Load the data'] },
        { cell_type: 'code', source: ['import pandas as pd  # tables\n', 'df = pd.read_csv("a.csv")'], outputs: [{ text: 'SECRET OUTPUT' }] },
      ],
    })
    const code = codeOf('lab.ipynb', notebook) ?? ''
    expect(code).toContain('Load the data')
    expect(code).toContain('pd.read_csv')
    expect(code).not.toContain('tables')
    expect(code).not.toContain('SECRET OUTPUT')
  })

  it('gives nothing for a notebook that is not valid JSON, or a file it does not read', () => {
    expect(codeOf('lab.ipynb', '{ not json')).toBeNull()
    expect(codeOf('README.md', '# hello')).toBeNull()
  })
})

describe('tokens', () => {
  it('ignores spaces, line endings and letter case', () => {
    expect(tokens('Let  X=1;\r\n\tlet y = 2')).toEqual(tokens('let x = 1;\nLET Y=2'))
  })

  it('splits words from punctuation, and keeps letters of any script', () => {
    expect(tokens('<td>Pencil</td>')).toEqual(['<', 'td', '>', 'pencil', '<', '/', 'td', '>'])
    expect(tokens('নাম = "রহিম"')).toEqual(['নাম', '=', '"', 'রহিম', '"'])
  })
})

describe('fingerprints', () => {
  it('gives nothing for a text shorter than one chunk', () => {
    expect(fingerprints('a b c')).toEqual([])
    expect(fingerprints('')).toEqual([])
  })

  it('gives each fingerprint once', () => {
    const list = fingerprints(program(40))
    expect(new Set(list).size).toBe(list.length)
  })

  it('is the same for a copy that only changed spaces, line endings, case and comments', () => {
    const original = program(40)
    const disguised = `// my own work\n${original.toUpperCase().replace(/\n/g, '\r\n\r\n    ').replace(/ = /g, '=')}\n/* end */`
    expect(prints(disguised)).toEqual(prints(original))
  })

  it('still finds most of a copy that changed some lines', () => {
    const lines = program(60).split('\n')
    const edited = lines.map((line, i) => (i % 10 === 0 ? `console.log("changed line ${i}")` : line)).join('\n')
    expect(shareOf(prints(edited), prints(lines.join('\n')))).toBeGreaterThan(0.6)
  })

  it('shares nothing between two programs that were written apart', () => {
    const mine = program(40, 'total')
    const theirs = Array.from({ length: 40 }, (_, i) => `function step${i}(list) { return list.filter((x) => x > ${i * 7}).length }`).join('\n')
    expect(shareOf(prints(mine), prints(theirs))).toBe(0)
  })

  it('always catches a shared run of K + W - 1 tokens, wherever it sits', () => {
    // Winnowing's promise: every window of W chunks keeps one, so a long enough run is never missed.
    const run = K + W - 1
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const word = () => `w${Math.floor(random() * 1e9)}`
    for (let round = 0; round < 200; round++) {
      const shared = Array.from({ length: run }, word)
      const a = [...Array.from({ length: Math.floor(random() * 50) }, word), ...shared, ...Array.from({ length: Math.floor(random() * 50) }, word)]
      const b = [...Array.from({ length: Math.floor(random() * 50) }, word), ...shared, ...Array.from({ length: Math.floor(random() * 50) }, word)]
      const inB = new Set(fingerprints(b.join(' ')))
      expect(fingerprints(a.join(' ')).some((value) => inB.has(value)), `round ${round}`).toBe(true)
    }
  })

  it('keeps fingerprints that fit in a JavaScript number exactly', () => {
    for (const value of fingerprints(program(40))) {
      expect(Number.isSafeInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('printText', () => {
  it('says which lines each fingerprint covers, counted in the original file', () => {
    // Line 1 is code, lines 2-4 a comment, then code again from line 5.
    const text = `${program(1)}\n/* note\nmore\nend */\n${program(30)}`
    const prints = printText(codeOf('a.js', text) ?? '')
    expect(prints.values.length).toBeGreaterThan(0)
    expect(prints.values).toHaveLength(prints.from.length)
    expect(prints.values).toHaveLength(prints.to.length)
    prints.from.forEach((first, i) => {
      expect(first).toBeLessThanOrEqual(prints.to[i])
      expect([2, 3, 4]).not.toContain(first)
    })
    // The code lines skip the comment and run to the last line of the file.
    expect(prints.lines.slice(0, 2)).toEqual([1, 5])
    expect(prints.lines[prints.lines.length - 1]).toBe(34)
  })

  it('counts lines the same with Windows line endings', () => {
    const text = program(30)
    expect(printText(codeOf('a.js', text.replace(/\n/g, '\r\n')) ?? '')).toEqual(printText(codeOf('a.js', text) ?? ''))
  })

  it('gives empty lists for a file without code', () => {
    expect(printText('')).toEqual({ values: [], from: [], to: [], lines: [] })
  })
})
