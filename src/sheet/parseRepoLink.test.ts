import { describe, expect, it } from 'vitest'
import { parseRepoLink } from './parseRepoLink.ts'

const key = (input: string) => {
  const result = parseRepoLink(input)
  return result.ok ? result.key : `!${result.reason}`
}

describe('parseRepoLink', () => {
  it('reads every common way of writing a repo link', () => {
    const expected = 'alphaman-0/aboutme'
    for (const input of [
      'https://github.com/ALPHAMAN-0/AboutMe',
      'http://github.com/ALPHAMAN-0/AboutMe',
      'github.com/ALPHAMAN-0/AboutMe',
      'www.github.com/ALPHAMAN-0/AboutMe',
      'https://www.github.com/ALPHAMAN-0/AboutMe/',
      'https://github.com/ALPHAMAN-0/AboutMe.git',
      'https://github.com/ALPHAMAN-0/AboutMe/tree/main/src',
      'https://github.com/ALPHAMAN-0/AboutMe/blob/main/README.md',
      'https://github.com/ALPHAMAN-0/AboutMe?tab=readme-ov-file#top',
      'HTTPS://GITHUB.COM/alphaman-0/aboutme',
      'git@github.com:ALPHAMAN-0/AboutMe.git',
      'ssh://git@github.com/ALPHAMAN-0/AboutMe.git',
      'ALPHAMAN-0/AboutMe',
      '  https://github.com/ALPHAMAN-0/AboutMe  ',
      '<https://github.com/ALPHAMAN-0/AboutMe>',
      '"https://github.com/ALPHAMAN-0/AboutMe"',
    ]) {
      expect(key(input), input).toBe(expected)
    }
  })

  it('keeps dots, dashes and underscores in repo names', () => {
    expect(key('https://github.com/a/my.repo-name_2')).toBe('a/my.repo-name_2')
    expect(key('https://github.com/a/b.github.io')).toBe('a/b.github.io')
  })

  it('explains why a cell is not a repo link', () => {
    expect(key('')).toBe('!empty')
    expect(key('   ')).toBe('!empty')
    expect(key('N/A')).toBe('!empty')
    expect(key('-')).toBe('!empty')
    expect(key(undefined as unknown as string)).toBe('!empty')
    expect(key('https://github.com/ALPHAMAN-0')).toBe('!not_a_repo')
    expect(key('https://github.com/')).toBe('!not_a_repo')
    expect(key('https://github.com/orgs/acme/repositories')).toBe('!not_a_repo')
    expect(key('https://github.com/settings/tokens')).toBe('!not_a_repo')
    expect(key('https://gist.github.com/user/abc123')).toBe('!gist')
    expect(key('https://user.github.io/project')).toBe('!pages')
    expect(key('https://gitlab.com/a/b')).toBe('!not_github')
    expect(key('https://drive.google.com/file/d/1')).toBe('!not_github')
    expect(key('will submit tomorrow')).toBe('!malformed')
    expect(key('ftp://github.com/a/b')).toBe('!not_github')
  })

  it('is not fooled by look-alike hosts or embedded credentials', () => {
    expect(key('https://github.com.evil.example/a/b')).toBe('!not_github')
    expect(key('https://github.com@evil.example/a/b')).toBe('!not_github')
    expect(key('https://evil.example/github.com/a/b')).toBe('!not_github')
    expect(key('https://user:pass@github.com/a/b')).toBe('!malformed')
    expect(key('javascript:alert(1)')).toBe('!malformed')
  })

  it('rejects names GitHub would never accept', () => {
    // The URL parser resolves "/a/.." to "/", which is no longer a repo path.
    expect(key('https://github.com/a/..')).toBe('!not_a_repo')
    expect(key('a/..')).toBe('!malformed')
    expect(key('https://github.com/-bad/repo')).toBe('!malformed')
    expect(key('https://github.com/a/b%2Fc')).toBe('!malformed')
    expect(key('https://github.com/a/%E0%A4%A')).toBe('!malformed')
  })
})
