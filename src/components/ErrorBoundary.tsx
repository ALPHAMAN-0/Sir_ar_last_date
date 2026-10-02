import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

/** If a screen breaks, show a way back instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('The page hit an unexpected error:', error)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <section className="empty" role="alert">
        <p>Something went wrong while showing this screen. Your sheet is still saved.</p>
        <p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              window.location.hash = '#/'
              window.location.reload()
            }}
          >
            Reload the register
          </button>
        </p>
      </section>
    )
  }
}
