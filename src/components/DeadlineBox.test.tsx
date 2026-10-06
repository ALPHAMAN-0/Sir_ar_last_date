// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '../test/fakeApi.ts'

async function setup() {
  vi.resetModules()
  const store = await import('../state/store.ts')
  const { DeadlineBox } = await import('./DeadlineBox.tsx')
  render(<DeadlineBox />)
  return store
}

const field = () => screen.getByLabelText('Deadline') as HTMLInputElement
const type = (value: string) => fireEvent.change(field(), { target: { value } })
const stateLine = () => screen.getByText(/deadline is set|Work pushed during that minute/)

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('DeadlineBox', () => {
  it('starts with no deadline and nothing to apply', async () => {
    await setup()
    expect(field().value).toBe('')
    expect(stateLine().textContent).toBe('No deadline is set, so the register shows dates only.')
    expect((screen.getByRole('button', { name: 'Set deadline' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('applies a typed deadline only when the button is pressed', async () => {
    const store = await setup()
    type('2020-01-15T23:59')
    // Typing alone changes nothing: moving the deadline can start downloads.
    expect(store.getState().deadline).toBeNull()
    expect(stateLine().textContent).toContain('No deadline is set')

    const button = screen.getByRole('button', { name: 'Set deadline' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)

    expect(stateLine().textContent).toMatch(
      /^15 Jan 2020, 23:59 passed .+ ago\. Work pushed during that minute still counts as on time\.$/,
    )
    // The whole minute counts: 23:59 means up to 23:59:59.999.
    expect(store.getState().deadline).toBe(new Date(2020, 0, 15, 23, 59, 59, 999).getTime())
    const change = screen.getByRole('button', { name: 'Change deadline' }) as HTMLButtonElement
    expect(change.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
  })

  it('says how long until a deadline that has not passed', async () => {
    await setup()
    type('2099-06-01T09:00')
    fireEvent.click(screen.getByRole('button', { name: 'Set deadline' }))
    expect(stateLine().textContent).toMatch(/^01 Jun 2099, 09:00 is in .+\./)
  })

  it('applies the deadline when the form is submitted with Enter', async () => {
    const store = await setup()
    type('2020-01-15T23:59')
    fireEvent.submit(field())
    expect(store.getState().deadline).not.toBeNull()
  })

  it('remembers the applied deadline, not what is still being typed', async () => {
    await setup()
    type('2020-01-15T23:59')
    fireEvent.click(screen.getByRole('button', { name: 'Set deadline' }))
    type('2020-01-16T10:00')
    // Without a sheet the store saves nothing; this only checks the button.
    expect((screen.getByRole('button', { name: 'Change deadline' }) as HTMLButtonElement).disabled).toBe(false)
    expect(stateLine().textContent).toContain('15 Jan 2020, 23:59')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('will not apply a value it cannot read', async () => {
    const store = await setup()
    // A browser with a seconds step sends seconds, which the deadline rule does not accept.
    type('2020-01-15T23:59:30')
    expect(field().value).toBe('2020-01-15T23:59:30')
    expect((screen.getByRole('button', { name: 'Set deadline' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(field())
    expect(store.getState().deadline).toBeNull()
    expect(stateLine().textContent).toContain('No deadline is set')
  })

  it('removes the deadline and empties the box', async () => {
    const store = await setup()
    type('2020-01-15T23:59')
    fireEvent.click(screen.getByRole('button', { name: 'Set deadline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(store.getState().deadline).toBeNull()
    expect(field().value).toBe('')
    expect(stateLine().textContent).toBe('No deadline is set, so the register shows dates only.')
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Set deadline' })).toBeTruthy()
  })
})
