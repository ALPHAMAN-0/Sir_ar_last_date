// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import type { TreeFile } from '../../shared/api.ts'
import type { CodeRequest } from '../similarity/code.worker.ts'
import { analyse } from '../similarity/compare.ts'
import type { CompareRequest } from '../similarity/compare.worker.ts'
import { analyseCode } from '../similarity/sharedCode.ts'
import { failure, okRepo, oid, saveSheet, stubApi, type RowCells } from '../test/fakeApi.ts'

/** `count` lines of made-up code, all different. `name` makes another person's code. */
const program = (count: number, name = 'total') =>
  Array.from({ length: count }, (_, i) => `let ${name}${i} = compute(${i}, "${name} item ${i}") + offset * ${i + 3};`).join('\n')

/** Rahim's form script, and Karim's copy of it: spaces, case, a comment and every tenth line changed. */
const ORIGINAL = program(40)
const EDITED = `// my work\n${ORIGINAL.split('\n')
  .map((line, i) => (i % 10 === 9 ? `console.log("mine ${i}")` : line.toUpperCase()))
  .join('\r\n')}`
const SALMA = program(40, 'salma')

let texts: Record<string, string>
/** A file whose content hash is the hash of its text. */
function file(path: string, text: string): TreeFile {
  texts[oid(text)] = text
  return { path, sha: oid(text), size: text.length }
}

const SHEET: RowCells[] = [
  ['22-46001-1', 'Rahim Uddin', 'github.com/a/x'],
  ['22-46002-1', 'Karim Hasan', 'github.com/b/y'],
  ['22-46003-1', 'Salma Akter', 'github.com/c/z'],
]

let asked: CompareRequest[]
let askedCode: CodeRequest[]
let fake: ReturnType<typeof stubApi>

/** Stands in for compare.worker.ts and code.worker.ts: the same work, answered a moment later. */
class FakeWorker extends EventTarget {
  url: string
  constructor(url: URL) {
    super()
    this.url = String(url)
  }
  postMessage(request: CompareRequest | CodeRequest) {
    let data: unknown
    if (this.url.includes('code.worker')) {
      askedCode.push(request as CodeRequest)
      data = analyseCode((request as CodeRequest).repos, { commonLimit: request.commonLimit ?? 4 })
    } else {
      asked.push(request as CompareRequest)
      data = analyse((request as CompareRequest).repos, { commonLimit: request.commonLimit })
    }
    setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data })))
  }
  terminate() {}
}

