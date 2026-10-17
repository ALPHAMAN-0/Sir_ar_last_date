// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const PROJECT = 'Project base'
const LAB = 'Lab / Performance base'
const card = (name: string) => screen.getByRole('region', { name })
const fileInput = (name = PROJECT) => within(card(name)).getByLabelText(`Choose a ${name} sheet`) as HTMLInputElement
const choose = (file: File, name = PROJECT) => fireEvent.change(fileInput(name), { target: { files: [file] } })
const csvFile = (text = CSV, name = 'class-7.csv') => new File([text], name, { type: 'text/csv' })

beforeEach(() => {
  stubApi({ repos: { 'rahim/task-1': okRepo('rahim/task-1') } })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.doUnmock('../sheet/exportXlsx.ts')
})

describe('UploadPanel', () => {
  it('offers two uploads, each saying what its sheet and repos look like', async () => {
    await setup()
    expect(within(card(PROJECT)).getByText(/one repo per student and one deadline/i)).toBeTruthy()
    expect(within(card(LAB)).getByText(/Mid folder and a Final folder/)).toBeTruthy()
    for (const name of [PROJECT, LAB]) {
      expect(within(card(name)).getByRole('button', { name: 'Choose a file' })).toBeTruthy()
      expect(within(card(name)).getByRole('button', { name: 'Download a sample sheet' })).toBeTruthy()
    }
  })

  it('reads a file chosen on the project card as a project sheet', async () => {
    const store = await setup()
    choose(csvFile())
    await waitFor(() => expect(store.getState().sheet?.fileName).toBe('class-7.csv'))
    expect(store.getState().sheet?.kind).toBe('project')
    expect(store.getState().sheet?.rows.map((row) => row.name)).toEqual(['Rahim Uddin'])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reads a file chosen on the lab card as a lab sheet, even when it looks like a project sheet', async () => {
    const store = await setup()
    choose(csvFile(), LAB)
    await waitFor(() => expect(store.getState().sheet?.kind).toBe('lab'))
  })

  it('says which card is reading while the file is read, and holds both', async () => {
    await setup()
    choose(csvFile(), LAB)
    const busy = within(card(LAB)).getByRole('button', { name: 'Reading the sheet' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect((within(card(PROJECT)).getByRole('button', { name: 'Choose a file' }) as HTMLButtonElement).disabled).toBe(true)
    expect(await within(card(LAB)).findByRole('button', { name: 'Choose a file' })).toBeTruthy()
  })

  it('opens the file dialog of its own card', async () => {
    await setup()
    const project = vi.spyOn(fileInput(PROJECT), 'click').mockImplementation(() => {})
    const lab = vi.spyOn(fileInput(LAB), 'click').mockImplementation(() => {})
    fireEvent.click(within(card(LAB)).getByRole('button', { name: 'Choose a file' }))
    expect(lab).toHaveBeenCalledOnce()
    expect(project).not.toHaveBeenCalled()
  })

  it('accepts only Excel and CSV files', async () => {
    await setup()
    expect(fileInput(PROJECT).accept).toBe('.xlsx,.xls,.csv')
    expect(fileInput(LAB).accept).toBe('.xlsx,.xls,.csv')
  })

  it('reads a file dropped on a card as that kind', async () => {
    const store = await setup()
    fireEvent.dragOver(card(LAB))
    expect(card(LAB).className).toContain('upload-card--over')
    fireEvent.drop(card(LAB), { dataTransfer: { files: [csvFile()] } })
    await waitFor(() => expect(store.getState().sheet?.fileName).toBe('class-7.csv'))
    expect(store.getState().sheet?.kind).toBe('lab')
  })

  it('downloads the sample of its own kind', async () => {
    const downloadSample = vi.fn()
    vi.doMock('../sheet/exportXlsx.ts', () => ({ downloadSample }))
    await setup()
    fireEvent.click(within(card(LAB)).getByRole('button', { name: 'Download a sample sheet' }))
    await waitFor(() => expect(downloadSample).toHaveBeenCalledWith('lab'))
    fireEvent.click(within(card(PROJECT)).getByRole('button', { name: 'Download a sample sheet' }))
    await waitFor(() => expect(downloadSample).toHaveBeenCalledWith('project'))
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
    expect(screen.getByText('Single check')).toBeTruthy()
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
      const link = screen.getByRole('link', { name: /rahim\/task-1/ })
      expect(link.getAttribute('href')).toBe('https://github.com/rahim/task-1')
    })
  })
})
