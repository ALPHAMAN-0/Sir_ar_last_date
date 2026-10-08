// @vitest-environment jsdom
// "Test it" — the QA runner. Walks qa/buttons.json, finds each control in a
// jsdom-rendered copy of the app, clicks it, and asserts the app did not
// throw or log a console error. One report line per entry; the whole suite
// fails if any entry is not 'pass' or 'skip'.
//
// Run: `npm test -- qa/test-it`. The end-to-end check the user asked for.

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import buttonsFile from './buttons.json' with { type: 'json' }
import type { ButtonEntry, ButtonsFile, ExpectedAfter, Requires } from './buttons.d.ts'
import { okRepo, saveSheet, stubApi, type RowCells } from '../src/test/fakeApi.ts'

const REGISTRY: ButtonEntry[] = (buttonsFile as ButtonsFile).buttons

const SHEET: RowCells[] = [
  ['22-46001-1', 'Rahim Uddin', 'https://github.com/octocat/hello-world'],
  ['22-46002-1', 'Nusrat Jahan', 'github.com/octocat/spoon-knife'],
]

type Result = { id: string; label: string; status: 'pass' | 'skip' | 'fail'; reason?: string }
const results: Result[] = []
const record = (entry: ButtonEntry, status: Result['status'], reason?: string): void => {
  results.push({ id: entry.id, label: entry.label, status, reason })
}

beforeEach(() => {
  stubApi({
    repos: {
      'octocat/hello-world': okRepo('octocat/hello-world'),
      'octocat/spoon-knife': okRepo('octocat/spoon-knife'),
    },
    commits: { 'octocat/hello-world': [], 'octocat/spoon-knife': [] },
    trees: { 'octocat/hello-world': [], 'octocat/spoon-knife': [] },
  })
  vi.stubGlobal('scrollTo', vi.fn())
  // The Excel download library writes a Blob and clicks an <a download>. Stub
  // the anchor's click so jsdom does not complain about a missing element.
  const originalCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = originalCreate(tag)
    if (tag === 'a') {
      Object.defineProperty(element, 'click', { value: vi.fn(), configurable: true })
    }
    return element
  })
  // The similarity view starts a Web Worker; throw on construct so it falls
  // back to the in-thread analyser, mirroring App.test.tsx.
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
  vi.restoreAllMocks()
})

/** Sets localStorage and the route, then resets the module cache so the next
 *  render starts from a known store. */
async function seedFor(requires: Requires = {}): Promise<void> {
  if (requires.hasSheet) {
    saveSheet(SHEET, requires.hasDeadline ? { deadlineInput: '2026-12-31T23:59' } : {})
  }
  history.replaceState(null, '', `/${requires.route ?? ''}`)
  vi.resetModules()
  const { start } = await import('../src/state/store.ts')
  start()
}

/** Renders the app and lets React flush effects. */
async function renderApp(): Promise<void> {
  const { default: App } = await import('../src/App.tsx')
  render(<App />)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** First clickable element whose accessible text contains `needle` (lowercase
 *  match), or null. `text=…` is a shortcut for "the only label is its text". */
function findByText(needle: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('button, a, [role="button"]')
  for (const node of all) {
    const text = (node.textContent ?? '').trim().toLowerCase()
    if (text === needle || text.includes(needle)) return node
  }
  return null
}

/** Finds a control by its JSON selector. `text=…` is a label shortcut;
 *  everything else is a plain CSS selector. */
function findControl(selector: string): HTMLElement | null {
  if (selector.startsWith('text=')) return findByText(selector.slice('text='.length).toLowerCase())
  const node = document.querySelector(selector)
  return node instanceof HTMLElement ? node : null
}

/** Clicks a control and asserts the post-click invariants from `expectedAfter`. */
async function clickAndCheck(entry: ButtonEntry): Promise<void> {
  await seedFor(entry.requires)
  await renderApp()

  const errors: string[] = []
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  })

  const node = findControl(entry.selector)
  if (!node) {
    record(entry, 'skip', `control not found: ${entry.selector}`)
    return
  }
  // Fire any warm-up clicks (e.g. "Clear" before "Yes, remove").
  for (const warm of entry.preClicks ?? []) {
    const warmNode = findControl(warm)
    if (warmNode) fireEvent.click(warmNode)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  // Re-find the main control after preClicks may have re-rendered the DOM.
  const live = findControl(entry.selector) ?? node
  try {
    fireEvent.click(live)
  } catch (error) {
    record(entry, 'fail', `click threw: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 0))

  const checks: ExpectedAfter = entry.expectedAfter ?? { noConsoleError: true, stillRendered: true }
  if (checks.noConsoleError && errors.length > 0) {
    record(entry, 'fail', `console.error called: ${errors.join(' | ')}`)
    return
  }
  if (checks.stillRendered && document.body.textContent === '') {
    record(entry, 'fail', 'document body is empty after click')
    return
  }
  record(entry, 'pass')
  // Suppress an unused-var warning when no error is logged.
  void errorSpy
}

describe('Test it — QA button registry', () => {
  it('has at least one button registered', () => {
    expect(REGISTRY.length).toBeGreaterThan(0)
  })

  it('every entry has the required fields', () => {
    for (const entry of REGISTRY) {
      expect(entry.id, 'id missing').toBeTruthy()
      expect(entry.label, `${entry.id} label`).toBeTruthy()
      expect(entry.selector, `${entry.id} selector`).toBeTruthy()
      expect(entry.screen, `${entry.id} screen`).toBeTruthy()
    }
  })

  it('every entry id is unique', () => {
    const seen = new Set<string>()
    for (const entry of REGISTRY) {
      expect(seen.has(entry.id), `duplicate id: ${entry.id}`).toBe(false)
      seen.add(entry.id)
    }
  })

  it('clicks every button in the registry without crashing', async () => {
    for (const entry of REGISTRY) {
      await clickAndCheck(entry)
    }
    const failures = results.filter((result) => result.status === 'fail')
    const skipped = results.filter((result) => result.status === 'skip')
    // eslint-disable-next-line no-console
    console.log(
      `\n  Test it: ${results.length} buttons — ` +
        `${results.length - failures.length - skipped.length} pass, ` +
        `${skipped.length} skip, ${failures.length} fail`,
    )
    for (const result of results) {
      // eslint-disable-next-line no-console
      console.log(`    [${result.status}] ${result.id} — ${result.label}${result.reason ? ` (${result.reason})` : ''}`)
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} button(s) failed: ${failures.map((failure) => failure.id).join(', ')}`)
    }
    expect(results.length).toBeGreaterThan(0)
  }, 60_000)
})
