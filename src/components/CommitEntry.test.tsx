// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommitInfo } from '../../shared/api.ts'
import type { CommitCheck } from '../logic/padding.ts'
import type { PushInfo } from '../logic/pushAttribution.ts'
import { formatDateTime, parseDeadlineInput } from '../logic/time.ts'
import { failure, oid, stubApi, stubIntersectionObserver } from '../test/fakeApi.ts'

const REPO = 'octocat/hello-world'
const DEADLINE = (parseDeadlineInput('2026-10-05T23:59') as { ms: number }).ms
/** A local wall-clock time in October 2026, as an ISO instant. */
const oct = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute).toISOString()

const SHA = oid('add login')
const COMMIT: CommitInfo = {
  oid: SHA,
  committedAt: oct(5, 22, 10),
  authoredAt: oct(5, 22, 10),
  headline: 'Add the login form',
  parents: [oid('parent')],
  authorName: 'Rahim Uddin',
  authorLogin: 'rahim',
}
const COMMIT_URL = `https://github.com/${REPO}/commit/${SHA}`
const pushedAt = (iso: string): PushInfo => ({ pushedAt: iso, knownBefore: null })

let fake: ReturnType<typeof stubApi>
let viewport: ReturnType<typeof stubIntersectionObserver>

async function show(
  props: { commit?: CommitInfo; push?: PushInfo; deadline?: number | null; autoFiles?: boolean; check?: CommitCheck } = {},
) {
  vi.resetModules()
  const { CommitEntry } = await import('./CommitEntry.tsx')
  render(
    <ol>
      <CommitEntry
        repo={REPO}
        commit={props.commit ?? COMMIT}
        push={props.push}
        deadline={props.deadline === undefined ? DEADLINE : props.deadline}
        autoFiles={props.autoFiles ?? false}
        check={props.check}
      />
    </ol>,
  )
}

const files = () => screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.includes('#diff-'))

