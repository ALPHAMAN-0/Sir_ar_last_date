// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import type { CommitFilesResponse, CommitInfo } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import { formatDateTime, formatDuration, parseDeadlineInput } from '../logic/time.ts'
import { excelDate } from '../sheet/exportXlsx.ts'
import {
  FETCHED_AT,
  okRepo,
  oid,
  saveSheet,
  STORAGE_KEY,
  stubApi,
  stubIntersectionObserver,
  type RowCells,
} from '../test/fakeApi.ts'

const SHEET: RowCells[] = [
  ['22-46001-1', 'Rahim Uddin', 'https://github.com/octocat/hello-world'],
  ['22-46002-1', 'Nusrat Jahan', 'github.com/octocat/spoon-knife'],
  ['22-46003-1', 'Tanvir Ahmed', 'see my email'],
  ['22-46004-1', 'Arif Hossain', 'github.com/ghost/missing'],
]

const REPOS = {
  'octocat/hello-world': okRepo('octocat/hello-world', { pushedAt: '2026-10-01T08:00:00Z', totalCommits: 5 }),
  'octocat/spoon-knife': okRepo('octocat/spoon-knife', { pushedAt: '2026-10-03T10:00:00Z', totalCommits: 12 }),
}

/** A fresh store with the saved sheet, and the register drawn once every repo is checked. */
async function openRegister() {
  vi.resetModules()
  const store = await import('../state/store.ts')
  const { Register } = await import('./Register.tsx')
  store.start()
  const view = render(<Register />)
  await screen.findByText(`Checked ${formatDateTime(FETCHED_AT)}`)
  return { store, view }
}

/** The names in the table, top to bottom. */
const names = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[2].textContent)

