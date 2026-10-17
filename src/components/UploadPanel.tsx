import { useRef, useState, type DragEvent } from 'react'
import type { SheetKind } from '../sheet/columns.ts'
import { useApp } from '../state/hooks.ts'
import { loadFile } from '../state/store.ts'
import { SingleCheck } from './SingleCheck.tsx'

const ACCEPT = '.xlsx,.xls,.csv'

async function downloadSample(kind: SheetKind): Promise<void> {
  const excel = await import('../sheet/exportXlsx.ts')
  excel.downloadSample(kind)
}

type Card = {
  kind: SheetKind
  title: string
  lead: string
  detail: string
  columns: string[]
  folders?: string[]
}

/** The two kinds of marking the teacher can choose between, each with its own upload. */
const CARDS: readonly Card[] = [
  {
    kind: 'project',
    title: 'Project base',
    lead: 'One repo per student and one deadline.',
    detail: 'Everything pushed to the repo is judged against the deadline.',
    columns: ['id', 'name', 'repolink'],
  },
  {
    kind: 'lab',
    title: 'Lab / Performance base',
    lead: 'One repo per student, with a Mid folder and a Final folder of lab tasks.',
    detail: 'Each term is judged by its own folder and its own deadline. Other columns, such as earlier marks, are kept.',
    columns: ['id', 'name', 'repolink', 'Lab 1…'],
    folders: ['Mid/', 'Final/'],
  },
]

function UploadCard({
  card,
  busy,
  onFile,
}: {
  card: Card
  busy: SheetKind | null
  onFile: (file: File | undefined, kind: SheetKind) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const heading = `upload-${card.kind}`

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    onFile(event.dataTransfer.files[0], card.kind)
  }

  return (
    <section
      className={`upload-card upload-card--${card.kind}${over ? ' upload-card--over' : ''}`}
      aria-labelledby={heading}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <h2 id={heading} className="upload-card__title">
        {card.title}
      </h2>
      <p className="upload-card__lead">{card.lead}</p>
      <p className="upload-card__detail">{card.detail}</p>
      <dl className="upload-card__needs">
        <div>
          <dt>Columns</dt>
          <dd>
            {card.columns.map((column) => (
              <code key={column}>{column}</code>
            ))}
          </dd>
        </div>
        {card.folders ? (
          <div>
            <dt>In each repo</dt>
            <dd>
              {card.folders.map((folder) => (
                <code key={folder}>{folder}</code>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="upload-card__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => input.current?.click()}
          disabled={busy !== null}
        >
          {busy === card.kind ? 'Reading the sheet' : 'Choose a file'}
        </button>
        <button type="button" className="button button--quiet" onClick={() => void downloadSample(card.kind)}>
          Download a sample sheet
        </button>
      </div>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept={ACCEPT}
        aria-label={`Choose a ${card.title} sheet`}
        onChange={(event) => {
          onFile(event.target.files?.[0], card.kind)
          event.target.value = ''
        }}
      />
    </section>
  )
}

export function UploadPanel() {
  const error = useApp((state) => state.uploadError)
  const [busy, setBusy] = useState<SheetKind | null>(null)

  const open = async (file: File | undefined, kind: SheetKind) => {
    if (!file) return
    setBusy(kind)
    await loadFile(file, kind)
    setBusy(null)
  }

  return (
    <section className="upload">
      <div className="upload__main">
        <p className="dropzone__step">Step 1</p>
        <h1 className="dropzone__title">Put your sheet on the desk</h1>
        <p className="dropzone__hint">
          Choose how you mark, then drop an Excel file on that card or choose one.
        </p>
        <div className="upload__cards">
          {CARDS.map((card) => (
            <UploadCard key={card.kind} card={card} busy={busy} onFile={(file, kind) => void open(file, kind)} />
          ))}
        </div>
        {error ? (
          <p className="notice notice--bad" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="upload__side">
        <figure className="specimen">
          <figcaption>How the sheet should look</figcaption>
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>name</th>
                <th>repolink</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>20-41234-1</td>
                <td>Rahim Uddin</td>
                <td>https://github.com/rahim/task-1</td>
              </tr>
              <tr>
                <td>20-41235-1</td>
                <td>Karim Hasan</td>
                <td>github.com/karim/task-1</td>
              </tr>
            </tbody>
          </table>
          <p className="specimen__note">
            A lab sheet may have more columns after these, such as Lab 1 and Lab 2 marks. They are
            kept as they are and written into the report.
          </p>
        </figure>
        <ul className="promises">
          <li>
            <strong>The sheet stays with you.</strong> It is read inside this browser. Names, IDs
            and marks are never sent to a server.
          </li>
          <li>
            <strong>Public repos only.</strong> A private or mistyped link is shown as
            “Not found”.
          </li>
          <li>
            <strong>No account needed.</strong> You do not have to log in to GitHub.
          </li>
        </ul>
        <SingleCheck />
      </div>
    </section>
  )
}
