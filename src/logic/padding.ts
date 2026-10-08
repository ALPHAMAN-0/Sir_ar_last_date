// Which commits are padding: judged from what each commit changed, as the
// Worker reports it, never from the commit message. A file whose text changed
// beyond whitespace is a real change; a commit with none is padding. Pure
// functions, no browser APIs.

import type { CommitFilesResponse } from '../../shared/api.ts'

export type CommitKind =
  /** At least one file's text changed beyond whitespace. */
  | 'real'
  /** Files changed, but only whitespace in every one of them (a pure rename included). */
  | 'whitespace'
  /** No file changed. */
  | 'empty'
  /** Cannot tell: too large, not read to the end, or a file GitHub sent no diff for. */
  | 'unknown'

/** What a check found: the kind, and whether a real change was tiny. */
export type CommitCheck = { kind: CommitKind; tiny: boolean }

/** A real change of this many lines or fewer, added and deleted together, is tiny. */
export const TINY_LINES = 2

/** The kind of a commit from the pages of its files read so far, first page first. */
export function commitKind(pages: readonly CommitFilesResponse[]): CommitKind {
  const last = pages.at(-1)
  if (!last || pages.some((page) => page.tooLarge)) return 'unknown'
  const files = pages.flatMap((page) => page.files)
  if (files.length === 0 && !last.more) return 'empty'
  if (files.some((file) => file.realChange === true)) return 'real'
  if (last.more) return 'unknown'
  if (files.some((file) => file.realChange === undefined)) return 'unknown'
  return 'whitespace'
}

/** Whether the next page of files could still settle the kind: everything so far was whitespace only. */
export function moreMayTell(pages: readonly CommitFilesResponse[]): boolean {
  const last = pages.at(-1)
  if (!last || !last.more || pages.some((page) => page.tooLarge)) return false
  return pages.flatMap((page) => page.files).every((file) => file.realChange === false)
}

/** Two lines or fewer, added and deleted together, as GitHub counts them for the whole commit. */
export function isTiny(first: CommitFilesResponse): boolean {
  return first.stats !== null && first.stats.additions + first.stats.deletions <= TINY_LINES
}

export function checkOf(pages: readonly CommitFilesResponse[]): CommitCheck {
  const kind = commitKind(pages)
  return { kind, tiny: kind === 'real' && pages.length > 0 && isTiny(pages[0]) }
}
