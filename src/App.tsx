import { ContributionView } from './components/ContributionView.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { Logo } from './components/Logo.tsx'
import { PerformanceRegister } from './components/PerformanceRegister.tsx'
import { PersonView } from './components/PersonView.tsx'
import { Register } from './components/Register.tsx'
import { SimilarityView } from './components/SimilarityView.tsx'
import { UploadPanel } from './components/UploadPanel.tsx'
import { zoneLabel } from './logic/time.ts'
import { useApp, useRoute } from './state/hooks.ts'

export default function App() {
  const sheet = useApp((state) => state.sheet)
  const hasSheet = sheet !== null
  const kind = sheet?.kind ?? 'project'
  const route = useRoute()

  return (
    <div className="page">
      <header className="masthead">
        <a className="masthead__title" href="#/">
          <Logo className="masthead__logo" />
          <span className="masthead__big">Final Destination</span>
        </a>
        <p className="masthead__tag">
          {kind === 'project'
            ? 'A submission register for GitHub repos. Who pushed in time, who did not, and what changed.'
            : 'A performance register. Marks and grades, with auto deductions for late or changed submissions.'}
          <br />
        </p>
        {hasSheet && kind === 'project' ? (
          <nav className="masthead__nav" aria-label="Tabs">
            <a
              className={`masthead__tab${route.kind === 'register' || route.kind === 'person' ? ' masthead__tab--on' : ''}`}
              href="#/"
            >
              Register
            </a>
            <a
              className={`masthead__tab${route.kind === 'similarity' ? ' masthead__tab--on' : ''}`}
              href="#/s"
            >
              Similarity
            </a>
            <a
              className={`masthead__tab${route.kind === 'contribution' ? ' masthead__tab--on' : ''}`}
              href="#/c"
            >
              Contribution
            </a>
          </nav>
        ) : null}
      </header>

      <main className="main">
        <ErrorBoundary>
          {!hasSheet ? (
            <UploadPanel />
          ) : kind === 'performance' ? (
            <PerformanceRegister />
          ) : route.kind === 'person' ? (
            <PersonView rowId={route.rowId} />
          ) : route.kind === 'similarity' ? (
            <SimilarityView />
          ) : route.kind === 'contribution' ? (
            <ContributionView />
          ) : (
            <Register />
          )}
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
