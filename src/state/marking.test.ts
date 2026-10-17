// @vitest-environment jsdom
// The store's side of marking: which kind of sheet was uploaded, the rules
// table of each project and term, the Mid / Final switch, the bonus of each
// student, what is kept in this browser, and how a lab sheet's term folders
// are read from GitHub. Nothing here reaches the network.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityEvent, TreeDir } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import { parseDeadlineInput } from '../logic/time.ts'
import { failure, okRepo, oid, STORAGE_KEY, stubApi, type FakeApi } from '../test/fakeApi.ts'

type Store = typeof import('./store.ts')

const MID_INPUT = '2026-10-05T23:59'
const FINAL_INPUT = '2026-12-20T23:59'
const MID = parseDeadlineInput(MID_INPUT)!.ms
const BEFORE_MID = new Date(MID - 86_400_000).toISOString()
const AFTER_MID = new Date(MID + 3 * 86_400_000).toISOString()

const CSV = [
  'id,name,repolink,Lab 1,Lab 2,Section',
  '22-1,Rahim Uddin,github.com/rahim/lab,8,9,A',
  '22-2,Karim Hasan,github.com/karim/lab,7,,B',
].join('\n')
const csv = (text = CSV, name = 'section-a.csv') => new File([text], name, { type: 'text/csv' })

async function freshStore(data: Partial<FakeApi> = {}): Promise<{ store: Store; fake: ReturnType<typeof stubApi> }> {
  const fake = stubApi(data)
  vi.resetModules()
  const store = await import('./store.ts')
  return { store, fake }
}

const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('the kind of sheet', () => {
  it('is the kind the teacher chose on the home page, not a guess', async () => {
    const { store } = await freshStore()
    await store.loadFile(csv(), 'lab')
    expect(store.getState().sheet?.kind).toBe('lab')
    await store.loadFile(csv(), 'project')
    expect(store.getState().sheet?.kind).toBe('project')
  })

  it('is a project sheet when nothing says otherwise', async () => {
    const { store } = await freshStore()
    await store.loadFile(csv())
    expect(store.getState().sheet?.kind).toBe('project')
  })

  it('carries the other columns of a lab sheet along, with their headers', async () => {
    const { store } = await freshStore()
    await store.loadFile(csv(), 'lab')
    const sheet = store.getState().sheet!
    expect(sheet.extraHeaders).toEqual(['Lab 1', 'Lab 2', 'Section'])
    expect(sheet.rows.map((row) => row.extra)).toEqual([
      ['8', '9', 'A'],
      ['7', '', 'B'],
    ])
  })

  it('carries nothing extra for a project sheet', async () => {
    const { store } = await freshStore()
    await store.loadFile(csv(), 'project')
    expect(store.getState().sheet?.extraHeaders).toEqual([])
  })
})

describe('the rules table', () => {
  it('takes effect as it is typed, and is kept in this browser', async () => {
    const { store } = await freshStore()
    await store.loadFile(csv(), 'project')
    store.setRuleInput('total', '10')
    store.setRuleInput('late', '2')
    expect(store.getState().rules).toEqual({ total: 10, late: 2, changed: 0, noSubmission: 0 })
    expect(saved().settings.project.rules).toEqual({ total: 10, late: 2, changed: 0, noSubmission: 0 })
  })

  it('keeps the last good rules and names the field while a typed value cannot be used', async () => {
    const { store } = await freshStore()
    await store.loadFile(csv(), 'project')
    store.setRuleInput('total', '10')
    store.setRuleInput('late', '-2')
    expect(store.getState().rulesBad).toEqual(['late'])
    expect(store.getState().rules.late).toBe(0)
    expect(store.getState().rulesInput.late).toBe('-2')
    store.setRuleInput('late', '2')
    expect(store.getState().rulesBad).toEqual([])
    expect(store.getState().rules.late).toBe(2)
  })

  it('keeps one table for project sheets and one for each term of lab sheets', async () => {
    const { store } = await freshStore()
    await store.loadFile(csv(), 'project')
    store.setRuleInput('total', '20')

    await store.loadFile(csv(), 'lab')
    expect(store.getState().rules.total).toBeNull()
    store.setRuleInput('total', '10')

    await store.loadFile(csv(), 'project')
    expect(store.getState().rules.total).toBe(20)
    expect(store.getState().rulesInput.total).toBe('20')
  })
})

