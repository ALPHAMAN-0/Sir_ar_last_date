// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommitFilesResponse, CommitInfo } from '../../shared/api.ts'
import { failure, okRepo, oid, saveSheet, stubApi, type RowCells } from '../test/fakeApi.ts'

const WRITTEN = '2026-09-20T12:00:00Z'

type By = { login?: string | null; name?: string | null; merge?: boolean }
/** One commit, by a GitHub account unless `login` is null: then GitHub cannot say whose it is. */
const commit = (seed: string, { login = 'student', name = null, merge = false }: By = {}): CommitInfo => ({
  oid: oid(seed),
  committedAt: WRITTEN,
  authoredAt: WRITTEN,
  headline: seed,
  parents: merge ? [oid('p1'), oid('p2')] : [oid('p1')],
  authorName: name,
  authorLogin: login,
})
const commits = (prefix: string, count: number, by: By): CommitInfo[] =>
  Array.from({ length: count }, (_, index) => commit(`${prefix}-${index}`, by))

/** Rahim's repo: 8 commits of his (2 of them merges) and 4 signed with a name GitHub cannot place. */
const AX = [
  ...commits('rahim', 6, { login: 'rahim' }),
  ...commits('rahim-merge', 2, { login: 'rahim', merge: true }),
  ...commits('nusrat', 4, { login: null, name: 'Nusrat Jahan' }),
]
const BY = commits('karim', 3, { login: 'karim-h' })

const SHEET: RowCells[] = [
  ['22-46001-1', 'Rahim Uddin', 'github.com/a/x'],
  ['22-46002-1', 'Karim Hasan', 'github.com/b/y'],
  ['22-46004-1', 'Nusrat Jahan', 'https://github.com/A/X'],
  ['22-46005-1', 'Tanvir Ahmed', 'gitlab.com/tanvir/x'],
  ['22-46006-1', 'Arif Hossain', 'github.com/ghost/missing'],
]

let fake: ReturnType<typeof stubApi>

beforeEach(() => {
  saveSheet(SHEET)
  fake = stubApi({
    repos: { 'a/x': okRepo('a/x', { nameWithOwner: 'A/X' }), 'b/y': okRepo('b/y') },
    commits: { 'a/x': AX, 'b/y': BY },
  })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

async function openContribution() {
  vi.resetModules()
  const store = await import('../state/store.ts')
  const { ContributionView } = await import('./ContributionView.tsx')
  store.start()
  render(<ContributionView />)
  return store
}

const tableOf = (repo: string) => screen.findByRole('table', { name: `Commits by person in ${repo}` })
/** The body rows of a repo's table, cell by cell. */
const lines = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.children].map((cell) => cell.textContent))
/** The block of one repo: who handed it in, the repo, and its table. */
const blockOf = async (repo: string) => (await tableOf(repo)).closest('li') as HTMLElement
const asked = (route: string) => fake.paths().filter((path) => path === `/api/v1/${route}`).length

