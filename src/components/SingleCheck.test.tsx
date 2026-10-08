// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityEvent, CommitFilesResponse, FileChange, RepoOk } from '../../shared/api.ts'
import { okRepo, stubApi } from '../test/fakeApi.ts'

const HEAD = 'bbbbbbbbbbbb0000000000000000000000000000'
const REPO: RepoOk = okRepo('octocat/hello-world', {
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
    repos: { 'octocat/hello-world': REPO },
    activity: { 'octocat/hello-world': ACTIVITY },
    files: { [HEAD]: FILES_RESPONSE },
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

  it('shows the six facts of the repo after a successful check', async () => {
    await renderSingleCheck()
    fireEvent.change(inputLink(), { target: { value: 'octocat/Hello-World' } })
    submit()

    await waitFor(() => {
      expect(screen.getByText('main')).toBeTruthy()
    })

    // The names of the six facts.
    expect(screen.getByText('Name')).toBeTruthy()
    expect(screen.getByText('Created')).toBeTruthy()
    expect(screen.getByText('Last push')).toBeTruthy()
    expect(screen.getByText('First push')).toBeTruthy()
    expect(screen.getByText('Default branch')).toBeTruthy()
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
      expect(screen.getByText('main')).toBeTruthy()
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
      repos: { 'octocat/hello-world': REPO },
      activity: { 'octocat/hello-world': ACTIVITY },
      files: { [HEAD]: { sha: HEAD, stats: null, files: manyFiles, more: false, tooLarge: false } },
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
      repos: { 'octocat/hello-world': REPO },
      activity: { 'octocat/hello-world': ACTIVITY },
      files: {
        [HEAD]: { sha: HEAD, stats: null, files: FILES, more: true, tooLarge: false },
      },
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
})
