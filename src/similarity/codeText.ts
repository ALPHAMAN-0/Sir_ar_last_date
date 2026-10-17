// Turns the text of one file into fingerprints, for the shared-code check.
// Pure: no network, no DOM, safe in a Web Worker and in Node for tests.
//
// Two copies of the same code should give the same fingerprints even when
// spaces, line endings, letter case or comments were changed. So comments are
// removed, the rest is cut into words and punctuation (which drops every
// space), and every run of K of those tokens is hashed. Winnowing then keeps
// the smallest hash of every W runs in a row: far fewer numbers, and still
// every shared run of K + W - 1 tokens leaves at least one shared fingerprint.
// This is the method of MOSS (Schleimer, Wilkerson and Aiken, 2003).

import type { TreeFile } from '../../shared/api.ts'

/** Tokens in one hashed run. Long enough that a few common words in a row do not count. */
export const K = 12
/** Runs per window. A shared run of K + W - 1 tokens is always found. */
export const W = 8

/** Larger files are left out: nobody types 150 KB for a lab, and the download would be slow. */
export const MAX_TEXT_BYTES = 150_000
/** A notebook carries its outputs (often pictures), so its file is bigger than its code. GitHub sends at most 512 KB of text. */
export const MAX_NOTEBOOK_BYTES = 500_000

/** Which comments a file can hold. */
export type Lang = 'code' | 'markup' | 'mixed' | 'css' | 'php' | 'hash' | 'sql' | 'notebook'

// Code and markup only. Prose (README.md, .txt), data (.json, .csv) and settings
// (.yml) are left out: they are too often handed out or generated.
const EXTENSIONS: Record<string, Lang> = {
  html: 'markup', htm: 'markup', xhtml: 'markup', ejs: 'markup', hbs: 'markup', handlebars: 'markup',
  jsp: 'markup', asp: 'markup', aspx: 'markup', cshtml: 'markup', razor: 'markup', twig: 'markup', njk: 'markup',
  vue: 'mixed', svelte: 'mixed', astro: 'mixed',
  php: 'php', phtml: 'php',
  css: 'css',
  scss: 'code', sass: 'code', less: 'code',
  js: 'code', jsx: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', mts: 'code', cts: 'code',
  java: 'code', kt: 'code', kts: 'code', scala: 'code', groovy: 'code',
  c: 'code', h: 'code', cpp: 'code', cc: 'code', cxx: 'code', hpp: 'code', hh: 'code', hxx: 'code',
  cs: 'code', go: 'code', rs: 'code', swift: 'code', dart: 'code',
  py: 'hash', pyw: 'hash', r: 'hash', rb: 'hash', sh: 'hash', bash: 'hash', zsh: 'hash', ps1: 'hash', pl: 'hash',
  sql: 'sql', lua: 'sql',
  ipynb: 'notebook',
}

/** The comment rules a file is read with, or null when it is not read. */
export function langOf(path: string): Lang | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return EXTENSIONS[name.slice(dot + 1)] ?? null
}

/** True when the shared-code check reads this file's text. */
export function isReadable(file: Pick<TreeFile, 'path' | 'size'>): boolean {
  const lang = langOf(file.path)
  if (!lang) return false
  return file.size <= (lang === 'notebook' ? MAX_NOTEBOOK_BYTES : MAX_TEXT_BYTES)
}

type Rules = { line: readonly string[]; block: ReadonlyArray<readonly [string, string]>; strings: boolean }

const C_BLOCK = ['/*', '*/'] as const
const HTML_BLOCK = ['<!--', '-->'] as const

// `strings`: a comment sign inside quotes is text. Markup and CSS do not look
// for strings, because an apostrophe in plain text ("don't") would start one.
const RULES: Record<Exclude<Lang, 'notebook'>, Rules> = {
  code: { line: ['//'], block: [C_BLOCK], strings: true },
  markup: { line: [], block: [HTML_BLOCK, C_BLOCK], strings: false },
  mixed: { line: ['//'], block: [HTML_BLOCK, C_BLOCK], strings: true },
  css: { line: [], block: [C_BLOCK], strings: false },
  php: { line: ['//', '#'], block: [HTML_BLOCK, C_BLOCK], strings: true },
  hash: { line: ['#'], block: [], strings: true },
  sql: { line: ['--'], block: [C_BLOCK], strings: true },
}

function lineBreaks(text: string, from: number, to: number): number {
  let count = 0
  for (let at = text.indexOf('\n', from); at !== -1 && at < to; at = text.indexOf('\n', at + 1)) count++
  return count
}

/**
 * The text without its comments. A comment becomes one space (plus the line
 * breaks it held), so the words on either side stay apart and every line keeps
 * its number. A string ends at its line's end at the latest: one stray quote
 * must not swallow the rest of the file.
 */
export function stripComments(text: string, lang: Exclude<Lang, 'notebook'>): string {
  const { line, block, strings } = RULES[lang]
  const out: string[] = []
  let quote: string | null = null
  let start = 0
  let i = 0
  const n = text.length
  outer: while (i < n) {
    const char = text[i]
    if (quote !== null) {
      if (char === '\\') i += 2
      else {
        if (char === quote || char === '\n') quote = null
        i++
      }
      continue
    }
    for (const [open, close] of block) {
      if (text.startsWith(open, i)) {
        const end = text.indexOf(close, i + open.length)
        const stop = end < 0 ? n : end + close.length
        // The comment's line breaks stay, so every line keeps its number.
        out.push(text.slice(start, i), ' ', '\n'.repeat(lineBreaks(text, i, stop)))
        i = stop
        start = i
        continue outer
      }
    }
    for (const sign of line) {
      if (text.startsWith(sign, i)) {
        out.push(text.slice(start, i), ' ')
        const end = text.indexOf('\n', i)
        i = end < 0 ? n : end
        start = i
        continue outer
      }
    }
    if (strings && (char === '"' || char === "'" || char === '`')) quote = char
    i++
  }
  out.push(text.slice(start))
  return out.join('')
}