describe('the Mid / Final switch of a lab sheet', () => {
  it('gives each term its own deadline and rules', async () => {
    const { store } = await freshStore()
    await store.loadFile(csv(), 'lab')
    expect(store.getState().term).toBe('mid')
    store.setDeadlineInput(MID_INPUT)
    store.applyDeadline()
    store.setRuleInput('total', '10')

    store.setTerm('final')
    expect(store.getState().deadline).toBeNull()
    expect(store.getState().deadlineInput).toBe('')
    expect(store.getState().rules.total).toBeNull()
    store.setDeadlineInput(FINAL_INPUT)
    store.applyDeadline()
    store.setRuleInput('total', '15')

    store.setTerm('mid')
    expect(store.getState().deadline).toBe(MID)
    expect(store.getState().deadlineInput).toBe(MID_INPUT)
    expect(store.getState().rules.total).toBe(10)
    expect(saved().term).toBe('mid')
    expect(saved().settings.final).toEqual({
      deadlineInput: FINAL_INPUT,
      rules: { total: 15, late: 0, changed: 0, noSubmission: 0 },
    })
  })
})

describe('the bonus', () => {
  it('is kept per student and per term', async () => {
    const { store } = await freshStore()
    await store.loadFile(csv(), 'lab')
    const [rahim, karim] = store.getState().sheet!.rows
    store.setBonus(rahim, 2)
    expect(store.bonusOf(rahim)).toBe(2)
    expect(store.bonusOf(karim)).toBeNull()

    store.setTerm('final')
    expect(store.bonusOf(rahim)).toBeNull()
    store.setTerm('mid')
    expect(store.bonusOf(rahim)).toBe(2)
  })

  it('follows the student ID, so a re-sorted sheet keeps each bonus with its student', async () => {
    const { store } = await freshStore()
    await store.loadFile(csv(), 'project')
    store.setBonus(store.getState().sheet!.rows[0], 3)
    const [header, rahim, karim] = CSV.split('\n')
    await store.loadFile(csv([header, karim, rahim].join('\n')), 'project')
    const rows = store.getState().sheet!.rows
    expect(rows.map((row) => row.name)).toEqual(['Karim Hasan', 'Rahim Uddin'])
    expect(rows.map((row) => store.bonusOf(row))).toEqual([null, 3])
  })

  it('is removed with a blank box, and with Clear', async () => {
    const { store } = await freshStore()
    await store.loadFile(csv(), 'project')
    const rahim = store.getState().sheet!.rows[0]
    store.setBonus(rahim, 3)
    store.setBonus(rahim, null)
    expect(store.bonusOf(rahim)).toBeNull()
    store.setBonus(rahim, 3)
    store.clearSheet()
    expect(store.getState().bonus.size).toBe(0)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('what this browser keeps', () => {
  it('brings back the kind, the term, every rules table, the bonuses and the carried columns', async () => {
    const first = await freshStore()
    await first.store.loadFile(csv(), 'lab')
    first.store.setRuleInput('total', '10')
    first.store.setBonus(first.store.getState().sheet!.rows[1], 1.5)
    first.store.setTerm('final')
    first.store.setRuleInput('total', '15')

    const { store } = await freshStore()
    store.start()
    const state = store.getState()
    expect(state.sheet?.kind).toBe('lab')
    expect(state.sheet?.extraHeaders).toEqual(['Lab 1', 'Lab 2', 'Section'])
    expect(state.sheet?.rows[0].extra).toEqual(['8', '9', 'A'])
    expect(state.term).toBe('final')
    expect(state.rules.total).toBe(15)
    store.setTerm('mid')
    expect(state.sheet && store.bonusOf(store.getState().sheet!.rows[1])).toBe(1.5)
    expect(store.getState().rules.total).toBe(10)
  })

  it('turns the rules of an older save into the new rules table', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        kind: 'project',
        fileName: 'old.xlsx',
        sheetName: 'Sheet1',
        truncated: false,
        rows: [[2, '22-1', 'Rahim', 'github.com/rahim/lab']],
        deadlineInput: MID_INPUT,
        grading: { totalMark: 50, offForLate: 15, offForChanged: 5 },
      }),
    )
    const { store } = await freshStore()
    store.start()
    expect(store.getState().deadline).toBe(MID)
    expect(store.getState().rules).toEqual({ total: 50, late: 15, changed: 5, noSubmission: 0 })
  })

  it('opens an older performance save as a lab sheet', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ kind: 'performance', fileName: 'marks.xlsx', sheetName: 'S', truncated: false, rows: [] }),
    )
    const { store } = await freshStore()
    store.start()
    expect(store.getState().sheet?.kind).toBe('lab')
  })

  it('throws away tampered values instead of using them', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        kind: 'lab',
        fileName: 'x.xlsx',
        sheetName: 'S',
        truncated: false,
        rows: [[2, '22-1', 'Rahim', 'github.com/rahim/lab', ['8', 9, { evil: 1 }]]],
        extraHeaders: ['Lab 1', 7, 'Lab 3'],
        term: 'summer',
        settings: {
          mid: { deadlineInput: 'soon', rules: { total: 'ten', late: -3, changed: 1e9, noSubmission: 2 } },
          final: 'nope',
        },
        bonus: [
          ['mid|id:22-1', 2],
          ['mid|id:22-2', 'lots'],
          ['mid|id:22-3', 1e9],
          [5, 1],
        ],
      }),
    )
    const { store } = await freshStore()
    store.start()
    const state = store.getState()
    expect(state.term).toBe('mid')
    expect(state.deadline).toBeNull()
    expect(state.rules).toEqual({ total: null, late: 0, changed: 0, noSubmission: 2 })
    expect([...state.bonus]).toEqual([['mid|id:22-1', 2]])
    expect(state.sheet?.extraHeaders).toEqual(['Lab 1', '7', 'Lab 3'])
    expect(state.sheet?.rows[0].extra).toEqual(['8', '9', ''])
  })
})

