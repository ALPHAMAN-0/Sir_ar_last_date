// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { judgePair, sharedBlobs } from '../similarity/first.ts'
import type { FirstState } from '../similarity/firstRun.ts'
import { FIRST_NOTE } from '../similarity/firstText.ts'
import { repo, type Files, type Repo } from '../test/stories.ts'
import { FirstCell, FirstEvidence } from './WhoFirst.tsx'

afterEach(cleanup)

const WORK: Files = { 'src/app.js': 'the app', 'src/util.js': 'the helpers' }
const student = (name: string, when: string) =>
  repo(name, [
    { at: '02 09:00', files: { 'README.md': `readme of ${name}` } },
    { at: when, files: { 'README.md': `readme of ${name}`, ...WORK } },
  ])
const ready = (a: Repo, b: Repo): FirstState => ({
  state: 'ready',
  evidence: judgePair({
    a: a.facts,
    b: b.facts,
    blobs: sharedBlobs(a.head, b.head, new Set()),
    aHistory: a.history,
    bHistory: b.history,
    aCommits: a.commits,
    bCommits: b.commits,
  }),
})
const NAMED = ready(student('a/app', '12 10:14'), student('b/app', '14 23:51'))
const CLOSE = ready(student('a/app', '12 10:14'), student('b/app', '12 10:40'))

describe('FirstCell', () => {
  const cell = (state: FirstState | undefined, tier: Parameters<typeof FirstCell>[0]['tier'] = 'most') =>
    render(<FirstCell state={state} tier={tier} />).container

  it('shows a dash for a row without a direction', () => {
    expect(cell(undefined).textContent).toBe('–')
  })

  it('says that a pair is waiting or being checked', () => {
    expect(cell({ state: 'waiting' }).textContent).toBe('Open to check')
    const busy = cell({ state: 'checking' })
    expect(busy.textContent).toBe('Checking…')
    expect(busy.querySelector('.stamp--busy')).toBeTruthy()
  })

  it('names the first repo and adds the result, in words that fit the size of the match', () => {
    const strong = cell(NAMED)
    expect(strong.textContent).toBe('A firstB likely copied from A')
    expect(strong.querySelector('.stamp--warn')?.textContent).toBe('A first')
    expect(cell(NAMED, 'thin').textContent).toBe('A firstA had these files first')
  })

  it('stays quiet when it cannot tell', () => {
    const quiet = cell(CLOSE)
    expect(quiet.textContent).toBe('Cannot tell')
    expect(quiet.querySelector('.stamp--muted')).toBeTruthy()
  })
})

describe('FirstEvidence', () => {
  const show = (state: FirstState | undefined, onCheck = vi.fn()) => {
    render(<FirstEvidence state={state} tier="most" onCheck={onCheck} />)
    return onCheck
  }

  it('draws nothing for a row without a direction', () => {
    show(undefined)
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('offers to check a pair that is still waiting', () => {
    const onCheck = show({ state: 'waiting' })
    expect(screen.getByText(/Not checked yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(onCheck).toHaveBeenCalledTimes(1)
  })

  it('says that it is reading while a pair is checked', () => {
    show({ state: 'checking' })
    expect(screen.getByRole('status').textContent).toBe('Reading when each repo was pushed…')
  })

  it('lists what was seen, then the result, then what the result cannot know', () => {
    show(NAMED)
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(2)
    expect(screen.getByText('Result:').parentElement?.textContent).toBe('Result: B likely copied from A')
    expect(screen.getByText(FIRST_NOTE)).toBeTruthy()
  })

  it('leaves the note out when nobody is named', () => {
    show(CLOSE)
    expect(screen.getByText('Result:').parentElement?.textContent).toMatch(/^Result: Cannot tell\./)
    expect(screen.queryByText(FIRST_NOTE)).toBeNull()
  })
})
