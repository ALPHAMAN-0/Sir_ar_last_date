import { describe, expect, it } from 'vitest'
import type { CommitInfo } from '../../shared/api.ts'
import type { CommitList } from '../state/person.ts'
import { commitSharesText, countCommitShares, MAX_LISTED_AUTHORS, paddingCommits } from './commitShares.ts'
import { firstPushText } from './firstPush.ts'
import type { CommitCheck } from './padding.ts'

type By = { login?: string | null; name?: string | null; merge?: boolean }

let serial = 0
/** One commit, by a GitHub account unless `login` is null: then GitHub cannot say whose it is. */
const commit = ({ login = 'student', name = null, merge = false }: By = {}): CommitInfo => ({
  oid: String(++serial).padStart(40, '0'),
  committedAt: '2026-10-01T10:00:00Z',
  authoredAt: '2026-10-01T10:00:00Z',
  headline: 'work',
  parents: merge ? ['a'.repeat(40), 'b'.repeat(40)] : ['a'.repeat(40)],
  authorName: name,
  authorLogin: login,
})
const list = (commits: CommitInfo[], truncated = false): CommitList => ({ commits, truncated })
const times = (n: number, by: By) => Array.from({ length: n }, () => commit(by))
const textOf = (commits: CommitInfo[], truncated = false) =>
  commitSharesText(countCommitShares(list(commits, truncated)))

describe('who committed', () => {
  it('names each person with their commits and share, the largest share first, merges shown', () => {
    const shares = countCommitShares(
      list([...times(6, { login: 'rahim' }), ...times(2, { login: 'rahim', merge: true }), ...times(4, { login: 'nusrat' })]),
    )
    expect(shares).toEqual({
      kind: 'counted',
      total: 12,
      truncated: false,
      authors: [
        { who: 'rahim', login: 'rahim', commits: 8, merges: 2 },
        { who: 'nusrat', login: 'nusrat', commits: 4, merges: 0 },
      ],
    })
    expect(commitSharesText(shares)).toBe('rahim 8 (67%, 2 merges); nusrat 4 (33%)')
  })

  it('takes a login in any case as one account, spelled as first seen', () => {
    const shares = countCommitShares(list([commit({ login: 'Rahim' }), commit({ login: 'rahim' }), commit({ login: 'RAHIM' })]))
    expect(shares).toMatchObject({ authors: [{ who: 'Rahim', login: 'rahim', commits: 3 }] })
    expect(commitSharesText(shares)).toBe('Rahim 3 (100%)')
  })

  it('falls back on the name written in the commit, then on "Unknown author"', () => {
    expect(
      textOf([
        commit({ login: null, name: 'Nusrat Jahan' }),
        commit({ login: null, name: ' Nusrat Jahan ' }),
        commit({ login: null, name: '' }),
      ]),
    ).toBe('Nusrat Jahan 2 (67%); Unknown author 1 (33%)')
  })

  it("counts a commit signed with the name of a login as that person's", () => {
    const shares = countCommitShares(list([commit({ login: null, name: 'Rahim' }), commit({ login: 'rahim' })]))
    expect(shares).toMatchObject({ authors: [{ who: 'Rahim', login: 'rahim', commits: 2, merges: 0 }] })
  })

  it('says "1 merge" for one, and nothing for none', () => {
    expect(textOf([commit({ merge: true })])).toBe('student 1 (100%, 1 merge)')
    expect(textOf([commit()])).toBe('student 1 (100%)')
  })

  it('breaks a tie by name, A to Z whatever the case', () => {
    expect(textOf([commit({ login: 'tanvir' }), commit({ login: 'Nusrat' }), commit({ login: 'rahim' })])).toBe(
      'Nusrat 1 (33%); rahim 1 (33%); tanvir 1 (33%)',
    )
  })

  it('writes a share too small for a whole percent as "<1%"', () => {
    expect(textOf([...times(200, { login: 'a' }), commit({ login: 'b' })])).toBe('a 200 (100%); b 1 (<1%)')
  })

  it('says when only the newest commits of a long history were counted', () => {
    const shares = countCommitShares(list(times(1000, { login: 'a' }), true))
    expect(shares).toMatchObject({ total: 1000, truncated: true })
    expect(commitSharesText(shares)).toBe('a 1,000 (100%) (of the newest 1,000 commits)')
  })

  it('names at most 50 people and counts the rest', () => {
    const commits = Array.from({ length: MAX_LISTED_AUTHORS + 3 }, (_, i) =>
      commit({ login: `person-${String(i).padStart(2, '0')}` }),
    )
    const parts = textOf(commits).split('; ')
    expect(parts).toHaveLength(MAX_LISTED_AUTHORS + 1)
    expect(parts[0]).toBe('person-00 1 (2%)')
    expect(parts.at(-1)).toBe('and 3 more')
  })

  it('explains a list that is missing in the same words as the first push', () => {
    expect(commitSharesText({ kind: 'failed' })).toBe(firstPushText({ kind: 'failed' }))
    expect(commitSharesText({ kind: 'none' })).toBe('')
    expect(commitSharesText(countCommitShares(list([])))).toBe('')
  })
})

describe('after a padding check', () => {
  const check = (kind: CommitCheck['kind'], tiny = false): CommitCheck => ({ kind, tiny })

  it("sorts each person's commits into real, tiny, only whitespace, empty and not checked", () => {
    const [real, small, blank, nothing, unread, unread2] = times(6, { login: 'rahim' })
    const other = commit({ login: 'nusrat' })
    const checks = new Map([
      [real.oid, check('real')],
      [small.oid, check('real', true)],
      [blank.oid, check('whitespace')],
      [nothing.oid, check('empty')],
      [unread.oid, check('unknown')],
      [other.oid, check('real')],
    ])
    const shares = countCommitShares(list([real, small, blank, nothing, unread, unread2, other]), checks)
    expect(shares).toMatchObject({
      authors: [
        { who: 'rahim', commits: 6, checked: { real: 2, tiny: 1, whitespace: 1, empty: 1, unknown: 2 } },
        { who: 'nusrat', commits: 1, checked: { real: 1, tiny: 0, whitespace: 0, empty: 0, unknown: 0 } },
      ],
    })
    expect(commitSharesText(shares)).toBe(
      'rahim 6 (86%): 2 real (1 tiny), 1 only whitespace, 1 empty, 2 not checked; nusrat 1 (14%): 1 real',
    )
    expect(paddingCommits(shares)).toBe(2)
  })

  it('leaves out what was not found, but always says how many were real', () => {
    const commits = times(3, { login: 'rahim' })
    const checks = new Map(commits.map((item) => [item.oid, check('real')]))
    expect(commitSharesText(countCommitShares(list(commits), checks))).toBe('rahim 3 (100%): 3 real')
    expect(commitSharesText(countCommitShares(list(commits), new Map()))).toBe('rahim 3 (100%): 0 real, 3 not checked')
  })

  it('counts nothing, and has no padding number, without a check', () => {
    const shares = countCommitShares(list(times(2, { login: 'rahim' })))
    expect(shares.kind === 'counted' && shares.authors[0]).not.toHaveProperty('checked')
    expect(paddingCommits(shares)).toBeNull()
    expect(paddingCommits({ kind: 'failed' })).toBeNull()
    expect(paddingCommits({ kind: 'none' })).toBeNull()
    expect(paddingCommits(countCommitShares(list(times(2, { login: 'rahim' })), new Map()))).toBe(0)
  })
})
