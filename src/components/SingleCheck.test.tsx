// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityEvent, CommitFilesResponse, CommitInfo, FileChange, RepoOk } from '../../shared/api.ts'
import { okRepo, stubApi } from '../test/fakeApi.ts'

const HEAD = 'bbbbbbbbbbbb0000000000000000000000000000'
const KEY = 'octocat/hello-world'
const REPO: RepoOk = okRepo(KEY, {
  nameWithOwner: 'octocat/Hello-World',
  defaultBranch: 'main',
  headOid: HEAD,
  createdAt: '2026-09-01T08:00:00Z',
  pushedAt: '2026-10-01T08:00:00Z',
})

const ACTIVITY: ActivityEvent[] = [
  { ts: '2026-10-01T08:00:00Z', type: 'PushEvent', ref: 'refs/heads/main', before: '0', after: '1', actor: 'octocat' },
  { ts: '2026-09-15T12:00:00Z', type: 'PushEvent', ref: 'refs/heads/main', before: '0', after: '1', actor: 'octocat' },
  { ts: '2026-09-01T08:00:00Z', type: 'PushEvent', ref: 'refs/heads/main', before: '0', after: '1', actor: 'octocat' },
]

const FILES: FileChange[] = [
  { path: 'src/app.js', status: 'modified', additions: 12, deletions: 4 },
  { path: 'README.md', status: 'modified', additions: 1, deletions: 1 },
]
const FILES_RESPONSE: CommitFilesResponse = {
  sha: HEAD,
  stats: { additions: 13, deletions: 5 },
  files: FILES,
  more: false,
  tooLarge: false,
}

const COMMITS: CommitInfo[] = [
  {
    oid: '1'.repeat(40),
    committedAt: '2026-10-01T10:00:00Z',
    authoredAt: '2026-10-01T10:00:00Z',
    headline: 'add login',
    parents: ['0'.repeat(40)],
    authorName: null,
    authorLogin: 'rahim',
  },
  {
    oid: '2'.repeat(40),
    committedAt: '2026-09-15T10:00:00Z',
    authoredAt: '2026-09-15T10:00:00Z',
    headline: 'merge',
    parents: ['0'.repeat(40), '3'.repeat(40)],
    authorName: null,
    authorLogin: 'rahim',
  },
  {
    oid: '3'.repeat(40),
    committedAt: '2026-09-01T10:00:00Z',
    authoredAt: '2026-09-01T10:00:00Z',
    headline: 'first commit',
    parents: ['0'.repeat(40)],
    authorName: null,
    authorLogin: 'nusrat',
  },
]

async function renderSingleCheck() {
  vi.resetModules()
  const { SingleCheck } = await import('./SingleCheck.tsx')
  render(<SingleCheck />)
  return { SingleCheck }
}

const inputLink = () =>
  screen.getByPlaceholderText(/github\.com/) as HTMLInputElement
const submit = () => {
  const form = screen.getByRole('button', { name: /^check$/i }).closest('form')
  if (!form) throw new Error('expected a form around the Check button')
  fireEvent.submit(form)
}