const sortOf = (label: string) => screen.getByRole('columnheader', { name: label }).getAttribute('aria-sort')
const chip = (label: RegExp) => screen.getByRole('button', { name: label })
const pressed = (label: RegExp) => chip(label).getAttribute('aria-pressed')
const search = (text: string) =>
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search by ID, name or repo' }), {
    target: { value: text },
  })

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('the register', () => {
  let fake: ReturnType<typeof stubApi>
  beforeEach(() => {
    saveSheet(SHEET)
    fake = stubApi({ repos: { ...REPOS } })
  })

  it('shows the sheet and one judged row per person', async () => {
    await openRegister()
    expect(screen.getByText('class-7.xlsx')).toBeTruthy()
    expect(screen.getByText('4 people')).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('Has work')).toHaveLength(2)
    expect(within(table).getByText('Invalid link')).toBeTruthy()
    expect(within(table).getByText('Not found')).toBeTruthy()
  })

  describe('sorting', () => {
    it('starts with the newest push first, rows without one last', async () => {
      await openRegister()
      expect(sortOf('Last push')).toBe('descending')
      expect(sortOf('Name')).toBe('none')
      expect(names()).toEqual(['Nusrat Jahan', 'Rahim Uddin', 'Tanvir Ahmed', 'Arif Hossain'])
    })

    it('sorts by a text column A to Z, then Z to A on a second click', async () => {
      await openRegister()
      fireEvent.click(screen.getByRole('button', { name: 'Name' }))
      expect(sortOf('Name')).toBe('ascending')
      expect(sortOf('Last push')).toBe('none')
      expect(names()).toEqual(['Arif Hossain', 'Nusrat Jahan', 'Rahim Uddin', 'Tanvir Ahmed'])

      fireEvent.click(screen.getByRole('button', { name: 'Name' }))
      expect(sortOf('Name')).toBe('descending')
      expect(names()).toEqual(['Tanvir Ahmed', 'Rahim Uddin', 'Nusrat Jahan', 'Arif Hossain'])
    })

    it('sorts counts largest first, keeping rows without a count at the bottom', async () => {
      await openRegister()
      fireEvent.click(screen.getByRole('button', { name: 'Commits' }))
      expect(sortOf('Commits')).toBe('descending')
      expect(names()).toEqual(['Nusrat Jahan', 'Rahim Uddin', 'Tanvir Ahmed', 'Arif Hossain'])
    })

    it('remembers the chosen order for the next visit', async () => {
      await openRegister()
      fireEvent.click(screen.getByRole('button', { name: 'Name' }))
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').sort).toEqual({
        column: 'name',
        descending: false,
      })
    })
  })

  describe('downloading', () => {
    /** Files the page handed to the browser, instead of saving them. */
    let saved: Array<{ bytes: Uint8Array; name: string }>
    const useSaver = (save: (bytes: Uint8Array, name: string) => void) =>
      vi.doMock('../sheet/xlsxStyle.ts', async (original) => ({
        ...(await original<typeof import('../sheet/xlsxStyle.ts')>()),
        saveFile: save,
      }))
    beforeEach(() => {
      saved = []
      useSaver((bytes, name) => saved.push({ bytes, name }))
    })
    afterEach(() => {
      vi.doUnmock('../sheet/xlsxStyle.ts')
      vi.restoreAllMocks()
    })

    it('writes the rows on screen as a report that says it was filtered', async () => {
      await openRegister()
      fireEvent.click(chip(/Not found/))
      fireEvent.click(screen.getByRole('button', { name: 'Download 1 row' }))
      await waitFor(() => expect(saved).toHaveLength(1))

      expect(saved[0].name).toMatch(/^results-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx$/)
      const book = XLSX.read(saved[0].bytes, { type: 'array' })
      expect(book.SheetNames).toEqual(['Results', 'Summary', 'Needs attention', 'Same repo', 'Info'])
      const summary = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Summary, { header: 1 })
      expect(summary.find((line) => line[0] === 'People in this file')?.[1]).toBe(
        '1 of 4 (filtered by Status: Not found)',
      )
      expect(book.Sheets.Results.C2.v).toBe('Arif Hossain')
    })

    it('reads the first push of each repo on screen and writes it between the two other dates', async () => {
      const CREATED_BY = '2026-09-02T09:00:00Z'
      const OLDEST = '2021-03-04T05:00:00Z'
      // One repo has a push log. The other is older than GitHub's log and has only its commits.
      fake.api.activity['octocat/hello-world'] = [
        { ts: CREATED_BY, type: 'branch_creation', ref: 'refs/heads/main', before: ZERO_OID, after: oid('octocat/hello-world'), actor: 'rahim' },
      ]
      fake.api.commits['octocat/spoon-knife'] = [
        { oid: oid('oldest'), committedAt: OLDEST, authoredAt: OLDEST, headline: 'Start', parents: [], authorName: 'Nusrat', authorLogin: 'nusrat' },
      ]
      await openRegister()
      expect(fake.paths()).not.toContain('/api/v1/activity')

      fireEvent.click(screen.getByRole('button', { name: 'Download .xlsx' }))
      await waitFor(() => expect(saved).toHaveLength(1))

      const results = XLSX.read(saved[0].bytes, { type: 'array' }).Sheets.Results
      const header = XLSX.utils.sheet_to_json<string[]>(results, { header: 1 })[0]
      expect(header).not.toContain('Notes')
      expect(header.slice(6, 9)).toEqual(['Repo created', 'First push', 'Last push'])
      // On screen order: Nusrat, Rahim, then the two rows without a repo.
      expect([results.C2.v, results.C3.v]).toEqual(['Nusrat Jahan', 'Rahim Uddin'])
      const serial = (iso: string) => (excelDate(iso) as { v: number }).v
      expect(results.H3.v).toBeCloseTo(serial(CREATED_BY), 8)
      expect(results.H3.w).not.toContain('commit date')
      expect(results.H2.v).toBeCloseTo(serial(OLDEST), 8)
      expect(results.H2.w).toMatch(/ \(commit date\)$/)
      expect([results.H4?.v ?? '', results.H5?.v ?? '']).toEqual(['', ''])
      expect(results.G3.v).toBeCloseTo(serial('2026-09-01T08:00:00Z'), 8)
      expect(results.I3.v).toBeCloseTo(serial('2026-10-01T08:00:00Z'), 8)
    })

    it('writes after the branch who committed on each repo, with their share of its commits', async () => {
      const commit = (seed: string, parents: string[], login: string, at: string) => ({
        oid: oid(seed), committedAt: at, authoredAt: at, headline: seed, parents, authorName: null, authorLogin: login,
      })
      fake.api.commits['octocat/hello-world'] = [
        commit('merge', [oid('two'), oid('side')], 'rahim', '2026-09-30T10:00:00Z'),
        commit('two', [oid('one')], 'rahim', '2026-09-29T10:00:00Z'),
        commit('one', [], 'nusrat', '2026-09-28T10:00:00Z'),
      ]
      fake.api.commits['octocat/spoon-knife'] = [commit('only', [], 'nusrat', '2026-09-28T10:00:00Z')]
      // Rahim also made a second branch.
      fake.api.repos['octocat/hello-world'] = {
        ...REPOS['octocat/hello-world'],
        branches: { total: 2, names: ['dev', 'main'] },
      }
      await openRegister()
      fireEvent.click(screen.getByRole('button', { name: 'Download .xlsx' }))
      await waitFor(() => expect(saved).toHaveLength(1))

      const results = XLSX.read(saved[0].bytes, { type: 'array' }).Sheets.Results
      const header = XLSX.utils.sheet_to_json<string[]>(results, { header: 1 })[0]
      expect(header.slice(-4)).toEqual(['Commits by person', 'Padding commits', 'Branches', 'Branch names'])
      // On screen order: Nusrat, Rahim, then the two rows without a repo.
      expect([results.O2.v, results.O3.v]).toEqual(['nusrat 1 (100%)', 'rahim 2 (67%, 1 merge); nusrat 1 (33%)'])
      expect([results.O4?.v ?? '', results.O5?.v ?? '']).toEqual(['', ''])
      // The branches came with the repo facts: how many, then their names, the main branch first.
      expect([results.Q2.v, results.R2.v, results.Q3.v, results.R3.v]).toEqual([1, 'main', 2, 'main; dev'])
      expect([results.Q4?.v ?? '', results.R5?.v ?? '']).toEqual(['', ''])
      // Each list was read once: the first pushes and who committed use the same one.
      expect(fake.paths().filter((path) => path === '/api/v1/commits')).toHaveLength(2)
    })

    it('asks GitHub only about the repos that go into the file', async () => {
      await openRegister()
      search('spoon')
      fireEvent.click(screen.getByRole('button', { name: 'Download 1 row' }))
      await waitFor(() => expect(saved).toHaveLength(1))

      const logs = fake.fetch.mock.calls.map(([input]) => String(input)).filter((url) => url.includes('/api/v1/activity'))
      expect(logs).toHaveLength(1)
      expect(logs[0]).toContain('repo=octocat%2Fspoon-knife')
      // A filter that leaves no repo with work asks nothing at all.
      search('')
      fireEvent.click(chip(/Not found/))
      fireEvent.click(screen.getByRole('button', { name: 'Download 1 row' }))
      await waitFor(() => expect(saved).toHaveLength(2))
      expect(fake.paths().filter((path) => path === '/api/v1/activity')).toHaveLength(1)
    })

    it('still writes the file when a first push cannot be read, and says so in the cell', async () => {
      fake.api.activity['octocat/hello-world'] = { failure: { status: 404, code: 'repo_not_found', message: 'This repo was not found.' } }
      await openRegister()
      fireEvent.click(screen.getByRole('button', { name: 'Download .xlsx' }))
      await waitFor(() => expect(saved).toHaveLength(1))

      const results = XLSX.read(saved[0].bytes, { type: 'array' }).Sheets.Results
      // Nusrat's repo has neither a log nor commits to read here; Rahim's log failed.
      expect([results.C2.v, results.H2.v]).toEqual(['Nusrat Jahan', 'Not known'])
      expect([results.C3.v, results.H3.v]).toEqual(['Rahim Uddin', 'Could not be loaded'])
      expect(screen.queryByRole('alert')).toBeNull()
      // Without a deadline a failed log changes nobody's status.
      expect([results.E2.v, results.E3.v]).toEqual(['Has work', 'Has work'])
      // Neither repo has commits to read here either.
      expect([results.O2.v, results.O3.v]).toEqual(['Could not be loaded', 'Could not be loaded'])
    })

    /** Holds back every push log until `release()`, as a slow network would. */
    function holdPushLogs() {
      let release = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const answer = fake.fetch.getMockImplementation() as typeof fetch
      fake.fetch.mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/v1/activity')) await held
        return answer(input)
      })
      return () => release()
    }

    it('says how far the reading is, and keeps Refresh and Download still until the file is written', async () => {
      const release = holdPushLogs()
      await openRegister()
      fireEvent.click(screen.getByRole('button', { name: 'Download .xlsx' }))

      // Three repos have a link: two with work, and the one that was not found.
      expect(await screen.findByText(/^Reading first pushes for the file: \d of 3 repos$/)).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'Download .xlsx' }) as HTMLButtonElement).disabled).toBe(true)
      expect(saved).toHaveLength(0)

      release()
      await waitFor(() => expect(saved).toHaveLength(1))
      expect(await screen.findByText(`Checked ${formatDateTime(FETCHED_AT)}`)).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false)
      expect((screen.getByRole('button', { name: 'Download .xlsx' }) as HTMLButtonElement).disabled).toBe(false)
    })

    /** Holds back every commit list until `release()`, as a slow network would. */
    function holdCommits() {
      let release = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const answer = fake.fetch.getMockImplementation() as typeof fetch
      fake.fetch.mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/v1/commits')) await held
        return answer(input)
      })
      return () => release()
    }

    it('says how far the commits are read once the first pushes are in, and keeps the buttons still', async () => {
      // Both logs name the first push, so the commits are read for the new column only.
      for (const repo of ['octocat/hello-world', 'octocat/spoon-knife']) {
        fake.api.activity[repo] = [
          { ts: '2026-09-02T09:00:00Z', type: 'branch_creation', ref: 'refs/heads/main', before: ZERO_OID, after: oid(repo), actor: 'someone' },
        ]
      }
      const release = holdCommits()
      await openRegister()
      fireEvent.click(screen.getByRole('button', { name: 'Download .xlsx' }))

      expect(await screen.findByText(/^Reading commits for the file: \d of 3 repos$/)).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'Download .xlsx' }) as HTMLButtonElement).disabled).toBe(true)
      expect(saved).toHaveLength(0)
      expect(fake.paths().filter((path) => path === '/api/v1/commits')).toHaveLength(2)

      release()
      await waitFor(() => expect(saved).toHaveLength(1))
      expect(await screen.findByText(`Checked ${formatDateTime(FETCHED_AT)}`)).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Download .xlsx' }) as HTMLButtonElement).disabled).toBe(false)
    })

    /** Holds back the files of every commit until `release()`, as a slow network would. */
    function holdFiles() {
      let release = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const answer = fake.fetch.getMockImplementation() as typeof fetch
      fake.fetch.mockImplementation(async (input: RequestInfo | URL) => {
        if (new URL(String(input), 'http://localhost').pathname === '/api/v1/commit') await held
        return answer(input)
      })
      return () => release()
    }

    /** The files of one commit as the Worker answers them: one changed file, real or whitespace only. */
    const changed = (lines: number, realChange: boolean): CommitFilesResponse => ({
      sha: '',
      stats: { additions: lines, deletions: 0 },
      files: [{ path: 'src/app.js', status: 'modified', additions: lines, deletions: 0, realChange }],
      more: false,
      tooLarge: false,
    })

    /** Two repos with work: one of Rahim's commits changed only whitespace, and Nusrat helped him with a tiny one. */
    function commitsToCheck() {
      const at = '2026-09-28T10:00:00Z'
      const commit = (seed: string, login: string): CommitInfo => ({
        oid: oid(seed), committedAt: at, authoredAt: at, headline: seed, parents: [], authorName: null, authorLogin: login,
      })
      fake.api.commits['octocat/hello-world'] = [commit('real', 'rahim'), commit('blank', 'rahim'), commit('theirs', 'nusrat')]
      fake.api.commits['octocat/spoon-knife'] = [commit('only', 'nusrat')]
      fake.api.files[oid('real')] = changed(40, true)
      fake.api.files[oid('blank')] = changed(2, false)
      fake.api.files[oid('theirs')] = changed(1, true)
      fake.api.files[oid('only')] = changed(5, true)
    }
    const fileRequests = () => fake.paths().filter((path) => path === '/api/v1/commit').length
    const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

    it('checks every commit on screen for padding, says how far it is, and writes what it found', async () => {
      commitsToCheck()
      const release = holdFiles()
      await openRegister()
      fireEvent.click(button('Check commits'))

      expect(await screen.findByText(/^Checking the files of 4 commits: \d of 4$/)).toBeTruthy()
      for (const name of ['Refresh', 'Download .xlsx', 'Check commits']) expect(button(name).disabled, name).toBe(true)
      release()
      expect(await screen.findByText(`Checked ${formatDateTime(FETCHED_AT)}`)).toBeTruthy()
      await waitFor(() => expect(button('Check commits').disabled).toBe(false))
      expect(fileRequests()).toBe(4)

      // A second check finds everything already known.
      fireEvent.click(button('Check commits'))
      await waitFor(() => expect(button('Check commits').disabled).toBe(false))
      expect(fileRequests()).toBe(4)

      fireEvent.click(button('Download .xlsx'))
      await waitFor(() => expect(saved).toHaveLength(1))
      const results = XLSX.read(saved[0].bytes, { type: 'array' }).Sheets.Results
      // On screen order: Nusrat, Rahim, then the two rows without a repo.
      expect(results.O2.v).toBe('nusrat 1 (100%): 1 real')
      expect(results.O3.v).toBe('rahim 2 (67%): 1 real, 1 only whitespace; nusrat 1 (33%): 1 real (1 tiny)')
      expect(results.P1.v).toBe('Padding commits')
      expect(results.P2).toMatchObject({ t: 'n', v: 0 })
      expect(results.P3).toMatchObject({ t: 'n', v: 1 })
      expect([results.P4?.v ?? '', results.P5?.v ?? '']).toEqual(['', ''])
      expect(fileRequests()).toBe(4)
    })

    it('checks only the repos on screen, and leaves the others unchecked in the file', async () => {
      commitsToCheck()
      await openRegister()
      search('spoon')
      fireEvent.click(button('Check commits'))
      await waitFor(() => expect(fileRequests()).toBe(1))
      await waitFor(() => expect(button('Check commits').disabled).toBe(false))

      search('')
      fireEvent.click(button('Download .xlsx'))
      await waitFor(() => expect(saved).toHaveLength(1))
      const results = XLSX.read(saved[0].bytes, { type: 'array' }).Sheets.Results
      expect(results.O2.v).toBe('nusrat 1 (100%): 1 real')
      expect(results.O3.v).toBe('rahim 2 (67%); nusrat 1 (33%)')
      expect(results.P2).toMatchObject({ t: 'n', v: 0 })
      expect(results.P3?.v ?? '').toBe('')
    })

    it('writes no file when the sheet is removed while the first pushes are read', async () => {
      const release = holdPushLogs()
      const { store } = await openRegister()
      fireEvent.click(screen.getByRole('button', { name: 'Download .xlsx' }))
      await screen.findByText(/^Reading first pushes for the file/)

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }))
      expect(store.getState().sheet).toBeNull()
      release()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(saved).toHaveLength(0)
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('says so when the file cannot be written', async () => {
      useSaver(() => {
        throw new Error('disk full')
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await openRegister()
      fireEvent.click(screen.getByRole('button', { name: 'Download .xlsx' }))
      expect((await screen.findByRole('alert')).textContent).toBe(
        'The results file could not be written. Please try again.',
      )
    })
  })

  describe('filtering', () => {
    it('shows a chip per status with its count, and filters on a click', async () => {
      await openRegister()
      expect(pressed(/Everyone/)).toBe('true')
      expect(chip(/Everyone/).textContent).toBe('4 Everyone')
      expect(chip(/Has work/).textContent).toBe('2 Has work')

      fireEvent.click(chip(/Not found/))
      expect(pressed(/Not found/)).toBe('true')
      expect(pressed(/Everyone/)).toBe('false')
      expect(names()).toEqual(['Arif Hossain'])
      expect(screen.getByRole('button', { name: 'Download 1 row' })).toBeTruthy()

      // A second click on the same chip shows everyone again.
      fireEvent.click(chip(/Not found/))
      expect(pressed(/Everyone/)).toBe('true')
      expect(names()).toHaveLength(4)
      expect(screen.getByRole('button', { name: 'Download .xlsx' })).toBeTruthy()
    })

    it('searches IDs, names and the link as written in the sheet', async () => {
      await openRegister()
      search('spoon')
      expect(names()).toEqual(['Nusrat Jahan'])
      search('22-46003')
      expect(names()).toEqual(['Tanvir Ahmed'])
      search('  ARIF ')
      expect(names()).toEqual(['Arif Hossain'])
    })

    it('says when nobody matches, and shows everyone again on request', async () => {
      await openRegister()
      fireEvent.click(chip(/Has work/))
      search('Tanvir')
      expect(screen.queryByRole('table')).toBeNull()
      expect(screen.getByText(/Nobody matches this filter/)).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Download 0 rows' }) as HTMLButtonElement).disabled).toBe(true)

      fireEvent.click(screen.getByRole('button', { name: 'Show everyone' }))
      expect(names()).toHaveLength(4)
      expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
      expect(pressed(/Everyone/)).toBe('true')
    })
  })

  describe('removing the sheet', () => {
    it('asks first, and keeps the sheet on "Keep it"', async () => {
      await openRegister()
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      expect(screen.getByRole('alert').textContent).toContain('Remove this sheet from this browser?')
      expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy()
      expect(screen.getByText('class-7.xlsx')).toBeTruthy()
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
    })

    it('forgets the sheet in this browser on "Yes, remove"', async () => {
      const { store, view } = await openRegister()
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }))
      expect(store.getState().sheet).toBeNull()
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
      expect(view.container.innerHTML).toBe('')
    })
  })

  it('asks GitHub again on Refresh and shows what changed', async () => {
    await openRegister()
    const before = fake.paths().filter((path) => path === '/api/v1/repos').length
    // The missing repo has been made public since.
    fake.api.repos['ghost/missing'] = okRepo('ghost/missing')

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByText('Has work')).toHaveLength(3))
    expect(names()).toEqual(['Nusrat Jahan', 'Rahim Uddin', 'Arif Hossain', 'Tanvir Ahmed'])
    expect(fake.paths().filter((path) => path === '/api/v1/repos').length).toBe(before + 1)
  })

  it('shows how many GitHub requests are left this hour', async () => {
    fake.api.status = {
      fetchedAt: FETCHED_AT,
      core: { remaining: 4321, limit: 5000, resetAt: '2026-10-06T05:00:00Z' },
      graphql: { remaining: 4800, limit: 5000, resetAt: '2026-10-06T05:00:00Z' },
      reserve: 500,
    }
    await openRegister()
    const line = await screen.findByText(/GitHub requests left this hour/)
    expect(line.textContent).toBe(
      'GitHub requests left this hour, shared by everyone using this page: 4,321 of 5,000. The app stops at 500.',
    )
  })
})

