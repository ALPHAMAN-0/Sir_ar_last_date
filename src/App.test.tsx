// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { okRepo, saveSheet, stubApi, type RowCells } from './test/fakeApi.ts'

const SHEET: RowCells[] = [
  ['22-46001-1', 'Rahim Uddin', 'https://github.com/octocat/hello-world'],
  ['22-46002-1', 'Nusrat Jahan', 'github.com/octocat/spoon-knife'],
]

/** A fresh store and App for each test, opened at `hash`. */
async function openApp(hash = '') {
  history.replaceState(null, '', `/${hash}`)
  vi.resetModules()
  const store = await import('./state/store.ts')
  const { default: App } = await import('./App.tsx')
  store.start()
  render(<App />)
  return store
}

const tabs = () => screen.queryByRole('navigation', { name: 'Tabs' })

beforeEach(() => {
  stubApi({
    repos: {
      'octocat/hello-world': okRepo('octocat/hello-world'),
      'octocat/spoon-knife': okRepo('octocat/spoon-knife'),
    },
    commits: { 'octocat/hello-world': [], 'octocat/spoon-knife': [] },
    trees: { 'octocat/hello-world': [], 'octocat/spoon-knife': [] },
  })
  // jsdom implements neither of these.
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw new Error('No workers in this test')
      }
    },
  )
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('before a sheet is loaded', () => {
  it('shows the upload panel and no tabs', async () => {
    await openApp()
    expect(screen.getByRole('heading', { name: 'Put your sheet on the desk' })).toBeTruthy()
    expect(tabs()).toBeNull()
  })

  it('shows the upload panel whatever the hash says', async () => {
    await openApp('#/s')
    expect(screen.getByRole('heading', { name: 'Put your sheet on the desk' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Similarity report' })).toBeNull()
  })
})

describe('with a sheet', () => {
  beforeEach(() => saveSheet(SHEET))

  it('shows the register at #/, with both tabs', async () => {
    await openApp('#/')
    expect(screen.getByText('class-7.xlsx')).toBeTruthy()
    const table = await screen.findByRole('table')
    expect(await within(table).findAllByText('Has work')).toHaveLength(2)
    expect(screen.queryByRole('heading', { name: 'Put your sheet on the desk' })).toBeNull()

    expect(tabs()).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Register' }).getAttribute('href')).toBe('#/')
    expect(screen.getByRole('link', { name: 'Similarity' }).getAttribute('href')).toBe('#/s')
  })

  it('opens the person of sheet row 2 at #/p/r2', async () => {
    await openApp('#/p/r2')
    expect(screen.getByRole('heading', { level: 1, name: 'Rahim Uddin' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '← Back to the register' })).toBeTruthy()
    // Wait for the commit list, so nothing is still loading when the test ends.
    await waitFor(() => expect(screen.queryByText('Loading the commits.')).toBeNull())
    expect(tabs()).not.toBeNull()
  })

  it('opens the similarity tab at #/s', async () => {
    await openApp('#/s')
    expect(screen.getByRole('heading', { name: 'Similarity report' })).toBeTruthy()
    expect(
      await screen.findByText('No two different repos in this sheet hold a file with the same content.'),
    ).toBeTruthy()
  })

  it('follows the hash as it changes', async () => {
    await openApp('#/')
    await within(await screen.findByRole('table')).findAllByText('Has work')

    window.location.hash = '#/p/r3'
    expect(await screen.findByRole('heading', { level: 1, name: 'Nusrat Jahan' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Loading the commits.')).toBeNull())

    window.location.hash = '#/s'
    expect(await screen.findByRole('heading', { name: 'Similarity report' })).toBeTruthy()
    await screen.findByText('No two different repos in this sheet hold a file with the same content.')

    window.location.hash = '#/'
    expect(await screen.findByText('class-7.xlsx')).toBeTruthy()
  })

  it('goes back to the upload panel when the sheet is removed', async () => {
    await openApp('#/')
    await within(await screen.findByRole('table')).findAllByText('Has work')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }))
    expect(screen.getByRole('heading', { name: 'Put your sheet on the desk' })).toBeTruthy()
    expect(tabs()).toBeNull()
  })
})
