// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreeFile } from '../../shared/api.ts'
import { analyse } from '../similarity/compare.ts'
import type { CompareRequest } from '../similarity/compare.worker.ts'
import { failure, okRepo, oid, saveSheet, stubApi, type RowCells } from '../test/fakeApi.ts'

/** A file whose content hash is the same wherever `content` is the same. */
const file = (path: string, content: string, size: number): TreeFile => ({ path, sha: oid(content), size })
const STARTER_PAGE = file('index.html', 'the page every repo was given', 1200)

const TREES: Record<string, TreeFile[]> = {
  'a/x': [
    file('src/app.js', 'the app', 2000),
    file('src/view.js', 'the view', 1500),
    file('README.md', 'rahim readme', 900),
    STARTER_PAGE,
    file('node_modules/lib/index.js', 'a library', 5000),
    file('logo.png', 'a logo', 3000),
  ],
  // Two of Rahim's files, renamed or not, plus one of its own.
  'b/y': [
    file('src/app.js', 'the app', 2000),
    file('lib/screen.js', 'the view', 1500),
    file('src/extra.js', 'karim extra', 800),
    STARTER_PAGE,
  ],
  'c/z': [file('main.py', 'salma main', 3000), file('util.py', 'salma util', 700), STARTER_PAGE],
}

const SHEET: RowCells[] = [
  ['22-46001-1', 'Rahim Uddin', 'github.com/a/x'],
  ['22-46002-1', 'Karim Hasan', 'github.com/b/y'],
  ['22-46003-1', 'Salma Akter', 'github.com/c/z'],
  ['22-46004-1', 'Nusrat Jahan', 'https://github.com/a/x'],
  ['22-46005-1', 'Tanvir Ahmed', 'gitlab.com/tanvir/x'],
  ['22-46006-1', 'Arif Hossain', 'github.com/ghost/missing'],
]

/** What the page asked the comparison worker, in order. */
let asked: Array<{ url: string; options: unknown; request: CompareRequest }>
let fake: ReturnType<typeof stubApi>

/** Stands in for compare.worker.ts: the same comparison, answered a moment later. */
class FakeWorker extends EventTarget {
  url: string
  options: unknown
  constructor(url: URL, options: unknown) {
    super()
    this.url = String(url)
    this.options = options
  }
  postMessage(request: CompareRequest) {
    asked.push({ url: this.url, options: this.options, request })
    const analysis = analyse(request.repos, { commonLimit: request.commonLimit })
    setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: analysis })))
  }
  terminate() {}
}