describe('the register with a deadline', () => {
  const INPUT = '2026-10-02T23:59'
  const DEADLINE = (parseDeadlineInput(INPUT) as { ms: number }).ms
  /** An instant whole minutes after the deadline (or before, when negative). */
  const at = (minutes: number) => new Date(DEADLINE + 1 + minutes * 60_000).toISOString()
  const IN_TIME = oid('in time')
  let fake: ReturnType<typeof stubApi>

  beforeEach(() => {
    saveSheet(
      [
        ['22-46001-1', 'Rahim Uddin', 'github.com/octocat/hello-world'],
        ['22-46002-1', 'Nusrat Jahan', 'github.com/octocat/spoon-knife'],
        ['22-46005-1', 'Salma Akter', 'github.com/salma/late-start'],
      ],
      { deadlineInput: INPUT },
    )
    fake = stubApi({
      repos: {
        'octocat/hello-world': okRepo('octocat/hello-world', { pushedAt: at(-600) }),
        'octocat/spoon-knife': okRepo('octocat/spoon-knife', { pushedAt: at(540) }),
        'salma/late-start': okRepo('salma/late-start', { createdAt: at(120), pushedAt: at(199) }),
      },
      activity: {
        // Pushed in time, then once more 9 hours after the deadline.
        'octocat/spoon-knife': [
          { ts: at(540), type: 'push', ref: 'refs/heads/main', before: IN_TIME, after: oid('octocat/spoon-knife'), actor: 'nusrat' },
          { ts: at(-1440), type: 'push', ref: 'refs/heads/main', before: ZERO_OID, after: IN_TIME, actor: 'nusrat' },
        ],
        // The repo did not exist at the deadline; the first push came 3h 19m after it.
        'salma/late-start': [
          { ts: at(199), type: 'push', ref: 'refs/heads/main', before: ZERO_OID, after: oid('salma/late-start'), actor: 'salma' },
        ],
      },
    })
  })

  it('judges every row against the deadline and says how late', async () => {
    await openRegister()
    const table = screen.getByRole('table')
    const row = (name: string) => within(table).getByRole('link', { name }).closest('tr') as HTMLElement

    expect(within(row('Rahim Uddin')).getByText('On time')).toBeTruthy()
    expect(within(row('Nusrat Jahan')).getByText('Changed after deadline')).toBeTruthy()
    expect(within(row('Nusrat Jahan')).getByText(formatDuration(9 * 3_600_000))).toBeTruthy()
    expect(await within(row('Salma Akter')).findByText('3h 19m')).toBeTruthy()
    expect(within(row('Salma Akter')).getByText('Late')).toBeTruthy()

    expect(chip(/Late$/).textContent).toBe('1 Late')
    expect(chip(/On time/).textContent).toBe('1 On time')
  })

  describe('downloading', () => {
    /** Files the page handed to the browser, instead of saving them. */
    let saved: Array<{ bytes: Uint8Array; name: string }>
    beforeEach(() => {
      saved = []
      vi.doMock('../sheet/xlsxStyle.ts', async (original) => ({
        ...(await original<typeof import('../sheet/xlsxStyle.ts')>()),
        saveFile: (bytes: Uint8Array, name: string) => saved.push({ bytes, name }),
      }))
      // Rahim's repo is older than GitHub's push log: it has only its commits.
      const OLDEST = at(-700)
      fake.api.commits['octocat/hello-world'] = [
        { oid: oid('rahim'), committedAt: OLDEST, authoredAt: OLDEST, headline: 'First page', parents: [], authorName: 'Rahim', authorLogin: 'rahim' },
      ]
    })
    afterEach(() => vi.doUnmock('../sheet/xlsxStyle.ts'))

    const download = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download .xlsx' }))
      await waitFor(() => expect(saved).toHaveLength(1))
      const book = XLSX.read(saved[0].bytes, { type: 'array' })
      const grid = (name: string) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '', raw: false })
      return { book, grid }
    }

    it('writes status, lateness and the created, first and last push dates of every row, with no notes', async () => {
      await openRegister()
      await within(screen.getByRole('table')).findByText('3h 19m')
      const { grid } = await download()

      // As on screen: the newest push first.
      const [header, ...rows] = grid('Results')
      expect(header.slice(0, 9)).toEqual(['Row', 'ID', 'Name', 'Repo', 'Status', 'Late by', 'Repo created', 'First push', 'Last push'])
      expect(rows.map((line) => line.slice(2, 9))).toEqual([
        ['Nusrat Jahan', 'octocat/spoon-knife', 'Changed after deadline', formatDuration(9 * 3_600_000), formatDateTime('2026-09-01T08:00:00Z'), formatDateTime(at(-1440)), formatDateTime(at(540))],
        ['Salma Akter', 'salma/late-start', 'Late', '3h 19m', formatDateTime(at(120)), formatDateTime(at(199)), formatDateTime(at(199))],
        ['Rahim Uddin', 'octocat/hello-world', 'On time', '', formatDateTime('2026-09-01T08:00:00Z'), `${formatDateTime(at(-700))} (commit date)`, formatDateTime(at(-600))],
      ])
      for (const name of ['Results', 'Needs attention']) expect(grid(name)[0], name).not.toContain('Notes')

      // Late in minutes and the last push in time, for the two who were not on time.
      expect(rows.map((line) => [line[11], line[12]])).toEqual([
        ['540', formatDateTime(at(-1440))],
        ['199', ''],
        ['', ''],
      ])
    })

    it('lists who needs attention, the most urgent first, in seven columns', async () => {
      await openRegister()
      await within(screen.getByRole('table')).findByText('3h 19m')
      const { grid } = await download()

      const [header, ...rows] = grid('Needs attention')
      expect(header).toEqual(['Row', 'ID', 'Name', 'Repo', 'Status', 'Late by', 'What to do'])
      expect(rows.map((line) => [line[2], line[4]])).toEqual([
        ['Salma Akter', 'Late'],
        ['Nusrat Jahan', 'Changed after deadline'],
      ])
      expect(rows[0]).toHaveLength(7)
    })

    it('reads no push log twice: the two the register read are used as they are', async () => {
      await openRegister()
      await within(screen.getByRole('table')).findByText('3h 19m')
      const logs = () => fake.paths().filter((path) => path === '/api/v1/activity').length
      expect(logs()).toBe(2)

      await download()
      // Only the on-time repo was still unread.
      expect(logs()).toBe(3)
      // Rahim's commits, read for his first push, serve for who committed too; the other two repos are asked once each.
      expect(fake.paths().filter((path) => path === '/api/v1/commits')).toHaveLength(3)
    })

    it('shows in the file the same first push as on each person\'s own page', async () => {
      stubIntersectionObserver()
      vi.stubGlobal('scrollTo', vi.fn())
      const { view } = await openRegister()
      await within(screen.getByRole('table')).findByText('3h 19m')
      const { grid } = await download()
      const inFile = new Map(grid('Results').slice(1).map((line) => [line[2] as string, line[7] as string]))
      view.unmount()

      const { PersonView } = await import('./PersonView.tsx')
      const firstPushOnPage = async (rowId: string) => {
        const page = render(<PersonView rowId={rowId} />)
        const term = await screen.findByText('First push')
        await waitFor(() => expect(term.nextElementSibling?.textContent).not.toBe('…'))
        const value = term.nextElementSibling?.textContent ?? ''
        const byCommit = screen.queryByText('Date of the first commit. The push time is not known.') !== null
        page.unmount()
        return byCommit ? `${value} (commit date)` : value
      }
      expect(inFile.get('Rahim Uddin')).toBe(await firstPushOnPage('r2'))
      expect(inFile.get('Nusrat Jahan')).toBe(await firstPushOnPage('r3'))
      expect(inFile.get('Salma Akter')).toBe(await firstPushOnPage('r4'))
      expect([...inFile.values()].every((text) => /^\d\d \w{3} \d{4}, \d\d:\d\d/.test(text))).toBe(true)
    })
  })
})