type Cell = { cell_type?: unknown; source?: unknown }

/** The sources of a notebook's cells. Outputs are left out: they are what the code printed. */
function notebookCode(text: string): string | null {
  let cells: unknown
  try {
    cells = (JSON.parse(text) as { cells?: unknown } | null)?.cells
  } catch {
    return null
  }
  if (!Array.isArray(cells)) return null
  return cells
    .map((cell: Cell) => {
      const source = Array.isArray(cell?.source) ? cell.source.join('') : typeof cell?.source === 'string' ? cell.source : ''
      return cell?.cell_type === 'code' ? stripComments(source, 'hash') : source
    })
    .join('\n')
}

/** The text of a file as it is compared: without comments. Null for a file that is not read. */
export function codeOf(path: string, text: string): string | null {
  const lang = langOf(path)
  if (!lang) return null
  const plain = text.replace(/\r\n?/g, '\n')
  return lang === 'notebook' ? notebookCode(plain) : stripComments(plain, lang)
}

// A word is letters, digits, marks (the vowel signs of Bangla), _ and $. Every
// other character that is not a space is a token of its own.
const TOKEN = /[\p{L}\p{N}\p{M}_$]+|[^\s\p{L}\p{N}\p{M}_$]/gu

/** The tokens of a text in lower case, each with the line it is on (1-based). */
function tokenize(text: string): { list: string[]; line: number[] } {
  const lower = text.toLowerCase()
  const list: string[] = []
  const line: number[] = []
  let current = 1
  let from = 0
  for (const match of lower.matchAll(TOKEN)) {
    current += lineBreaks(lower, from, match.index)
    list.push(match[0])
    line.push(current)
    from = match.index + match[0].length
  }
  return { list, line }
}

/** Words and punctuation in lower case. Spaces and line endings are gone. */
export function tokens(text: string): string[] {
  return tokenize(text).list
}

/** Two unrelated 32-bit hashes of one token, so that a run is told apart by 53 bits. */
function hashTokens(list: readonly string[]): [Uint32Array, Uint32Array] {
  const first = new Uint32Array(list.length)
  const second = new Uint32Array(list.length)
  list.forEach((token, index) => {
    let a = 0x811c9dc5
    let b = 0x9747b28c
    for (let i = 0; i < token.length; i++) {
      const code = token.charCodeAt(i)
      a = Math.imul(a ^ code, 0x01000193)
      b = Math.imul(b ^ code, 0x5bd1e995)
      b ^= b >>> 15
    }
    first[index] = a >>> 0
    second[index] = b >>> 0
  })
  return [first, second]
}

const HIGH = 2 ** 21

/** One number per run of K tokens: 32 bits of one hash and 21 of the other. */
function runHashes(list: readonly string[]): number[] {
  const count = list.length - K + 1
  if (count <= 0) return []
  const [first, second] = hashTokens(list)
  const runs = new Array<number>(count)
  for (let start = 0; start < count; start++) {
    let a = 0
    let b = 0
    for (let j = start; j < start + K; j++) {
      a = (Math.imul(a, 0x01000193) + first[j]) | 0
      b = (Math.imul(b, 0x2f0b3a49) + second[j]) | 0
    }
    runs[start] = (a >>> 0) * HIGH + ((b >>> 0) >>> 11)
  }
  return runs
}

/** Where the runs that winnowing keeps start: the smallest hash of every W in a row (the rightmost of equals). */
function winnow(runs: readonly number[]): number[] {
  if (runs.length === 0) return []
  const kept: number[] = []
  const windows = Math.max(1, runs.length - W + 1)
  const width = Math.min(W, runs.length)
  for (let start = 0; start < windows; start++) {
    let at = start
    for (let i = start + 1; i < start + width; i++) if (runs[i] <= runs[at]) at = i
    if (at !== kept[kept.length - 1]) kept.push(at)
  }
  return kept
}

/** What one file's code is compared by. Plain arrays, so it travels to a Web Worker as it is. */
export type FilePrints = {
  /** Fingerprints in the order they appear. One value can appear more than once. */
  values: number[]
  /** For each fingerprint: the first and the last line (1-based) of the code it stands for. */
  from: number[]
  to: number[]
  /** The lines that hold code once the comments are gone, ascending. */
  lines: number[]
}

/** The fingerprints of a file's code (the text `codeOf` gives), with the lines each one covers. */
export function printText(code: string): FilePrints {
  const { list, line } = tokenize(code)
  const values: number[] = []
  const from: number[] = []
  const to: number[] = []
  const runs = runHashes(list)
  for (const at of winnow(runs)) {
    values.push(runs[at])
    from.push(line[at])
    to.push(line[at + K - 1])
  }
  const lines: number[] = []
  for (const number of line) if (number !== lines[lines.length - 1]) lines.push(number)
  return { values, from, to, lines }
}

/** The fingerprints of a text, each once. */
export function fingerprints(code: string): number[] {
  return [...new Set(printText(code).values)]
}
