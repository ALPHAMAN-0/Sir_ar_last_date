// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { okRepo, stubApi } from '../test/fakeApi.ts'

// The links were put in the wrong column: "Repo" says when they will come,
// "Final link" holds them.
const CSV = [
  'ID,Name,Repo,Final link',
  '22-46001-1,Rahim Uddin,will send later,github.com/rahim/task-1',
  '22-46002-1,Nusrat Jahan,on monday,https://github.com/nusrat/task-1',
].join('\n')

/** A fresh store holding the CSV above, read the same way an upload is. */
async function loadSheet() {
  vi.resetModules()
  const store = await import('../state/store.ts')
  await store.loadFile(new File([CSV], 'class-7.csv', { type: 'text/csv' }))
  return store
}

const select = (label: string) => screen.getByRole('combobox', { name: label }) as HTMLSelectElement
const choose = (label: string, optionText: string) => {
  const option = within(select(label)).getByRole('option', { name: optionText }) as HTMLOptionElement
  fireEvent.change(select(label), { target: { value: option.value } })
}

beforeEach(() => {
  stubApi({
    repos: { 'rahim/task-1': okRepo('rahim/task-1'), 'nusrat/task-1': okRepo('nusrat/task-1') },
  })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('ColumnPicker', () => {
  it('starts from the columns the page guessed, by letter and header', async () => {
    const store = await loadSheet()
    const { ColumnPicker } = await import('./ColumnPicker.tsx')
    render(<ColumnPicker onDone={vi.fn()} />)

    expect(within(select('Repo link')).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Not in the sheet',
      'A: ID',
      'B: Name',
      'C: Repo',
      'D: Final link',
    ])
    expect(select('ID').selectedOptions[0].textContent).toBe('A: ID')
    expect(select('Name').selectedOptions[0].textContent).toBe('B: Name')
    expect(select('Repo link').selectedOptions[0].textContent).toBe('C: Repo')
    expect(store.getState().sheet?.rows.every((row) => !row.link.ok)).toBe(true)
  })

  it('reads the sheet again with the chosen columns', async () => {
    const store = await loadSheet()
    const { ColumnPicker } = await import('./ColumnPicker.tsx')
    const onDone = vi.fn()
    render(<ColumnPicker onDone={onDone} />)

    choose('Repo link', 'D: Final link')
    choose('ID', 'Not in the sheet')
    fireEvent.click(screen.getByRole('button', { name: 'Use these columns' }))

    expect(onDone).toHaveBeenCalledOnce()
    const rows = store.getState().sheet?.rows ?? []
    expect(rows.map((row) => [row.id, row.name, row.rawLink])).toEqual([
      ['', 'Rahim Uddin', 'github.com/rahim/task-1'],
      ['', 'Nusrat Jahan', 'https://github.com/nusrat/task-1'],
    ])
    expect(rows.every((row) => row.link.ok)).toBe(true)
  })

  it('changes nothing on Cancel', async () => {
    const store = await loadSheet()
    const { ColumnPicker } = await import('./ColumnPicker.tsx')
    const onDone = vi.fn()
    render(<ColumnPicker onDone={onDone} />)
    const sheet = store.getState().sheet

    choose('Repo link', 'D: Final link')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onDone).toHaveBeenCalledOnce()
    expect(store.getState().sheet).toBe(sheet)
  })

  it('is offered by the register when no links were found, and fixes the table', async () => {
    const store = await loadSheet()
    const { Register } = await import('./Register.tsx')
    render(<Register />)

    expect(
      screen.getByText('No GitHub repo links were found in this sheet. Choose the column that holds them.'),
    ).toBeTruthy()
    expect(within(screen.getByRole('table')).getAllByText('Invalid link')).toHaveLength(2)

    choose('Repo link', 'D: Final link')
    fireEvent.click(screen.getByRole('button', { name: 'Use these columns' }))

    expect(screen.queryByText(/No GitHub repo links were found/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use these columns' })).toBeNull()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('link', { name: 'rahim/task-1' })).toBeTruthy()
    await waitFor(() => expect(within(table).getAllByText('Has work')).toHaveLength(2))
    expect(store.getState().sheet?.fileName).toBe('class-7.csv')
  })
})
