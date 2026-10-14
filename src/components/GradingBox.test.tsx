// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GradingBox } from './GradingBox.tsx'
import * as store from '../state/store.ts'

const STORAGE_KEY = 'sirar:v2'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear() {
      data.clear()
    },
    getItem(k) {
      return data.get(k) ?? null
    },
    key(i) {
      return [...data.keys()][i] ?? null
    },
    removeItem(k) {
      data.delete(k)
    },
    setItem(k, v) {
      data.set(k, v)
    },
  }
}

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  // Seed a sheet so save() actually writes.
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      kind: 'project',
      fileName: 'class.xlsx',
      sheetName: 'Sheet1',
      truncated: false,
      rows: [[2, 'id-0', 'Person 0', 'github.com/a/one']],
      deadlineInput: '',
      sort: { column: 'pushedAt', descending: true },
    }),
  )
  store.start()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('GradingBox', () => {
  it('renders three input fields: total, late deduction, changed deduction', () => {
    render(<GradingBox />)
    expect(screen.getByLabelText('Total mark')).toBeTruthy()
    expect(screen.getByLabelText('Marks off for late')).toBeTruthy()
    expect(screen.getByLabelText('Marks off for changed after deadline')).toBeTruthy()
  })

  it('reflects the typed values in the input boxes', () => {
    store.setGradingInput('total', '100')
    store.setGradingInput('offLate', '20')
    store.setGradingInput('offChanged', '10')
    expect(store.applyGrading()).toBe(true)
    render(<GradingBox />)
    expect((screen.getByLabelText('Total mark') as HTMLInputElement).value).toBe('100')
    expect((screen.getByLabelText('Marks off for late') as HTMLInputElement).value).toBe('20')
    expect((screen.getByLabelText('Marks off for changed after deadline') as HTMLInputElement).value).toBe('10')
  })

  it('updates the typed value in the store when an input changes', () => {
    render(<GradingBox />)
    fireEvent.change(screen.getByLabelText('Total mark'), { target: { value: '75' } })
    expect(store.getState().gradingInput.total).toBe('75')
  })

  it('shows the current rules under the form', () => {
    store.setGradingInput('total', '100')
    store.setGradingInput('offLate', '20')
    store.setGradingInput('offChanged', '10')
    expect(store.applyGrading()).toBe(true)
    render(<GradingBox />)
    const state = document.querySelector('.grading__state') as HTMLElement
    expect(state.textContent).toContain('100')
    expect(state.textContent).toContain('−20')
    expect(state.textContent).toContain('−10')
  })

  it('shows an apply button', () => {
    render(<GradingBox />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
    expect(buttons[0].textContent).toMatch(/Apply|Change/)
  })
})