beforeEach(() => {
  asked = []
  saveSheet(SHEET)
  fake = stubApi({
    repos: { 'a/x': okRepo('a/x'), 'b/y': okRepo('b/y'), 'c/z': okRepo('c/z') },
    trees: { ...TREES },
  })
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

async function openSimilarity() {
  vi.resetModules()
  const store = await import('../state/store.ts')
  const { SimilarityView } = await import('./SimilarityView.tsx')
  store.start()
  render(<SimilarityView />)
}

const summaryLine = () => screen.findByText(/compared, which makes/)
const pairRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
/** A pair row as [repo A, repo B, match, identical, of A, of B]. A same-repo row has no second link. */
const pairLine = (row: HTMLElement) => {
  const [a, b, ...numbers] = within(row).getAllByRole('cell')
  return [
    within(a).getByRole('link').textContent,
    within(b).queryByRole('link')?.textContent ?? b.textContent,
    ...numbers.slice(0, 4).map((cell) => cell.textContent),
  ]
}
const ALL_PAIRS =
  '4 matches found: 1 repo handed in by more than one person (100%) and 3 pairs of different repos with ' +
  'identical files. 3 repos compared, which makes 3 pairs.'
/** The text of each part of a list item, e.g. [path, size]. */
const parts = (item: HTMLElement) => [...item.children].map((child) => child.textContent)

describe('SimilarityView', () => {
  it('waits for the register to finish checking before reading file lists', async () => {
    await openSimilarity()
    // Five rows have a repo link; the register has not checked any of them yet.
    expect(screen.getByText('Waiting for the register to finish checking 5 rows.')).toBeTruthy()
    await summaryLine()
    expect(screen.queryByText(/Waiting for the register/)).toBeNull()
  })

  it('compares the repos in a worker and lists the pairs, strongest first', async () => {
    await openSimilarity()
    expect((await summaryLine()).closest('p')?.textContent).toBe(ALL_PAIRS)
    expect(pairRows().map(pairLine)).toEqual([
      ['a/x', 'Same repo handed in by 2 people', '100% Same repo', '4 files', '4 of 4 · 100%', '4 of 4 · 100%'],
      ['a/x', 'b/y', '75% Mostly identical', '3 files', '3 of 4 · 75%', '3 of 4 · 75%'],
      ['a/x', 'c/z', '33% Partly identical', '1 file', '1 of 4 · 25%', '1 of 3 · 33%'],
      ['b/y', 'c/z', '33% Partly identical', '1 file', '1 of 4 · 25%', '1 of 3 · 33%'],
    ])
    const pair = pairRows()[1]
    expect(within(pair).getByText('22-46001-1 · Rahim Uddin, 22-46004-1 · Nusrat Jahan')).toBeTruthy()
    expect(within(pair).getByText('22-46002-1 · Karim Hasan')).toBeTruthy()
    expect(within(pair).getByRole('link', { name: 'a/x' }).getAttribute('href')).toBe('https://github.com/a/x')

    expect(asked).toHaveLength(1)
    expect(new URL(asked[0].url).pathname).toBe('/src/similarity/compare.worker.ts')
    expect(asked[0].options).toEqual({ type: 'module' })
    expect(asked[0].request.repos.map((repo) => repo.repo)).toEqual(['a/x', 'b/y', 'c/z'])
    // Only the files worth comparing travel to the worker.
    expect(asked[0].request.repos[0].files.map((entry) => entry.path)).toEqual([
      'README.md',
      'index.html',
      'src/app.js',
      'src/view.js',
    ])
  })

  it('names a repo handed in by more than one person', async () => {
    await openSimilarity()
    await summaryLine()
    const note = screen.getByRole('note')
    expect(within(note).getByText('1 repo was handed in by more than one person.')).toBeTruthy()
    expect(within(note).getByRole('listitem').textContent).toBe(
      'a/x: 22-46001-1 · Rahim Uddin, 22-46004-1 · Nusrat Jahan',
    )
  })

  it('opens a repo handed in by several people to show who and which files', async () => {
    await openSimilarity()
    await summaryLine()
    fireEvent.click(within(pairRows()[0]).getByRole('button', { name: 'Show files' }))
    const people = screen.getByRole('heading', { name: 'Handed in by (2)' }).parentElement as HTMLElement
    expect(within(people).getAllByRole('listitem').map(parts)).toEqual([
      ['22-46001-1 · Rahim Uddin', 'row 2'],
      ['22-46004-1 · Nusrat Jahan', 'row 5'],
    ])
    const files = screen.getByRole('heading', { name: 'Files, the same for all of them (4)' }).parentElement as HTMLElement
    expect(within(files).getAllByRole('listitem').map((item) => item.children[0].textContent)).toEqual([
      'README.md',
      'index.html',
      'src/app.js',
      'src/view.js',
    ])
  })

  it('accounts for every row that could not be compared', async () => {
    await openSimilarity()
    await summaryLine()
    const fold = screen.getByText('Not compared (2)').closest('details') as HTMLElement
    expect(within(fold).getAllByRole('listitem').map(parts)).toEqual([
      ['22-46005-1 · Tanvir Ahmed', 'Not a GitHub link'],
      ['22-46006-1 · Arif Hossain', 'Repo not found (private, deleted or mistyped)'],
    ])
  })

  it('opens a pair to show its identical files and what was left out', async () => {
    await openSimilarity()
    await summaryLine()
    const toggle = within(pairRows()[1]).getByRole('button', { name: 'Show files' })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    const identical = screen.getByRole('heading', { name: 'Identical content (3)' }).parentElement as HTMLElement
    // Largest first; a renamed copy shows both paths.
    expect(within(identical).getAllByRole('listitem').map(parts)).toEqual([
      ['src/app.js', '2.0 KB'],
      ['src/view.js = lib/screen.js', '1.5 KB'],
      ['index.html', '1.2 KB'],
    ])
    const rest = Object.fromEntries(
      screen.getAllByRole('term').map((term) => [term.textContent, term.nextElementSibling?.textContent]),
    )
    expect(rest).toEqual({
      'Only in A (22-46001-1 · Rahim Uddin +1 more)': '1 file',
      'Only in B (22-46002-1 · Karim Hasan)': '1 file',
      'Starter files both have': 'none',
      'Left out of A': '1 in third-party or build folders, 1 pictures, fonts and compiled files',
      'Left out of B': 'nothing',
    })

    fireEvent.click(within(pairRows()[1]).getByRole('button', { name: 'Hide files' }))
    expect(screen.queryByRole('heading', { name: /Identical content/ })).toBeNull()
  })

  it('stops counting a file once more repos have it than the chosen limit', async () => {
    await openSimilarity()
    await summaryLine()
    const limit = screen.getByRole('combobox', { name: 'Starter files' }) as HTMLSelectElement
    // With three repos, 3 is the most there is: every file counts.
    expect(within(limit).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '2',
      '3: count every file',
    ])
    expect(limit.value).toBe('3')
    expect(screen.getByText(/No file is left out this way/)).toBeTruthy()

    fireEvent.change(limit, { target: { value: '2' } })
    expect(await screen.findByText(/1 file is left out this way/)).toBeTruthy()
    expect((await summaryLine()).closest('p')?.textContent).toBe(
      '2 matches found: 1 repo handed in by more than one person (100%) and 1 pair of different repos with ' +
        'identical files. 3 repos compared, which makes 3 pairs.',
    )
    expect(asked.map((entry) => entry.request.commonLimit)).toEqual([3, 2])

    const starter = screen.getByText('Starter files that are not counted (1)').closest('details') as HTMLElement
    expect(parts(within(starter).getByRole('listitem'))).toEqual(['index.html', 'in 3 repos · 1.2 KB'])
  })

  it('still compares when the browser cannot start a worker', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('Workers are blocked')
        }
      },
    )
    await openSimilarity()
    expect((await summaryLine()).closest('p')?.textContent).toBe(ALL_PAIRS)
  })

  it('says why a file list could not be loaded, and tries again on request', async () => {
    fake.api.trees['c/z'] = failure(404, 'not_found', 'Not found.')
    await openSimilarity()
    expect((await summaryLine()).closest('p')?.textContent).toBe(
      '2 matches found: 1 repo handed in by more than one person (100%) and 1 pair of different repos with ' +
        'identical files. 2 repos compared, which makes 1 pair.',
    )
    const fold = screen.getByText('Not compared (3)').closest('details') as HTMLElement
    expect(within(fold).getByText('GitHub no longer shows this repo. It may be private or deleted now.')).toBeTruthy()

    fake.api.trees['c/z'] = TREES['c/z']
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(async () =>
      expect((await summaryLine()).closest('p')?.textContent).toBe(ALL_PAIRS),
    )
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('says when there is nothing to compare', async () => {
    saveSheet([['22-46005-1', 'Tanvir Ahmed', 'gitlab.com/tanvir/x']])
    await openSimilarity()
    expect(
      screen.getByText('There is nothing to compare: no row of this sheet leads to a repo with files.'),
    ).toBeTruthy()
    expect(asked).toEqual([])
  })
})
