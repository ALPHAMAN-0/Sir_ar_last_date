// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityEvent, CommitInfo } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import { formatDateTime, parseDeadlineInput } from '../logic/time.ts'
import { failure, okRepo, oid, saveSheet, stubApi, stubIntersectionObserver } from '../test/fakeApi.ts'

const INPUT = '2026-10-02T23:59'
const DEADLINE = (parseDeadlineInput(INPUT) as { ms: number }).ms
/** An instant whole minutes after the deadline (or before, when negative). */
const at = (minutes: number) => new Date(DEADLINE + 1 + minutes * 60_000).toISOString()

const IN_TIME = oid('Finish the task')
const NUSRAT_HEAD = oid('Polish after review')
const push = (ts: string, before: string, after: string): ActivityEvent => ({
  ts,
  type: 'push',
  ref: 'refs/heads/main',
  before,
  after,
  actor: 'student',
})
const commit = (headline: string, committedAt: string, parents: string[]): CommitInfo => ({
  oid: oid(headline),
  committedAt,
  authoredAt: committedAt,
  headline,
  parents,
  authorName: null,
  authorLogin: 'nusrat',
})

let fake: ReturnType<typeof stubApi>

beforeEach(() => {
  saveSheet(
    [
      ['22-46001-1', 'Rahim Uddin', 'github.com/octocat/hello-world'],
      ['22-46002-1', 'Nusrat Jahan', 'github.com/octocat/spoon-knife'],
      ['22-46005-1', 'Salma Akter', 'github.com/salma/late-start'],
      ['22-46003-1', 'Tanvir Ahmed', 'gitlab.com/tanvir/task-1'],
    ],
    { deadlineInput: INPUT },
  )
  fake = stubApi({
    repos: {
      'octocat/hello-world': okRepo('octocat/hello-world', { pushedAt: at(-600) }),
      'octocat/spoon-knife': okRepo('octocat/spoon-knife', {
        pushedAt: at(540),
        headOid: NUSRAT_HEAD,
        totalCommits: 12,
      }),
      'salma/late-start': okRepo('salma/late-start', { createdAt: at(120), pushedAt: at(199) }),
    },
    activity: {
      // Pushed a day before the deadline, then once more 9 hours after it.
      'octocat/spoon-knife': [push(at(540), IN_TIME, NUSRAT_HEAD), push(at(-1440), ZERO_OID, IN_TIME)],
      'salma/late-start': [push(at(199), ZERO_OID, oid('salma/late-start'))],
    },
    commits: {
      'octocat/hello-world': [commit('First page', at(-700), [])],
      'octocat/spoon-knife': [
        commit('Polish after review', at(530), [IN_TIME]),
        commit('Finish the task', at(-1500), []),
      ],
      'salma/late-start': [commit('Start late', at(190), [])],
    },
  })
  stubIntersectionObserver()
  vi.stubGlobal('scrollTo', vi.fn())
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

/** A fresh store with the saved sheet, and the person on sheet row `rowId`. */
async function openPerson(rowId: string, before?: (store: typeof import('../state/store.ts')) => void) {
  vi.resetModules()
  const store = await import('../state/store.ts')
  const { PersonView } = await import('./PersonView.tsx')
  store.start()
  before?.(store)
  render(<PersonView rowId={rowId} />)
  return store
}

/** The facts list as { term: value }. */
const facts = () =>
  Object.fromEntries(
    screen.getAllByRole('term').map((term) => [term.textContent, term.nextElementSibling?.textContent]),
  )
const pager = () => within(screen.getByRole('navigation', { name: 'People' }))

describe('PersonView', () => {
  it('shows who it is, their status and why, and starts at the top of the page', async () => {
    await openPerson('r3')
    expect(screen.getByRole('heading', { level: 1, name: 'Nusrat Jahan' })).toBeTruthy()
    expect(screen.getByText('22-46002-1 · sheet row 3')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'github.com/octocat/spoon-knife' }).getAttribute('href')).toBe(
      'https://github.com/octocat/spoon-knife',
    )
    expect(
      await screen.findByText(
        'Work was pushed in time, then 1 more push arrived after the deadline. The last one came 9h after it.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Changed after deadline')).toBeTruthy()
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('lists the facts of the repo, with push times from GitHub', async () => {
    await openPerson('r3')
    await screen.findByText(/Work was pushed in time/)
    expect(facts()).toEqual({
      'Repo created': formatDateTime('2026-09-01T08:00:00Z'),
      'First push': formatDateTime(at(-1440)),
      'Last push in time': formatDateTime(at(-1440)),
      'Last push': formatDateTime(at(540)),
      'Main branch': 'main',
      Commits: '12',
    })
  })

  it('shows the commits by date, marking the one that arrived after the deadline', async () => {
    await openPerson('r3')
    const timeline = screen.getByRole('region', { name: 'Commits by date' })
    expect(within(timeline).getByText('Loading the commits.')).toBeTruthy()

    expect(await within(timeline).findByRole('link', { name: 'Polish after review' })).toBeTruthy()
    expect(within(timeline).getByRole('link', { name: 'Finish the task' })).toBeTruthy()
    expect(await within(timeline).findByText('After deadline')).toBeTruthy()
    expect(
      within(timeline)
        .getByRole('link', { name: 'See everything that changed after the deadline on GitHub ↗' })
        .getAttribute('href'),
    ).toBe(`https://github.com/octocat/spoon-knife/compare/${IN_TIME}...${NUSRAT_HEAD}`)
  })

  it('says how late a late person was', async () => {
    await openPerson('r4')
    expect(
      await screen.findByText(
        `The first push reached GitHub on ${formatDateTime(at(199))}, 3h 19m after the deadline.`,
      ),
    ).toBeTruthy()
    expect(screen.getByText('Late').closest('.stamp')?.textContent).toBe('Late by 3h 19m')
    expect(facts()['First push']).toBe(formatDateTime(at(199)))
    await screen.findByRole('link', { name: 'Start late' })
  })

  it('explains a link that could not be read, with nothing to load', async () => {
    await openPerson('r5')
    expect(screen.getByText('Invalid link')).toBeTruthy()
    expect(screen.getByText('Not a GitHub link: “gitlab.com/tanvir/task-1”.')).toBeTruthy()
    expect(screen.queryAllByRole('term')).toEqual([])
    expect(screen.queryByRole('region', { name: 'Commits by date' })).toBeNull()
    expect(fake.paths()).not.toContain('/api/v1/commits')
  })

  it('steps to the previous and next person in the register order', async () => {
    // The register's own order: newest push first.
    await openPerson('r4')
    expect(pager().getByRole('link', { name: '← Nusrat Jahan' }).getAttribute('href')).toBe('#/p/r3')
    expect(pager().getByRole('link', { name: 'Rahim Uddin →' }).getAttribute('href')).toBe('#/p/r2')
    await screen.findByRole('link', { name: 'Start late' })
  })

  it('steps only through the people the register is filtered to', async () => {
    await openPerson('r2', (store) => store.setSearch('octocat'))
    expect(pager().getByRole('link', { name: '← Nusrat Jahan' })).toBeTruthy()
    expect(pager().getAllByRole('link').map((link) => link.textContent)).toEqual([
      '← Back to the register',
      '← Nusrat Jahan',
    ])
    await screen.findByRole('link', { name: 'First page' })
  })

  it('says so when the row is not in the sheet', async () => {
    await openPerson('r99')
    expect(screen.getByText(/This row is not in the current sheet/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to the register' }).getAttribute('href')).toBe('#/')
  })

  it('shows why the commits could not be loaded, and tries again on request', async () => {
    const commits = fake.api.commits['octocat/hello-world']
    fake.api.commits['octocat/hello-world'] = failure(404, 'not_found', 'GitHub could not find this commit.')
    await openPerson('r2')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('GitHub could not find this commit. Try again')

    fake.api.commits['octocat/hello-world'] = commits
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'First page' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
