// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary.tsx'

function Broken(): never {
  throw new Error('The screen broke')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ErrorBoundary', () => {
  it('shows the screen when nothing goes wrong', () => {
    render(
      <ErrorBoundary>
        <p>The register</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('The register')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a way back instead of a blank page when the screen breaks', () => {
    // React and the boundary both report the error; keep the test output clean.
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert').textContent).toContain(
      'Something went wrong while showing this screen. Your sheet is still saved.',
    )
    expect(screen.getByRole('button', { name: 'Reload the register' })).toBeTruthy()
    expect(report).toHaveBeenCalledWith('The page hit an unexpected error:', expect.any(Error))
  })

  it('goes back to the register and reloads the page on request', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // jsdom cannot reload a page, so the location is replaced for this test.
    const location = { hash: '#/p/r7', reload: vi.fn() }
    vi.stubGlobal('location', location)
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reload the register' }))
    expect(location.hash).toBe('#/')
    expect(location.reload).toHaveBeenCalledOnce()
  })
})
