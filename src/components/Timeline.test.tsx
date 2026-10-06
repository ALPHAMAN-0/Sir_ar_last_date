// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityEvent, CommitInfo } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import { parseDeadlineInput } from '../logic/time.ts'
import type { CommitList } from '../state/person.ts'
import { oid, stubApi, stubIntersectionObserver } from '../test/fakeApi.ts'
import { Timeline } from './Timeline.tsx'

const REPO = 'octocat/hello-world'
const DEADLINE = (parseDeadlineInput('2026-10-05T23:59') as { ms: number }).ms
/** A local wall-clock time in October 2026, as an ISO instant. */
const oct = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute).toISOString()

const commit = (name: string, committedAt: string, parent: string | null): CommitInfo => ({
  oid: oid(name),
  committedAt,
  authoredAt: committedAt,
  headline: name,
  parents: parent ? [oid(parent)] : [],
  authorName: null,
  authorLogin: 'rahim',
})

// Newest first, as GitHub lists them.
const COMMITS = [
  commit('Fix the typo', oct(6, 10, 0), 'Add the form'),
  commit('Add the form', oct(5, 22, 10), 'Add styles'),
  commit('Add styles', oct(5, 9, 0), 'First page'),
  commit('First page', oct(3, 15, 0), null),
]
const HEAD = oid('Fix the typo')
const push = (ts: string, before: string, after: string): ActivityEvent => ({
  ts,
  type: 'push',
  ref: 'refs/heads/main',
  before,
  after,
  actor: 'rahim',
})
// Three commits pushed together in time, the fix pushed the next morning.
const EVENTS = [push(oct(6, 10, 5), oid('Add the form'), HEAD), push(oct(5, 22, 30), ZERO_OID, oid('Add the form'))]

function show(props: Partial<{ list: CommitList; events: ActivityEvent[]; deadline: number | null; atDeadlineOid: string | null; changedAfter: boolean }> = {}) {
  render(
    <Timeline
      repo={REPO}
      headOid={HEAD}
      list={props.list ?? { commits: COMMITS, truncated: false }}
      events={props.events}
      deadline={props.deadline === undefined ? DEADLINE : props.deadline}
      atDeadlineOid={props.atDeadlineOid ?? null}
      changedAfter={props.changedAfter ?? false}
    />,
  )
}

/** The timeline top to bottom: "# day (count)", the deadline line, or a commit's message. */
function lines(): string[] {
  const list = screen.getAllByRole('list')[0]
  return [...list.children].map((item) => {
    const day = item.querySelector('h3')
    if (day) return `# ${day.textContent} (${day.nextElementSibling?.textContent})`
    const message = item.querySelector('a')
    return message ? (message.textContent ?? '') : (item.textContent ?? '')
  })
}

beforeEach(() => {
  // Only files are ever fetched here, and only when a commit is on screen; it never is.
  stubApi()
  stubIntersectionObserver()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Timeline', () => {
  it('groups commits under the day they are dated, with the deadline ruled where it falls', () => {
    show()
    expect(lines()).toEqual([
      '# Tue, 06 Oct 2026 (1 commit)',
      'Fix the typo',
      'Deadline · 05 Oct 2026, 23:59',
      '# Mon, 05 Oct 2026 (2 commits)',
      'Add the form',
      'Add styles',
      '# Sat, 03 Oct 2026 (1 commit)',
      'First page',
    ])
  })

  it('rules the deadline below every commit when all are dated after it', () => {
    show({ deadline: (parseDeadlineInput('2026-10-01T12:00') as { ms: number }).ms })
    expect(lines().at(-1)).toBe('Deadline · 01 Oct 2026, 12:00')
  })

  it('draws no deadline when none is set', () => {
    show({ deadline: null })
    expect(screen.queryByText(/^Deadline/)).toBeNull()
    expect(lines()).toHaveLength(7)
  })

  it('marks the commits that reached GitHub after the deadline, judged by push time', () => {
    show({ events: EVENTS, changedAfter: true, atDeadlineOid: oid('Add the form') })
    expect(screen.getByText(/reached GitHub after the deadline/).textContent).toBe(
      '1 commit reached GitHub after the deadline. They are marked below. See everything that changed after the deadline on GitHub ↗',
    )
    const compare = screen.getByRole('link', { name: 'See everything that changed after the deadline on GitHub ↗' })
    expect(compare.getAttribute('href')).toBe(
      `https://github.com/${REPO}/compare/${oid('Add the form')}...${HEAD}`,
    )

    const late = screen
      .getAllByText('After deadline')
      .map((tag) => tag.closest('li')?.querySelector('a')?.textContent)
    expect(late).toEqual(['Fix the typo'])
  })

  it('says nothing about late commits unless the status is "changed after deadline"', () => {
    show({ events: EVENTS, changedAfter: false })
    expect(screen.queryByText(/reached GitHub after the deadline/)).toBeNull()
    // The commit itself is still marked.
    expect(screen.getAllByText('After deadline')).toHaveLength(1)
  })

  it('says when only the newest part of a long history is shown', () => {
    show({ list: { commits: COMMITS, truncated: true } })
    expect(screen.getByText('This repo has a very long history. The newest 1,000 commits are shown.')).toBeTruthy()
  })
})