beforeEach(() => {
  asked = []
  askedCode = []
  texts = {}
  saveSheet(SHEET)
  const trees = {
    'a/x': [file('lab/form.js', ORIGINAL), file('README.md', 'Rahim lab notes, never read')],
    'b/y': [file('task/main.js', EDITED)],
    'c/z': [file('own.js', SALMA)],
  }
  fake = stubApi({
    repos: { 'a/x': okRepo('a/x'), 'b/y': okRepo('b/y'), 'c/z': okRepo('c/z') },
    trees,
    texts,
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

const section = () => screen.getByRole('region', { name: 'Shared code' })
/** Waits for the section: it shows once the file lists have loaded. */
const loadedSection = () => screen.findByRole('region', { name: 'Shared code' })
const codeRows = () => within(within(section()).getByRole('table')).getAllByRole('row').slice(1)
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent)

describe('SharedCode', () => {
  it('finds an edited copy that no identical file gives away', async () => {
    await openSimilarity()
    // The identical-file check finds nothing: every file differs.
    expect(await screen.findByText('No two different repos in this sheet hold a file with the same content.')).toBeTruthy()

    await within(section()).findByText(/of repos share code/)
    const rows = codeRows()
    expect(rows).toHaveLength(1)
    const [a, b, match, ofA, ofB] = cells(rows[0])
    expect(a).toContain('Rahim Uddin')
    expect(b).toContain('Karim Hasan')
    expect(match).toMatch(/^\d+% Almost all code shared$/)
    expect(ofA).toMatch(/^\d+ of 40 · \d+%$/)
    expect(ofB).toMatch(/^\d+ of \d+ · \d+%$/)

    // The README is never asked for: prose is not compared.
    const asks = fake.fetch.mock.calls.map(([input]) => String(input)).filter((url) => url.includes('/api/v1/blobs'))
    expect(asks).toHaveLength(3)
    expect(asks.some((url) => url.includes(oid('Rahim lab notes, never read')))).toBe(false)
    expect(askedCode[0].repos.map((repo) => repo.repo)).toEqual(['a/x', 'b/y', 'c/z'])
  })

  it('opens a pair to show the files and the shared lines, linked on GitHub', async () => {
    await openSimilarity()
    await within(await loadedSection()).findByText(/of repos share code/)
    fireEvent.click(within(codeRows()[0]).getByRole('button', { name: 'Show code' }))

    const files = within(section()).getByText(/^Files with shared code/).closest('section') as HTMLElement
    expect(within(files).getByText('lab/form.js ↔ task/main.js')).toBeTruthy()
    const [aLink, bLink] = within(files).getAllByRole('link')
    expect(aLink.getAttribute('href')).toMatch(new RegExp(`^https://github.com/a/x/blob/${oid('a/x')}/lab/form.js#L1-L\\d+$`))
    // Karim's copy starts one line lower, below the comment.
    expect(bLink.getAttribute('href')).toMatch(new RegExp(`^https://github.com/b/y/blob/${oid('b/y')}/task/main.js#L2-L\\d+$`))
    expect(aLink.textContent).toMatch(/^lines 1–\d+/)

    const rest = within(section()).getByText('The rest').closest('section') as HTMLElement
    expect(within(rest).getAllByText('1 file')).toHaveLength(2)
  })

  it('does not count code that more repos have than the chosen limit', async () => {
    fake.api.trees['c/z'] = [file('copy.js', `${ORIGINAL}\n${SALMA}`)]
    await openSimilarity()
    await within(await loadedSection()).findByText(/of repos share code/)
    // With every file counted (3 of 3), all three share Rahim's code.
    expect(codeRows()).toHaveLength(3)

    fireEvent.change(screen.getByLabelText('Starter files'), { target: { value: '2' } })
    // Rahim's code is in all three repos, so it counts as handed out and Karim shares
    // nothing else. Rahim and Salma still share the lines Karim changed: only they have those.
    await waitFor(() => expect(codeRows()).toHaveLength(1))
    const [a, b, match] = cells(codeRows()[0])
    expect(a).toContain('Rahim Uddin')
    expect(b).toContain('Salma Akter')
    expect(match).toMatch(/Only a few lines shared$/)
    expect(askedCode.map((request) => request.commonLimit)).toEqual([3, 2])
  })

  it('says whose code could not be read, and tries again on request', async () => {
    fake.api.blobFailures['c/z'] = failure(404, 'repo_not_found', 'Repo not found.')
    await openSimilarity()
    const note = await within(await loadedSection()).findByText(/could not be read/)
    const box = note.closest('[role="note"]') as HTMLElement
    expect(within(box).getByText('GitHub no longer shows this repo. It may be private or deleted now.')).toBeTruthy()
    expect(within(box).getByText('22-46003-1 · Salma Akter')).toBeTruthy()

    delete fake.api.blobFailures['c/z']
    fireEvent.click(within(box).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(within(section()).queryByText(/could not be read/)).toBeNull())
    await within(section()).findByText(/of repos share code/)
    expect(codeRows()).toHaveLength(1)
  })

  it('says so when no two repos share more than a few lines', async () => {
    fake.api.trees['b/y'] = [file('main.js', program(40, 'karim'))]
    await openSimilarity()
    expect(await within(await loadedSection()).findByText('No two repos share more than a few lines of code.')).toBeTruthy()
  })

  it('puts the pairs that share code into the downloaded report', async () => {
    const saved: Blob[] = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (blob: Blob) => (saved.push(blob), 'blob:report'), revokeObjectURL: () => {} }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await openSimilarity()
    await within(await loadedSection()).findByText(/of repos share code/)
    fireEvent.click(screen.getByRole('button', { name: 'Download .xlsx' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    const book = XLSX.read(new Uint8Array(await saved[0].arrayBuffer()), { type: 'array' })
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['Shared code'], { header: 1, defval: '' })
    expect(rows).toHaveLength(2)
    expect(rows[1].slice(1, 2)).toEqual(['Almost all code shared'])
    expect(rows[1][4]).toBe('Rahim Uddin')
    expect(rows[1][7]).toBe('Karim Hasan')
    expect(String(rows[1][18])).toMatch(/^lab\/form\.js lines 1–/)
    click.mockRestore()
  })

  it('still compares the code when the browser cannot start a worker', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('Workers are blocked')
        }
      },
    )
    await openSimilarity()
    await within(await loadedSection()).findByText(/of repos share code/)
    expect(codeRows()).toHaveLength(1)
  })
})
