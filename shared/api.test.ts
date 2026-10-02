import { describe, expect, it } from 'vitest'
import {
  activityUrl,
  commitsUrl,
  commitUrl,
  parseActivityQuery,
  parseCommitQuery,
  parseCommitsQuery,
  parseReposQuery,
  reposUrl,
} from './api.ts'
import {
  isBranchName,
  isCommitCursor,
  isIsoTime,
  isRepoKey,
  isSha,
} from './validate.ts'

const SHA = 'a32ee2ab21ea1bf5434108126a9a6adc35121ffe'
const search = (url: string) => url.slice(url.indexOf('?'))

describe('validators', () => {
  it('accepts canonical repo keys only', () => {
    expect(isRepoKey('octocat/hello-world')).toBe(true)
    expect(isRepoKey('alphaman-0/sir_ar_last_date')).toBe(true)
    expect(isRepoKey('a/b.c')).toBe(true)
    for (const bad of [
      'Octocat/Hello-World', // not lowercase
      'octocat',
      'octocat/',
      '/repo',
      'a/b/c',
      'a/..',
      'a/.',
      'a/repo.git',
      '-a/b',
      'a b/c',
      'a/b?x=1',
      'a/b#c',
      '../etc/passwd',
      `${'a'.repeat(40)}/b`,
    ]) {
      expect(isRepoKey(bad), bad).toBe(false)
    }
  })

  it('checks shas, times, branches and cursors', () => {
    expect(isSha(SHA)).toBe(true)
    expect(isSha(SHA.toUpperCase())).toBe(false)
    expect(isSha(SHA.slice(1))).toBe(false)
    expect(isIsoTime('2026-09-25T09:05:11Z')).toBe(true)
    expect(isIsoTime('2026-09-25 09:05')).toBe(false)
    expect(isIsoTime('2026-13-45T99:99:99Z')).toBe(false)
    expect(isBranchName('main')).toBe(true)
    expect(isBranchName('feature/login-2')).toBe(true)
    expect(isBranchName('a..b')).toBe(false)
    expect(isBranchName('has space')).toBe(false)
    expect(isBranchName('-x')).toBe(false)
    expect(isBranchName('a:b')).toBe(false)
    expect(isCommitCursor(`${SHA} 99`, SHA)).toBe(true)
    expect(isCommitCursor(`${'b'.repeat(40)} 99`, SHA)).toBe(false)
    expect(isCommitCursor(`${SHA} x`, SHA)).toBe(false)
  })
})

describe('repos query', () => {
  it('builds one canonical spelling: unique and sorted', () => {
    expect(reposUrl(['b/y', 'a/x', 'b/y'])).toBe('/api/v1/repos?r=a%2Fx&r=b%2Fy')
  })

  it('round-trips a canonical query', () => {
    expect(parseReposQuery(search(reposUrl(['b/y', 'a/x'])))).toEqual(['a/x', 'b/y'])
  })

  it('rejects every non-canonical spelling', () => {
    for (const bad of [
      '',
      '?',
      '?r=b%2Fy&r=a%2Fx', // unsorted
      '?r=a%2Fx&r=a%2Fx', // duplicate
      '?r=a/x', // not encoded
      '?r=A%2Fx', // uppercase
      '?r=a%2Fx&x=1', // extra parameter
      '?r=a%2Fx&', // trailing separator
      '?r=a',
    ]) {
      expect(parseReposQuery(bad), bad).toBeNull()
    }
  })

  it('rejects more than 20 repos', () => {
    const keys = Array.from({ length: 21 }, (_, i) => `a/r${String(i).padStart(2, '0')}`)
    expect(parseReposQuery(search(reposUrl(keys)))).toBeNull()
    expect(parseReposQuery(search(reposUrl(keys.slice(0, 20))))).toHaveLength(20)
  })
})

describe('activity query', () => {
  const base = { repo: 'a/x', v: '2026-09-25T09:05:11Z' }

  it('round-trips with and without optional parts', () => {
    expect(parseActivityQuery(search(activityUrl(base)))).toEqual(base)
    const full = { ...base, ref: 'feature/x', asc: true, after: 'Y3Vyc29yOnYy+/=' }
    expect(parseActivityQuery(search(activityUrl(full)))).toEqual(full)
  })

  it('rejects wrong order, bad values and URLs used as cursors', () => {
    for (const bad of [
      '?v=2026-09-25T09%3A05%3A11Z&repo=a%2Fx',
      '?repo=a%2Fx',
      '?repo=a%2Fx&v=yesterday',
      '?repo=a%2Fx&v=2026-09-25T09%3A05%3A11Z&dir=desc',
      '?repo=a%2Fx&v=2026-09-25T09%3A05%3A11Z&after=https%3A%2F%2Fevil.example%2F',
      '?repo=a%2Fx&v=2026-09-25T09%3A05%3A11Z&ref=a..b',
    ]) {
      expect(parseActivityQuery(bad), bad).toBeNull()
    }
  })
})

describe('commits and commit queries', () => {
  it('round-trips', () => {
    const commits = { repo: 'a/x', ref: SHA, after: `${SHA} 99` }
    expect(parseCommitsQuery(search(commitsUrl(commits)))).toEqual(commits)
    expect(parseCommitQuery(search(commitUrl({ repo: 'a/x', sha: SHA })))).toEqual({
      repo: 'a/x',
      sha: SHA,
    })
    expect(parseCommitQuery(search(commitUrl({ repo: 'a/x', sha: SHA, page: 3 })))).toEqual({
      repo: 'a/x',
      sha: SHA,
      page: 3,
    })
  })

  it('rejects a cursor from another head, page 1 spelled out, and huge pages', () => {
    expect(parseCommitsQuery(`?repo=a%2Fx&ref=${SHA}&after=${'b'.repeat(40)}%2099`)).toBeNull()
    expect(parseCommitQuery(`?repo=a%2Fx&sha=${SHA}&page=1`)).toBeNull()
    expect(parseCommitQuery(`?repo=a%2Fx&sha=${SHA}&page=31`)).toBeNull()
    expect(parseCommitQuery(`?repo=a%2Fx&sha=main`)).toBeNull()
  })
})