beforeEach(() => {
  fake = stubApi({
    files: {
      [SHA]: {
        sha: SHA,
        stats: { additions: 52, deletions: 3 },
        files: [
          { path: 'src/login.js', status: 'added', additions: 40, deletions: 0 },
          { path: 'src/form.js', status: 'renamed', additions: 12, deletions: 3, previousPath: 'src/old-form.js' },
        ],
        more: false,
        tooLarge: false,
      },
    },
  })
  viewport = stubIntersectionObserver()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CommitEntry', () => {
  it('shows the time, message, author and short id, linked to the commit on GitHub', async () => {
    await show()
    const time = screen.getByText('22:10')
    expect(time.getAttribute('datetime')).toBe(COMMIT.committedAt)
    const title = screen.getByRole('link', { name: 'Add the login form' })
    expect(title.getAttribute('href')).toBe(COMMIT_URL)
    expect(title.getAttribute('target')).toBe('_blank')
    expect(screen.getByText(/^rahim/).textContent).toBe(`rahim · ${SHA.slice(0, 7)}`)
    expect(screen.queryByText('Merge')).toBeNull()
  })

  it('falls back to the author name, "Unknown author" and "(no message)"', async () => {
    await show({ commit: { ...COMMIT, headline: '', authorLogin: null } })
    expect(screen.getByRole('link', { name: '(no message)' })).toBeTruthy()
    expect(screen.getByText(/^Rahim Uddin/)).toBeTruthy()
    cleanup()
    await show({ commit: { ...COMMIT, authorLogin: null, authorName: null } })
    expect(screen.getByText(/^Unknown author/)).toBeTruthy()
  })

  it('marks a merge commit', async () => {
    await show({ commit: { ...COMMIT, parents: [oid('one'), oid('two')] } })
    expect(screen.getByText('Merge')).toBeTruthy()
  })

  it('warns when a commit dated before the deadline reached GitHub after it', async () => {
    const late = oct(6, 1, 30)
    await show({ push: pushedAt(late) })
    expect(screen.getByText('After deadline')).toBeTruthy()
    expect(
      screen.getByText(
        `The commit is dated before the deadline, but GitHub received it on ${formatDateTime(late)}.`,
      ),
    ).toBeTruthy()
  })

  it('says when a commit dated after the deadline arrived', async () => {
    const commit = { ...COMMIT, committedAt: oct(6, 9, 0) }
    await show({ commit, push: pushedAt(oct(6, 9, 2)) })
    expect(screen.getByText('After deadline')).toBeTruthy()
    expect(screen.getByText(`Reached GitHub on ${formatDateTime(oct(6, 9, 2))}.`)).toBeTruthy()
  })

  it('points out a commit pushed long after it was made, even in time', async () => {
    await show({ push: pushedAt(oct(5, 23, 0)) })
    expect(screen.queryByText('After deadline')).toBeNull()
    expect(screen.getByText(`Reached GitHub on ${formatDateTime(oct(5, 23, 0))}.`)).toBeTruthy()
  })

  it('says nothing about the push when it came right after the commit', async () => {
    await show({ push: pushedAt(oct(5, 22, 15)) })
    expect(screen.queryByText(/Reached GitHub/)).toBeNull()
    expect(screen.queryByText('After deadline')).toBeNull()
  })

  describe('the files of the commit', () => {
    it('loads them on "Show files", each linked to its place in the commit', async () => {
      await show()
      fireEvent.click(screen.getByRole('button', { name: 'Show files' }))
      expect(screen.getByText('Loading files')).toBeTruthy()

      await screen.findByRole('link', { name: 'src/login.js' })
      expect(screen.queryByRole('button', { name: 'Show files' })).toBeNull()
      // The padding check reads the same answer: still one request.
      expect(fake.paths().filter((path) => path === '/api/v1/commit')).toHaveLength(1)
      expect(files().map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
        ['src/login.js', `${COMMIT_URL}#diff-5b5681921145431b544230214222dda2e5bd119716165db1be296777f8b13ed6`],
        ['src/old-form.js → src/form.js', `${COMMIT_URL}#diff-915097a02e35fa2bada093b9f0ee054f72fb0476d1a591ccf2eb216239251c9a`],
      ])
      const [added, renamed] = files().map((link) => link.closest('li') as HTMLElement)
      expect(within(added).getByText('Added')).toBeTruthy()
      expect(within(added).getByText('+40')).toBeTruthy()
      expect(within(renamed).getByText('Renamed')).toBeTruthy()
      // The commit's own totals join the author line.
      expect(screen.getByText(/^rahim/).textContent).toBe(`rahim · ${SHA.slice(0, 7)} · +52 −3`)
    })

    it('loads further pages on "Show more files"', async () => {
      const first = fake.api.files[SHA]
      if ('failure' in first) throw new Error('unexpected')
      fake.api.files[SHA] = { ...first, more: true }
      fake.api.files[`${SHA}#2`] = {
        ...first,
        files: [{ path: 'src/page-two.js', status: 'modified', additions: 1, deletions: 1 }],
        more: false,
      }
      await show()
      fireEvent.click(screen.getByRole('button', { name: 'Show files' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Show more files' }))
      await screen.findByRole('link', { name: 'src/page-two.js' })
      expect(files()).toHaveLength(3)
      expect(screen.queryByRole('button', { name: 'Show more files' })).toBeNull()
    })

    it('sends a commit too large to list to GitHub instead', async () => {
      fake.api.files[SHA] = { sha: SHA, stats: null, files: [], more: false, tooLarge: true }
      await show()
      fireEvent.click(screen.getByRole('button', { name: 'Show files' }))
      expect(await screen.findByText(/This commit is too large to list here/)).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Open it on GitHub ↗' }).getAttribute('href')).toBe(COMMIT_URL)
    })

    it('says when a commit changed no files', async () => {
      fake.api.files[SHA] = { sha: SHA, stats: { additions: 0, deletions: 0 }, files: [], more: false, tooLarge: false }
      await show()
      fireEvent.click(screen.getByRole('button', { name: 'Show files' }))
      expect(await screen.findByText('No file changes in this commit.')).toBeTruthy()
    })

    it('shows why the files could not be loaded, and tries again on request', async () => {
      const files = fake.api.files[SHA]
      fake.api.files[SHA] = failure(404, 'not_found', 'GitHub has no such commit.')
      await show()
      fireEvent.click(screen.getByRole('button', { name: 'Show files' }))
      expect(await screen.findByText(/GitHub has no such commit\./)).toBeTruthy()

      fake.api.files[SHA] = files
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('link', { name: 'src/login.js' })).toBeTruthy()
    })

    it('is tagged with what the padding check found', async () => {
      await show({ check: { kind: 'whitespace', tiny: false } })
      expect(screen.getByText('Only whitespace')).toBeTruthy()
      cleanup()
      await show({ check: { kind: 'empty', tiny: false } })
      expect(screen.getByText('No changes')).toBeTruthy()
      cleanup()
      await show({ check: { kind: 'real', tiny: true } })
      expect(screen.getByText('Tiny')).toBeTruthy()
      expect(screen.queryByText('Only whitespace')).toBeNull()
      cleanup()
      await show({ check: { kind: 'real', tiny: false } })
      expect(screen.queryByText('Tiny')).toBeNull()
      expect(screen.queryByText('No changes')).toBeNull()
    })

    it('loads them by itself once the commit has stayed on screen for a moment', async () => {
      await show({ autoFiles: true })
      expect(screen.queryByRole('button', { name: 'Show files' })).toBeNull()
      expect(fake.paths()).not.toContain('/api/v1/commit')

      viewport.showAll()
      expect(await screen.findByRole('link', { name: 'src/login.js' })).toBeTruthy()
      expect(fake.paths().filter((path) => path === '/api/v1/commit')).toHaveLength(1)
    })
  })
})
