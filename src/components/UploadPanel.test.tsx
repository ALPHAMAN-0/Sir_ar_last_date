// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { okRepo, stubApi } from '../test/fakeApi.ts'

const CSV = 'id,name,repolink\n22-46001-1,Rahim Uddin,https://github.com/rahim/task-1\n'

async function setup() {
  vi.resetModules()
  const store = await import('../state/store.ts')
  const { UploadPanel } = await import('./UploadPanel.tsx')
  render(<UploadPanel />)
  return store
}

const fileInput = () => screen.getByLabelText('Choose an Excel or CSV file') as HTMLInputElement
const choose = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } })
const csvFile = (text = CSV, name = 'class-7.csv') => new File([text], name, { type: 'text/csv' })

beforeEach(() => {
  stubApi({ repos: { 'rahim/task-1': okRepo('rahim/task-1') } })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('UploadPanel', () => {
  it('reads the chosen file into the store', async () => {
    const store = await setup()
    choose(csvFile())
    await waitFor(() => expect(store.getState().sheet?.fileName).toBe('class-7.csv'))
    expect(store.getState().sheet?.rows.map((row) => row.name)).toEqual(['Rahim Uddin'])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says it is reading while the file is read', async () => {
    await setup()
    choose(csvFile())
    const busy = screen.getByRole('button', { name: 'Reading the sheet' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect(await screen.findByRole('button', { name: 'Choose a file' })).toBeTruthy()
  })

  it('opens the file dialog from the "Choose a file" button', async () => {
    await setup()
    const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }))
    expect(click).toHaveBeenCalledOnce()
  })

  it('accepts only Excel and CSV files', async () => {
    await setup()
    expect(fileInput().accept).toBe('.xlsx,.xls,.csv')
  })

  it('reads a file dropped on it', async () => {
    const store = await setup()
    const zone = screen.getByRole('heading', { name: 'Put your sheet on the desk' }).parentElement as HTMLElement
    fireEvent.dragOver(zone)
    fireEvent.drop(zone, { dataTransfer: { files: [csvFile()] } })
    await waitFor(() => expect(store.getState().sheet?.fileName).toBe('class-7.csv'))
  })

  it('shows the error for a file that is too big, without reading it', async () => {
    const store = await setup()
    choose(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.xlsx'))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This file is larger than 5 MB. Please upload a smaller sheet.',
    )
    expect(store.getState().sheet).toBeNull()
  })

  it('shows the error for a sheet with nothing in it', async () => {
    await setup()
    choose(csvFile(',,\n,,\n', 'blank.csv'))
    expect((await screen.findByRole('alert')).textContent).toBe('This sheet is empty.')
  })

  it('clears the error once a good file is read', async () => {
    const store = await setup()
    choose(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.xlsx'))
    await screen.findByRole('alert')
    choose(csvFile())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(store.getState().sheet?.fileName).toBe('class-7.csv')
  })

  it('shows the Single check panel on the home page', async () => {
    await setup()
    // The <summary> text inside the Single check <details> block.
    expect(screen.getByText('Single check')).toBeTruthy()
    // The repo-link input the user pastes a link into.
    expect(screen.getByPlaceholderText(/github\.com/)).toBeTruthy()
  })

  it('runs a Single check from the home page', async () => {
    await setup()
    const linkInput = screen.getByPlaceholderText(/github\.com/) as HTMLInputElement
    fireEvent.change(linkInput, { target: { value: 'rahim/task-1' } })
    const form = screen.getByRole('button', { name: /^check$/i }).closest('form')
    if (!form) throw new Error('expected a form around the Check button')
    fireEvent.submit(form)

    await waitFor(() => {
      // The repo's name shows up as a link to GitHub.
      const link = screen.getByRole('link', { name: /rahim\/task-1/ })
      expect(link.getAttribute('href')).toBe('https://github.com/rahim/task-1')
    })
  })
})
