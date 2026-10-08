import { describe, expect, it } from 'vitest'
import type { CommitFilesResponse, FileChange } from '../../shared/api.ts'
import { checkOf, commitKind, isTiny, moreMayTell } from './padding.ts'

const SHA = 'a'.repeat(40)

const file = (realChange: boolean | undefined, over: Partial<FileChange> = {}): FileChange => ({
  path: 'src/app.js',
  status: 'modified',
  additions: 1,
  deletions: 1,
  ...(realChange === undefined ? {} : { realChange }),
  ...over,
})

const page = (files: FileChange[], over: Partial<CommitFilesResponse> = {}): CommitFilesResponse => ({
  sha: SHA,
  stats: {
    additions: files.reduce((sum, item) => sum + item.additions, 0),
    deletions: files.reduce((sum, item) => sum + item.deletions, 0),
  },
  files,
  more: false,
  tooLarge: false,
  ...over,
})

describe('the kind of a commit', () => {
  it('is real as soon as one file changed beyond whitespace, even with pages still to read', () => {
    expect(commitKind([page([file(false), file(true)])])).toBe('real')
    expect(commitKind([page([file(true)], { more: true })])).toBe('real')
    expect(commitKind([page([file(undefined), file(true)])])).toBe('real')
  })

  it('is whitespace when every file changed only in whitespace, a pure rename included', () => {
    expect(commitKind([page([file(false)])])).toBe('whitespace')
    expect(commitKind([page([file(false, { status: 'renamed', additions: 0, deletions: 0, previousPath: 'old.js' })])])).toBe(
      'whitespace',
    )
    expect(commitKind([page([file(false)], { more: true }), page([file(false)])])).toBe('whitespace')
  })

  it('is empty when no file changed at all', () => {
    expect(commitKind([page([])])).toBe('empty')
  })

  it('cannot tell without pages, past the size limit, before the last page, or without a diff', () => {
    expect(commitKind([])).toBe('unknown')
    expect(commitKind([page([], { tooLarge: true, stats: null })])).toBe('unknown')
    expect(commitKind([page([file(false)], { more: true })])).toBe('unknown')
    expect(commitKind([page([], { more: true })])).toBe('unknown')
    expect(commitKind([page([file(false), file(undefined)])])).toBe('unknown')
  })
})

describe('reading on', () => {
  it('may still tell only while everything so far was whitespace and more files wait', () => {
    expect(moreMayTell([page([file(false)], { more: true })])).toBe(true)
    expect(moreMayTell([page([], { more: true })])).toBe(true)
    expect(moreMayTell([page([file(false)])])).toBe(false)
    expect(moreMayTell([page([file(true)], { more: true })])).toBe(false)
    expect(moreMayTell([page([file(undefined)], { more: true })])).toBe(false)
    expect(moreMayTell([page([], { more: true, tooLarge: true, stats: null })])).toBe(false)
    expect(moreMayTell([])).toBe(false)
  })
})

describe('tiny', () => {
  it('is two lines or fewer, added and deleted together', () => {
    expect(isTiny(page([file(true)]))).toBe(true)
    expect(isTiny(page([file(true, { additions: 2, deletions: 0 })]))).toBe(true)
    expect(isTiny(page([file(true, { additions: 2, deletions: 1 })]))).toBe(false)
    expect(isTiny(page([], { stats: null }))).toBe(false)
  })

  it('is only said of a real change', () => {
    expect(checkOf([page([file(true)])])).toEqual({ kind: 'real', tiny: true })
    expect(checkOf([page([file(true, { additions: 40, deletions: 3 })])])).toEqual({ kind: 'real', tiny: false })
    expect(checkOf([page([file(false)])])).toEqual({ kind: 'whitespace', tiny: false })
    expect(checkOf([page([])])).toEqual({ kind: 'empty', tiny: false })
    expect(checkOf([])).toEqual({ kind: 'unknown', tiny: false })
  })
})