describe('ContributionView', () => {
  it('shows every repo with its committers, their commits and their share', async () => {
    await openContribution()
    expect(screen.getByRole('heading', { level: 1, name: 'Contribution' })).toBeTruthy()

    expect(lines(await tableOf('A/X'))).toEqual([
      ['rahim', '8 (2 merges)', '67%'],
      ['Nusrat Jahan', '4', '33%'],
    ])
    expect(lines(await tableOf('b/y'))).toEqual([['karim-h', '3', '100%']])

    const block = await blockOf('A/X')
    expect(within(block).getByRole('link', { name: 'A/X' }).getAttribute('href')).toBe('https://github.com/a/x')
    expect(within(block).getByText('12 commits by 2 people')).toBeTruthy()
    expect(within(await blockOf('b/y')).getByText('3 commits by 1 person')).toBeTruthy()
    expect(screen.getByText('2 repos: 1 with one committer, 1 with several.')).toBeTruthy()
  })

  it('shows a repo handed in by several people once, with all of them', async () => {
    await openContribution()
    const block = await blockOf('A/X')
    expect(screen.getAllByRole('table')).toHaveLength(2)
    expect(within(block).getByText('22-46001-1 · Rahim Uddin, 22-46004-1 · Nusrat Jahan')).toBeTruthy()
    expect(within(block).getByText('Handed in by 2 people')).toBeTruthy()
    expect(within(await blockOf('b/y')).queryByText(/Handed in by/)).toBeNull()
  })

  it("reads each repo's commits once, however many people handed it in", async () => {
    await openContribution()
    await tableOf('A/X')
    await tableOf('b/y')
    expect(asked('commits')).toBe(2)
  })

  it('lists the rows it cannot count, with the reason', async () => {
    await openContribution()
    await tableOf('b/y')
    const fold = screen.getByText('Not counted (2)').closest('details') as HTMLElement
    expect(within(fold).getAllByRole('listitem').map((item) => [...item.children].map((part) => part.textContent))).toEqual([
      ['22-46005-1 · Tanvir Ahmed gitlab.com/tanvir/x', 'Not a GitHub link'],
      ['22-46006-1 · Arif Hossain github.com/ghost/missing', 'Repo not found (private, deleted or mistyped)'],
    ])
  })

  it('says when the commits of a repo could not be read, and reads them again on Try again', async () => {
    fake.api.commits['b/y'] = failure(404, 'not_found', 'GitHub could not find this commit.')
    await openContribution()
    await tableOf('A/X')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The commits of 1 repo could not be read.')
    expect(screen.queryByRole('table', { name: 'Commits by person in b/y' })).toBeNull()
    expect(screen.getByText('The commits could not be read.')).toBeTruthy()

    fake.api.commits['b/y'] = BY
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(lines(await tableOf('b/y'))).toEqual([['karim-h', '3', '100%']])
    expect(screen.queryByRole('alert')).toBeNull()
    // The repo that was read is not asked for again.
    expect(asked('commits')).toBe(3)
  })

  it('narrows the list with the search box, and says when nothing matches', async () => {
    await openContribution()
    await tableOf('A/X')
    await tableOf('b/y')
    const search = screen.getByRole('searchbox', { name: 'Search by ID, name, repo or committer' })

    fireEvent.change(search, { target: { value: 'karim' } })
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.getByRole('table', { name: 'Commits by person in b/y' })).toBeTruthy()

    fireEvent.change(search, { target: { value: 'nusrat' } })
    expect(screen.getByRole('table', { name: 'Commits by person in A/X' })).toBeTruthy()

    fireEvent.change(search, { target: { value: 'nobody at all' } })
    expect(screen.queryAllByRole('table')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Show every repo' }))
    expect(screen.getAllByRole('table')).toHaveLength(2)
  })

  it('says when no row of the sheet leads to a repo with commits', async () => {
    saveSheet([
      ['22-46005-1', 'Tanvir Ahmed', 'gitlab.com/tanvir/x'],
      ['22-46006-1', 'Arif Hossain', 'github.com/ghost/missing'],
    ])
    await openContribution()
    expect(await screen.findByText('There is nothing to count: no row of this sheet leads to a repo with commits.')).toBeTruthy()
    expect(screen.queryAllByRole('table')).toHaveLength(0)
    expect(screen.getByText('Not counted (2)')).toBeTruthy()
    expect(asked('commits')).toBe(0)
  })

  it('says so for a repo whose history holds no commit to count', async () => {
    fake.api.commits['b/y'] = []
    await openContribution()
    await tableOf('A/X')
    await waitFor(() => expect(screen.getByText('No commits to count.')).toBeTruthy())
    expect(screen.queryByRole('table', { name: 'Commits by person in b/y' })).toBeNull()
  })

  it('shows the ten people with the most commits first, and the rest on request', async () => {
    // A fork of a large project: one student, and many people the class has never met.
    fake.api.commits['b/y'] = [
      ...commits('karim', 27, { login: 'karim-h' }),
      ...Array.from({ length: 12 }, (_, index) => commit(`stranger-${index}`, { login: `stranger-${index}` })),
    ]
    await openContribution()
    const table = await tableOf('b/y')
    expect(lines(table)).toHaveLength(10)
    expect(lines(table)[0]).toEqual(['karim-h', '27', '69%'])

    const block = await blockOf('b/y')
    expect(within(block).getByText('39 commits by 13 people')).toBeTruthy()
    expect(within(block).getByText(/3 more people made 3 commits \(8%\)/)).toBeTruthy()
    fireEvent.click(within(block).getByRole('button', { name: 'Show all 13 people' }))
    expect(lines(table)).toHaveLength(13)
    expect(within(block).queryByRole('button', { name: 'Show all 13 people' })).toBeNull()
    // A short list has no such line.
    expect(within(await blockOf('A/X')).queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('says that a fork is counted with the commits it came with', async () => {
    fake.api.repos['b/y'] = okRepo('b/y', { isFork: true, parent: 'teacher/starter' })
    fake.api.commits['b/y'] = [...commits('karim', 2, { login: 'karim-h' }), ...commits('starter', 3, { login: 'teacher' })]
    await openContribution()
    expect(lines(await tableOf('b/y'))).toEqual([
      ['teacher', '3', '60%'],
      ['karim-h', '2', '40%'],
    ])
    const block = await blockOf('b/y')
    expect(within(block).getByText('Fork')).toBeTruthy()
    expect(within(block).getByText('5 commits by 2 people, including the ones the fork came with')).toBeTruthy()
    expect(within(await blockOf('A/X')).queryByText(/the fork came with/)).toBeNull()
  })

  it('says when only the newest commits of a long history were counted', async () => {
    // The commit list goes on page after page; the page stops reading at ten.
    const answer = fake.fetch.getMockImplementation() as typeof fetch
    let page = 0
    fake.fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname !== '/api/v1/commits' || url.searchParams.get('repo') !== 'b/y') return answer(input)
      page++
      return new Response(
        JSON.stringify({ commits: [commit(`page-${page}`, { login: 'karim-h' })], next: `${oid('b/y')} ${page}` }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    await openContribution()
    expect(lines(await tableOf('b/y'))).toEqual([['karim-h', '10', '100%']])
    expect(
      within(await blockOf('b/y')).getByText('10 commits by 1 person. Only the newest commits of this repo were counted.'),
    ).toBeTruthy()
  })

  it('adds the padding commits of each person once the commits were checked', async () => {
    /** The files of one commit as the Worker answers them: one changed file, real or whitespace only. */
    const changed = (realChange: boolean): CommitFilesResponse => ({
      sha: '',
      stats: { additions: 5, deletions: 0 },
      files: [{ path: 'src/app.js', status: 'modified', additions: 5, deletions: 0, realChange }],
      more: false,
      tooLarge: false,
    })
    for (const [index, entry] of BY.entries()) fake.api.files[entry.oid] = changed(index === 0)
    for (const entry of AX) fake.api.files[entry.oid] = changed(true)

    vi.resetModules()
    const store = await import('../state/store.ts')
    const { loadPadding } = await import('../state/padding.ts')
    const { ContributionView } = await import('./ContributionView.tsx')
    store.start()
    await vi.waitFor(() => expect(store.currentPeople().filter((person) => person.meta).length).toBe(4))
    // "Check commits" on the register, for Karim's repo only.
    await loadPadding(
      store.currentPeople().filter((person) => person.row.name === 'Karim Hasan'),
      () => {},
    )
    render(<ContributionView />)

    const checked = await tableOf('b/y')
    expect(within(checked).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Person',
      'Commits',
      'Share',
      'Padding',
    ])
    expect(lines(checked)).toEqual([['karim-h', '3', '100%', '2']])
    // A repo that was not checked has no such column: not checked is not "none found".
    expect(within(await tableOf('A/X')).getAllByRole('columnheader')).toHaveLength(3)
  })
})
