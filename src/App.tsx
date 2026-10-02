import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { PersonView } from './components/PersonView.tsx'
import { Register } from './components/Register.tsx'
import { UploadPanel } from './components/UploadPanel.tsx'
import { zoneLabel } from './logic/time.ts'
import { useApp, useRoute } from './state/hooks.ts'

export default function App() {
  const hasSheet = useApp((state) => state.sheet !== null)
  const { rowId } = useRoute()

  return (
    <div className="page">
      <header className="masthead">
        <a className="masthead__title" href="#/">
          <span className="masthead__small">Sir ar</span>
          <span className="masthead__big">Last Date</span>
        </a>
        <p className="masthead__tag">
          A submission register for GitHub repos.
          <br />
          Who pushed in time, who did not, and what changed.
        </p>
      </header>

      <main className="main">
        <ErrorBoundary>
          {!hasSheet ? <UploadPanel /> : rowId ? <PersonView rowId={rowId} /> : <Register />}
        </ErrorBoundary>
      </main>

      <footer className="colophon">
        <p>
          Lateness is judged by the moment GitHub received the push, on the repo's main branch.
          Commit dates are written on the author's own computer and are shown only for reference.
        </p>
        <p>All times are in {zoneLabel()}.</p>
      </footer>
    </div>
  )
}