beforeEach(() => {
  stubApi({
    repos: { [KEY]: REPO },
    activity: { [KEY]: ACTIVITY },
    files: { [HEAD]: FILES_RESPONSE },
    commits: { [`${KEY}@main`]: COMMITS },
  })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('SingleCheck', () => {
  it('renders an input, a Check button and an empty state', async () => {
    await renderSingleCheck()
    expect(inputLink()).toBeTruthy()
    expect(screen.getByRole('button', { name: /^check$/i })).toBeTruthy()
    expect(screen.queryByRole('definition')).toBeNull()
  })

  it('shows the eight facts of the repo after a successful check', async () => {
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()

    await waitFor(() => {
      // Wait on the Branches label, which only appears in the eight-facts
      // layout. We can't wait on "main" because the default-branch and
      // branches cells both render it once the Worker answers with branches.
      expect(screen.getByText('Branches')).toBeTruthy()
    })

    // The names of the eight facts.
    expect(screen.getByText('Name')).toBeTruthy()
    expect(screen.getByText('Created')).toBeTruthy()
    expect(screen.getByText('Last push')).toBeTruthy()
    expect(screen.getByText('First push')).toBeTruthy()
    expect(screen.getByText('Default branch')).toBeTruthy()
    expect(screen.getByText('Branches')).toBeTruthy()
    expect(screen.getByText('Contributors')).toBeTruthy()
    expect(screen.getByText('Files changed')).toBeTruthy()
    // Two of the head-commit files are listed.
    expect(screen.getByText('src/app.js')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
    // The repo link points back to GitHub.
    const nameLink = screen.getByRole('link', { name: /octocat\/Hello-World/ })
    expect(nameLink.getAttribute('href')).toBe('https://github.com/octocat/hello-world')
  })

  it('shows a bad-link notice without ever calling the API', async () => {
    const { fetch } = stubApi()
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'not a link' } })
    submit()

    await waitFor(() => {
      expect(screen.getByText(/link could not be read/i)).toBeTruthy()
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows a "not found" notice when the Worker does not know the repo', async () => {
    stubApi({ repos: {} })
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()

    await waitFor(() => {
      expect(screen.getByText(/no such repo/i)).toBeTruthy()
    })
  })

  it('opens the GitHub link in a new tab with rel="noopener noreferrer"', async () => {
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()

    await waitFor(() => {
      // Wait on the contributors cell, which is unique to the eight-facts
      // layout, to avoid the duplicate "main" between default-branch and
      // branches rows.
      expect(screen.getByText(/rahim 2 \(67%, 1 merge\)/)).toBeTruthy()
    })
    const link = screen.getByRole('link', { name: /octocat\/Hello-World/ })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toMatch(/noopener/)
  })

  it('shows an "abbreviation" in the file list (+x −y per file)', async () => {
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()

    await waitFor(() => {
      expect(screen.getByText('src/app.js')).toBeTruthy()
    })
    const fileItem = screen.getByText('src/app.js').closest('li')
    if (!fileItem) throw new Error('expected src/app.js to be in a list item')
    expect(within(fileItem).getByText('+12 −4')).toBeTruthy()
  })

  it('truncates the file list to 30 and lets the user show the rest', async () => {
    const manyFiles: FileChange[] = Array.from({ length: 35 }, (_, i) => ({
      path: `src/file-${String(i).padStart(2, '0')}.js`,
      status: 'added',
      additions: 1,
      deletions: 0,
    }))
    stubApi({
      repos: { [KEY]: REPO },
      activity: { [KEY]: ACTIVITY },
      files: { [HEAD]: { sha: HEAD, stats: null, files: manyFiles, more: false, tooLarge: false } },
      commits: { [`${KEY}@main`]: COMMITS },
    })
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()

    await waitFor(() => {
      expect(screen.getByText('src/file-00.js')).toBeTruthy()
    })
    // First 30 files visible, the rest gated by "Show all".
    expect(screen.getByText('src/file-29.js')).toBeTruthy()
    expect(screen.queryByText('src/file-30.js')).toBeNull()
    expect(screen.getByText(/5 more files hidden/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /show all/i }))
    expect(screen.getByText('src/file-34.js')).toBeTruthy()
  })

  it('shows a warning when the head commit has more files than the Worker returns', async () => {
    stubApi({
      repos: { [KEY]: REPO },
      activity: { [KEY]: ACTIVITY },
      files: {
        [HEAD]: { sha: HEAD, stats: null, files: FILES, more: true, tooLarge: false },
      },
      commits: { [`${KEY}@main`]: COMMITS },
    })
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()
    await waitFor(() => {
      expect(screen.getByText(/more files than this view can show/i)).toBeTruthy()
    })
  })

  it('shows a network error when the repos call throws', async () => {
    stubApi()
    const fetch = (globalThis as Record<string, unknown>).fetch as ReturnType<typeof vi.fn>
    fetch.mockRejectedValue(new Error('boom'))
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()
    await waitFor(
      () => {
        expect(screen.getByText(/no connection to the server/i)).toBeTruthy()
      },
      { timeout: 8000 },
    )
  })

  it('shows a repo_error message when the Worker reports an error', async () => {
    stubApi({
      repos: {
        'octocat/hello-world': { key: 'octocat/hello-world', state: 'error', code: 'forbidden' },
      },
    })
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()
    await waitFor(() => {
      expect(screen.getByText(/forbidden/i)).toBeTruthy()
    })
  })

  it('shows every branch in the report, with the default branch first', async () => {
    const repoWithBranches: RepoOk = okRepo(KEY, {
      nameWithOwner: 'octocat/Hello-World',
      defaultBranch: 'main',
      headOid: HEAD,
      createdAt: '2026-09-01T08:00:00Z',
      pushedAt: '2026-10-01T08:00:00Z',
      branches: { total: 3, names: ['dev', 'feature-login', 'main'] },
    })
    stubApi({
      repos: { [KEY]: repoWithBranches },
      activity: { [KEY]: ACTIVITY },
      files: { [HEAD]: FILES_RESPONSE },
      commits: { [`${KEY}@main`]: COMMITS },
    })
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()

    await waitFor(() => {
      // The Branches row uses the same "main; dev; feature-login" wording
      // that the results report uses, via branchNamesText.
      expect(screen.getByText(/main; dev; feature-login/)).toBeTruthy()
    })
  })

  it('shows the contributors breakdown with merges and percentages', async () => {
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()

    await waitFor(() => {
      // Same wording as the report: "rahim 2 (67%, 1 merge); nusrat 1 (33%)".
      expect(screen.getByText(/rahim 2 \(67%, 1 merge\); nusrat 1 \(33%\)/)).toBeTruthy()
    })
  })

  it('shows "Could not be loaded" for contributors when the commits call fails, but keeps the other facts', async () => {
    // Override the beforeEach seed so no commits are returned. The fake
    // answers 404 on /commits, so the orchestrator flags contributorsFailed
    // while still returning a result for the six core facts.
    stubApi({
      repos: { [KEY]: REPO },
      activity: { [KEY]: ACTIVITY },
      files: { [HEAD]: FILES_RESPONSE },
    })
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()

    await waitFor(() => {
      expect(screen.getByText(/could not be loaded/i)).toBeTruthy()
    })
    // The core facts are still there.
    expect(screen.getByText('Default branch')).toBeTruthy()
    expect(screen.getByText('Files changed')).toBeTruthy()
    expect(screen.getByText('src/app.js')).toBeTruthy()
  })

  it('shows "No commits found" for an empty repo', async () => {
    const emptyRepo: RepoOk = okRepo(KEY, {
      nameWithOwner: 'octocat/Hello-World',
      defaultBranch: 'main',
      headOid: null,
      isEmpty: true,
      createdAt: '2026-09-01T08:00:00Z',
      pushedAt: null,
    })
    stubApi({
      repos: { [KEY]: emptyRepo },
      activity: { [KEY]: [] },
      files: {},
    })
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()

    await waitFor(() => {
      expect(screen.getByText('Default branch')).toBeTruthy()
    })
    expect(screen.getByText(/no commits found/i)).toBeTruthy()
  })
})
