// @vitest-environment jsdom
// Marking on the register: the rules table, each student's bonus and final
// mark, the Mid / Final switch of a lab sheet, and the marks in the download.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import type { ActivityEvent, TreeDir } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import { parseDeadlineInput } from '../logic/time.ts'
import { okRepo, oid, STORAGE_KEY, stubApi, type FakeApi } from '../test/fakeApi.ts'

const MID_INPUT = '2026-10-05T23:59'
const MID = parseDeadlineInput(MID_INPUT)!.ms
const at = (minutes: number) => new Date(MID + minutes * 60_000).toISOString()

const push = (ts: string, after: string, before: string = ZERO_OID): ActivityEvent => ({
  ts,
  type: before === ZERO_OID ? 'branch_creation' : 'push',
  ref: 'refs/heads/main',
  before,
  after,
  actor: 'student',
})

type Row = [rowNumber: number, id: string, name: string, link: string, extra?: string[]]

function save(kind: 'project' | 'lab', rows: Row[], over: object = {}): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      kind,
      fileName: 'class.xlsx',
      sheetName: 'Sheet1',
      truncated: false,
      rows,
      extraHeaders: kind === 'lab' ? ['Quiz', 'Section'] : [],
      term: 'mid',
      settings: {
        project: { deadlineInput: MID_INPUT, rules: { total: null, late: 0, changed: 0, noSubmission: 0 } },
        mid: { deadlineInput: MID_INPUT, rules: { total: null, late: 0, changed: 0, noSubmission: 0 } },
        final: { deadlineInput: '', rules: { total: null, late: 0, changed: 0, noSubmission: 0 } },
      },
      bonus: [],
      ...over,
    }),
  )
}

/** Files the page handed to the browser, instead of saving them. */
let saved: Array<{ bytes: Uint8Array; name: string }>

async function openRegister() {
  vi.resetModules()
  const store = await import('../state/store.ts')
  const { Register } = await import('./Register.tsx')
  store.start()
  render(<Register />)
  await waitFor(() => {
    expect(store.getState().loadingRepos).toBe(0)
    expect(store.currentPeople().some((person) => person.verdict.status === 'checking')).toBe(false)
  })
  return store
}

const table = () => screen.getByRole('table')
const rowOf = (name: string) => within(table()).getByText(name).closest('tr') as HTMLElement
const finalOf = (name: string) => (rowOf(name).querySelector('[data-label="Final mark"] .mark__final') as HTMLElement).textContent
const bonusBox = (name: string) => screen.getByRole('textbox', { name: `Bonus for ${name}` }) as HTMLInputElement
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } })

async function download() {
  fireEvent.click(screen.getByRole('button', { name: 'Download .xlsx' }))
  await waitFor(() => expect(saved).toHaveLength(1))
  const book = XLSX.read(saved[0].bytes, { type: 'array' })
  return XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Results, { header: 1, defval: '' })
}

beforeEach(() => {
  saved = []
  vi.doMock('../sheet/xlsxStyle.ts', async (original) => ({
    ...(await original<typeof import('../sheet/xlsxStyle.ts')>()),
    saveFile: (bytes: Uint8Array, name: string) => saved.push({ bytes, name }),
  }))
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.doUnmock('../sheet/xlsxStyle.ts')
  history.replaceState(null, '', '/')
})

