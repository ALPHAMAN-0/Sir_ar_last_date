// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { ZERO_OID } from '../../shared/validate.ts'
import { formatDateTime, formatDuration, parseDeadlineInput } from '../logic/time.ts'
import {
  FETCHED_AT,
  okRepo,
  oid,
  saveSheet,
  STORAGE_KEY,
  stubApi,
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

  beforeEach(() => {
    saveSheet(
      [
        ['22-46001-1', 'Rahim Uddin', 'github.com/octocat/hello-world'],
        ['22-46002-1', 'Nusrat Jahan', 'github.com/octocat/spoon-knife'],
        ['22-46005-1', 'Salma Akter', 'github.com/salma/late-start'],
      ],
      { deadlineInput: INPUT },
    )
    stubApi({
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
})
