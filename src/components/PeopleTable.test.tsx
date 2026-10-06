// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RepoMeta } from '../../shared/api.ts'
import { formatDateTimeShort } from '../logic/time.ts'
import { parseRepoLink } from '../sheet/parseRepoLink.ts'
import { judgeRows, type Sheet, type Sort } from '../state/store.ts'
import { okRepo, type RowCells } from '../test/fakeApi.ts'
import { PeopleTable } from './PeopleTable.tsx'

const BY_ROW: Sort = { column: 'row', descending: false }

/** Judged rows, exactly as the register hands them to the table. The first person is on row 2. */
function people(cells: RowCells[], repos: Record<string, RepoMeta>) {
  const sheet: Sheet = {
    fileName: 'class-7.xlsx',
    sheetName: 'Sheet1',
    truncated: false,
    rows: cells.map(([id, name, rawLink], index) => ({
      rowId: `r${index + 2}`,
      rowNumber: index + 2,
      id,
      name,
      rawLink,
      link: parseRepoLink(rawLink),
    })),
  }
  return judgeRows(sheet, new Map(Object.entries(repos)), new Map(), null)
}

const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement
const cell = (row: HTMLElement, label: string) => row.querySelector(`[data-label="${label}"]`) as HTMLElement

afterEach(() => {
  cleanup()
  history.replaceState(null, '', '/')
})

describe('PeopleTable', () => {
  it('shows each person with their repo, status, dates and commits', () => {
    const meta = okRepo('octocat/hello-world', { nameWithOwner: 'octocat/Hello-World', totalCommits: 7 })
    render(
      <PeopleTable
        people={people([['22-46001-1', 'Rahim Uddin', 'https://github.com/octocat/hello-world']], {
          'octocat/hello-world': meta,
        })}
        sort={BY_ROW}
        deadlinePassed={false}
      />,
    )
    const row = rowOf('Rahim Uddin')
    expect(cell(row, 'Row').textContent).toBe('2')
    expect(cell(row, 'ID').textContent).toBe('22-46001-1')
    expect(screen.getByRole('link', { name: 'Rahim Uddin' }).getAttribute('href')).toBe('#/p/r2')

    // Shown as GitHub spells it, linked by the checked lowercase name.
    const repo = within(row).getByRole('link', { name: 'octocat/Hello-World' })
    expect(repo.getAttribute('href')).toBe('https://github.com/octocat/hello-world')
    expect(repo.getAttribute('target')).toBe('_blank')
    expect(repo.getAttribute('rel')).toBe('noopener noreferrer')

    expect(cell(row, 'Status').textContent).toBe('Has work')
    expect(cell(row, 'Last push').textContent).toBe(formatDateTimeShort(meta.pushedAt))
    expect(cell(row, 'Commits').textContent).toBe('7')
  })

  it('shows a cell that is not a repo link as written, with the reason', () => {
    render(
      <PeopleTable
        people={people([['22-46003-1', 'Tanvir Ahmed', 'gitlab.com/tanvir/task-1']], {})}
        sort={BY_ROW}
        deadlinePassed
      />,
    )
    const row = rowOf('Tanvir Ahmed')
    expect(within(cell(row, 'Repo')).queryByRole('link')).toBeNull()
    expect(cell(row, 'Repo').textContent).toBe('gitlab.com/tanvir/task-1')
    expect(within(cell(row, 'Status')).getByText('Invalid link')).toBeTruthy()
    expect(within(cell(row, 'Status')).getByText('Not a GitHub link')).toBeTruthy()
  })

  it('points out rows that share a repo, and a repo that was renamed', () => {
    const renamed = okRepo('octocat/old-name', { nameWithOwner: 'octocat/new-name' })
    render(
      <PeopleTable
        people={people(
          [
            ['1', 'Rahim Uddin', 'github.com/octocat/old-name'],
            ['2', 'Karim Hasan', 'https://github.com/octocat/old-name.git'],
          ],
          { 'octocat/old-name': renamed },
        )}
        sort={BY_ROW}
        deadlinePassed={false}
      />,
    )
    const notes = within(rowOf('Karim Hasan')).getByText(/Same repo as another row/)
    expect(notes.textContent).toBe('Same repo as another row · Repo was renamed or moved')
    expect(within(rowOf('Karim Hasan')).getByRole('link', { name: 'octocat/new-name' }).getAttribute('href')).toBe(
      'https://github.com/octocat/new-name',
    )
  })

  it('leaves the push and commit columns blank for an empty repo', () => {
    const empty = okRepo('octocat/empty', { isEmpty: true, headOid: null, totalCommits: 0 })
    render(
      <PeopleTable
        people={people([['5', 'Arif Hossain', 'github.com/octocat/empty']], { 'octocat/empty': empty })}
        sort={BY_ROW}
        deadlinePassed={false}
      />,
    )
    const row = rowOf('Arif Hossain')
    // Before the deadline the wording is softer.
    expect(cell(row, 'Status').textContent).toBe('Nothing yet')
    expect(cell(row, 'Last push').textContent).toBe('')
    expect(cell(row, 'Commits').textContent).toBe('')
  })

  it('marks only the sorted column, with its direction', () => {
    render(
      <PeopleTable
        people={people([['1', 'Rahim Uddin', 'x']], {})}
        sort={{ column: 'commits', descending: true }}
        deadlinePassed={false}
      />,
    )
    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((header) => header.getAttribute('aria-sort'))).toEqual([
      'none', 'none', 'none', 'none', 'none', 'none', 'none', 'none', 'none', 'descending',
    ])
  })

  it('opens the person when anywhere on the row is clicked', () => {
    render(
      <PeopleTable
        people={people(
          [
            ['1', 'Rahim Uddin', 'x'],
            ['2', 'Nusrat Jahan', 'y'],
          ],
          {},
        )}
        sort={BY_ROW}
        deadlinePassed={false}
      />,
    )
    fireEvent.click(cell(rowOf('Nusrat Jahan'), 'ID'))
    expect(window.location.hash).toBe('#/p/r3')
  })

  it('lets a link inside the row do its own job', () => {
    render(
      <PeopleTable
        people={people([['1', 'Rahim Uddin', 'github.com/octocat/hello-world']], {})}
        sort={BY_ROW}
        deadlinePassed={false}
      />,
    )
    const repo = screen.getByRole('link', { name: 'octocat/hello-world' })
    // jsdom cannot open a new tab, so the link's own navigation is stopped here.
    repo.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(repo)
    expect(window.location.hash).toBe('')
  })
})