describe('reading the term folders of a lab sheet', () => {
  // Rahim handed in Mid on time, then pushed Final work after the Mid deadline.
  // Karim's repo has no Mid folder at all.
  const RAHIM_AT_MID = oid('rahim@mid')
  const RAHIM_HEAD = oid('rahim/lab')
  const KARIM_HEAD = oid('karim/lab')
  const MID_FOLDER = oid('rahim-mid-folder')
  const FINAL_FOLDER = oid('rahim-final-folder')
  const KARIM_FINAL = oid('karim-final-folder')

  const dir = (path: string, sha: string): TreeDir => ({ path, sha })
  const push = (ts: string, after: string, before: string): ActivityEvent => ({
    ts,
    type: 'push',
    ref: 'refs/heads/main',
    before,
    after,
    actor: 'student',
  })

  const github = (): Partial<FakeApi> => ({
    repos: {
      'rahim/lab': okRepo('rahim/lab', { pushedAt: AFTER_MID, headOid: RAHIM_HEAD }),
      'karim/lab': okRepo('karim/lab', { pushedAt: BEFORE_MID, headOid: KARIM_HEAD }),
    },
    activity: {
      'rahim/lab': [push(AFTER_MID, RAHIM_HEAD, RAHIM_AT_MID), push(BEFORE_MID, RAHIM_AT_MID, ZERO_OID)],
    },
    listings: {
      [`rahim/lab@${RAHIM_HEAD}`]: { dirs: [dir('Mid', MID_FOLDER), dir('Final', FINAL_FOLDER)], files: [] },
      [`rahim/lab@${RAHIM_AT_MID}`]: { dirs: [dir('Mid', MID_FOLDER)], files: [] },
      [`rahim/lab@${MID_FOLDER}`]: { dirs: [dir('Lab 2', oid('l2')), dir('Lab 1', oid('l1'))], files: [] },
      [`karim/lab@${KARIM_HEAD}`]: { dirs: [dir('Final', KARIM_FINAL)], files: [] },
    },
  })

  async function open(data = github()) {
    const { store, fake } = await freshStore(data)
    await store.loadFile(csv(), 'lab')
    store.setDeadlineInput(MID_INPUT)
    store.applyDeadline()
    const settled = () =>
      vi.waitFor(() => {
        const people = store.currentPeople()
        expect(people.some((person) => person.verdict.status === 'checking')).toBe(false)
        expect(people.every((person) => person.lab?.tasks !== undefined)).toBe(true)
      })
    await settled()
    return { store, fake, settled }
  }

  it('judges Mid by the Mid folder only, and lists its lab tasks', async () => {
    const { store } = await open()
    const [rahim, karim] = store.currentPeople()
    expect(rahim.verdict.status).toBe('on_time')
    expect(rahim.verdict.notes).toContain('term_untouched_after_deadline')
    expect(rahim.lab).toEqual({ folder: 'Mid', tasks: ['Lab 1', 'Lab 2'] })
    expect(karim.verdict.status).toBe('no_submission')
    expect(karim.lab).toEqual({ folder: null, tasks: null })
  })

  it('asks GitHub for one folder level at a time, by commit', async () => {
    const { fake } = await open()
    const asked = fake.fetch.mock.calls
      .map(([input]) => new URL(String(input), 'http://localhost'))
      .filter((url) => url.pathname === '/api/v1/tree')
    expect(asked.every((url) => url.searchParams.get('flat') === '1')).toBe(true)
    expect(asked.map((url) => `${url.searchParams.get('repo')}@${url.searchParams.get('sha')}`).sort()).toEqual(
      [`karim/lab@${KARIM_HEAD}`, `rahim/lab@${MID_FOLDER}`, `rahim/lab@${RAHIM_AT_MID}`, `rahim/lab@${RAHIM_HEAD}`].sort(),
    )
  })

  it('does not read folders for a project sheet', async () => {
    const { store, fake } = await freshStore(github())
    await store.loadFile(csv(), 'project')
    await vi.waitFor(() => expect(store.getState().loadingRepos).toBe(0))
    expect(store.currentPeople()[0].lab).toBeUndefined()
    expect(fake.paths()).not.toContain('/api/v1/tree')
  })

  it('reads Check failed when a folder cannot be read, and tries again on Refresh', async () => {
    const data = github()
    data.listings![`karim/lab@${KARIM_HEAD}`] = failure(404, 'repo_or_sha_not_found', 'Repo or commit not found.')
    const { store, fake, settled } = await open(data)
    expect(store.currentPeople()[1].verdict.status).toBe('check_failed')

    fake.api.listings[`karim/lab@${KARIM_HEAD}`] = { dirs: [dir('Mid', oid('k-mid'))], files: [] }
    fake.api.listings[`karim/lab@${oid('k-mid')}`] = { dirs: [], files: [{ path: 'lab1.c', sha: oid('f'), size: 1 }] }
    store.refresh()
    await settled()
    expect(store.currentPeople()[1].verdict.status).toBe('on_time')
    expect(store.currentPeople()[1].lab?.tasks).toEqual(['lab1.c'])
  })
})