describe('marking a project sheet', () => {
  beforeEach(() => {
    save('project', [
      [2, '22-1', 'Rahim Uddin', 'github.com/rahim/task'],
      [3, '22-2', 'Karim Hasan', 'github.com/karim/task'],
      [4, '22-3', 'Nadia Islam', 'github.com/nadia/missing'],
      [5, '22-4', 'Tania Akter', 'see my email'],
    ])
    const data: Partial<FakeApi> = {
      repos: {
        'rahim/task': okRepo('rahim/task', { createdAt: at(-5000), pushedAt: at(-60) }),
        'karim/task': okRepo('karim/task', { createdAt: at(100), pushedAt: at(200), headOid: oid('karim') }),
      },
      activity: { 'karim/task': [push(at(200), oid('karim'))] },
      commits: { 'rahim/task': [], 'karim/task': [] },
    }
    stubApi(data)
  })

  it('has a rules table, and no marks until the total is typed', async () => {
    await openRegister()
    for (const label of ['Total mark', 'Marks off for late', 'Marks off for changed after deadline', 'Mark for no submission']) {
      expect(field(label)).toBeTruthy()
    }
    expect(finalOf('Rahim Uddin')).toBe('—')
    expect(screen.getByText(/Type the total mark/)).toBeTruthy()
  })

  it('works out every final mark as the rules are typed, with no button to press', async () => {
    await openRegister()
    type(field('Total mark'), '10')
    type(field('Marks off for late'), '2')
    expect(finalOf('Rahim Uddin')).toBe('10')
    expect(finalOf('Karim Hasan')).toBe('8')
    expect(finalOf('Nadia Islam')).toBe('0')
    expect(finalOf('Tania Akter')).toBe('0')
    expect(within(rowOf('Karim Hasan')).getByText('Late −2')).toBeTruthy()
    type(field('Mark for no submission'), '1')
    expect(finalOf('Tania Akter')).toBe('1')
  })

  it('names a rule it cannot use and keeps the marks it had', async () => {
    await openRegister()
    type(field('Total mark'), '10')
    type(field('Marks off for late'), '2')
    type(field('Marks off for late'), 'two')
    expect(field('Marks off for late').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toMatch(/Marks off for late/)
    expect(finalOf('Karim Hasan')).toBe('8')
  })

  it('takes a bonus in the row, and moves to the next student on Enter', async () => {
    const store = await openRegister()
    type(field('Total mark'), '10')
    type(field('Marks off for late'), '2')
    type(bonusBox('Karim Hasan'), '1.5')
    expect(finalOf('Karim Hasan')).toBe('9.5')
    expect(store.bonusOf(store.getState().sheet!.rows[1])).toBe(1.5)

    bonusBox('Karim Hasan').focus()
    fireEvent.keyDown(bonusBox('Karim Hasan'), { key: 'Enter' })
    // The register's order: the newest push first, so the row after Karim is Rahim.
    const order = within(table()).getAllByRole('textbox').map((box) => box.getAttribute('aria-label'))
    const next = order[order.indexOf('Bonus for Karim Hasan') + 1]
    expect(document.activeElement?.getAttribute('aria-label')).toBe(next)
  })

  it('goes back up a row with the up arrow, and stays put past the first row', async () => {
    await openRegister()
    const boxes = () => within(table()).getAllByRole('textbox') as HTMLInputElement[]
    const [first, second] = boxes()
    second.focus()
    fireEvent.keyDown(second, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'a' })
    expect(document.activeElement).toBe(first)
  })

  it('takes marks off with a minus bonus, and never goes past 0 or the total', async () => {
    await openRegister()
    type(field('Total mark'), '10')
    type(bonusBox('Rahim Uddin'), '5')
    expect(finalOf('Rahim Uddin')).toBe('10')
    type(bonusBox('Rahim Uddin'), '-3')
    expect(finalOf('Rahim Uddin')).toBe('7')
    type(bonusBox('Rahim Uddin'), '-30')
    expect(finalOf('Rahim Uddin')).toBe('0')
  })

  it('refuses text in a bonus box, and keeps the bonus it had', async () => {
    const store = await openRegister()
    type(field('Total mark'), '10')
    type(bonusBox('Rahim Uddin'), '-1')
    type(bonusBox('Rahim Uddin'), 'abc')
    expect(bonusBox('Rahim Uddin').getAttribute('aria-invalid')).toBe('true')
    expect(store.bonusOf(store.getState().sheet!.rows[0])).toBe(-1)
    expect(finalOf('Rahim Uddin')).toBe('9')
  })

  it('does not open the person when the bonus box is clicked', async () => {
    await openRegister()
    fireEvent.click(bonusBox('Rahim Uddin'))
    expect(window.location.hash).toBe('')
  })

  it('writes the marks at the end of the downloaded file', async () => {
    await openRegister()
    type(field('Total mark'), '10')
    type(field('Marks off for late'), '2')
    type(bonusBox('Karim Hasan'), '1')
    const [header, ...rows] = await download()
    expect(header.slice(-3)).toEqual(['Deduction', 'Bonus', 'Final mark'])
    const byName = new Map(rows.map((line) => [line[2], line.slice(-3)]))
    expect(byName.get('Karim Hasan')).toEqual(['Late −2', 1, 9])
    expect(byName.get('Rahim Uddin')).toEqual(['', '', 10])
    expect(byName.get('Tania Akter')).toEqual(['No submission: 0', '', 0])
    // "Late by" is spelled out in the file.
    expect(rows.find((line) => line[2] === 'Karim Hasan')?.[5]).toBe('3 hours 20 minutes')
  })
})

describe('marking a lab sheet', () => {
  // Rahim handed in Mid on time, then pushed Final work after the Mid deadline.
  const RAHIM_AT_MID = oid('rahim@mid')
  const RAHIM_HEAD = oid('rahim/lab')
  const KARIM_HEAD = oid('karim/lab')
  const MID_FOLDER = oid('rahim-mid')
  const FINAL_FOLDER = oid('rahim-final')
  const dir = (path: string, sha: string): TreeDir => ({ path, sha })

  beforeEach(() => {
    save('lab', [
      [2, '22-1', 'Rahim Uddin', 'github.com/rahim/lab', ['8', 'A']],
      [3, '22-2', 'Karim Hasan', 'github.com/karim/lab', ['7', 'B']],
    ])
    stubApi({
      repos: {
        'rahim/lab': okRepo('rahim/lab', { createdAt: at(-5000), pushedAt: at(3000), headOid: RAHIM_HEAD }),
        'karim/lab': okRepo('karim/lab', { createdAt: at(-5000), pushedAt: at(-100), headOid: KARIM_HEAD }),
      },
      activity: {
        'rahim/lab': [push(at(3000), RAHIM_HEAD, RAHIM_AT_MID), push(at(-120), RAHIM_AT_MID)],
      },
      commits: { 'rahim/lab': [], 'karim/lab': [] },
      listings: {
        [`rahim/lab@${RAHIM_HEAD}`]: { dirs: [dir('Mid', MID_FOLDER), dir('Final', FINAL_FOLDER)], files: [] },
        [`rahim/lab@${RAHIM_AT_MID}`]: { dirs: [dir('Mid', MID_FOLDER)], files: [] },
        [`rahim/lab@${MID_FOLDER}`]: { dirs: [dir('Lab 2', oid('l2')), dir('Lab 1', oid('l1'))], files: [] },
        [`rahim/lab@${FINAL_FOLDER}`]: { dirs: [dir('Lab 5', oid('l5'))], files: [] },
        [`karim/lab@${KARIM_HEAD}`]: { dirs: [dir('Final', oid('karim-final'))], files: [] },
      },
    })
  })

  it('judges the Mid term by the Mid folder, and lists its lab tasks and the sheet’s other columns', async () => {
    await openRegister()
    const columns = within(table()).getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(columns).toEqual(expect.arrayContaining(['Lab tasks', 'Quiz', 'Section', 'Bonus', 'Final mark']))
    expect(within(rowOf('Rahim Uddin')).getByText('On time')).toBeTruthy()
    expect(within(rowOf('Rahim Uddin')).getByText('Lab 1, Lab 2')).toBeTruthy()
    expect(within(rowOf('Rahim Uddin')).getByText('8')).toBeTruthy()
    expect(within(rowOf('Karim Hasan')).getByText('No submission')).toBeTruthy()
    expect(within(rowOf('Karim Hasan')).getByText('No folder for this term in the repo')).toBeTruthy()
  })

  it('switches between Mid and Final, each with its own deadline label, rules and judgement', async () => {
    const store = await openRegister()
    const terms = screen.getByRole('group', { name: 'Term' })
    const mid = within(terms).getByRole('button', { name: 'Mid term' })
    const final = within(terms).getByRole('button', { name: 'Final term' })
    expect(mid.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('Mid term deadline')).toBeTruthy()
    type(field('Total mark'), '10')

    fireEvent.click(final)
    expect(final.getAttribute('aria-pressed')).toBe('true')
    expect(store.getState().term).toBe('final')
    expect(screen.getByLabelText('Final term deadline')).toBeTruthy()
    expect(field('Total mark').value).toBe('')
    // No Final deadline yet: Rahim's Final folder is simply there.
    await waitFor(() => expect(within(rowOf('Rahim Uddin')).getByText('Lab 5')).toBeTruthy())
    expect(within(rowOf('Karim Hasan')).getByText('Has work')).toBeTruthy()

    fireEvent.click(mid)
    expect(field('Total mark').value).toBe('10')
  })

  it('writes the term folder, lab tasks, carried columns and marks into the file', async () => {
    await openRegister()
    type(field('Total mark'), '10')
    const [header, ...rows] = await download()
    expect(header.slice(-8)).toEqual(['Branch names', 'Term folder', 'Lab tasks', 'Quiz', 'Section', 'Deduction', 'Bonus', 'Final mark'])
    const byName = new Map(rows.map((line) => [line[2], line.slice(-7)]))
    expect(byName.get('Rahim Uddin')).toEqual(['Mid', '2: Lab 1, Lab 2', 8, 'A', '', '', 10])
    expect(byName.get('Karim Hasan')).toEqual(['No Mid term folder', '', 7, 'B', 'No submission: 0', '', 0])
  })
})
