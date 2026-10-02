import { useRef, useState, type DragEvent } from 'react'
import { useApp } from '../state/hooks.ts'
import { loadFile } from '../state/store.ts'

const ACCEPT = '.xlsx,.xls,.csv'

async function downloadSample(): Promise<void> {
  const excel = await import('../sheet/exportXlsx.ts')
  excel.downloadSample()
}

export function UploadPanel() {
  const error = useApp((state) => state.uploadError)
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)

  const open = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    await loadFile(file)
    setBusy(false)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    void open(event.dataTransfer.files[0])
  }

  return (
    <section className="upload">
      <div
        className={`dropzone${dragging ? ' dropzone--over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className="dropzone__step">Step 1</p>
        <h1 className="dropzone__title">Put your sheet on the desk</h1>
        <p className="dropzone__hint">
          Drop an Excel file here, or choose one. It needs three columns: an ID, a name, and a
          link to each person's GitHub repo.
        </p>
        <div className="dropzone__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            {busy ? 'Reading the sheet' : 'Choose a file'}
          </button>
          <button type="button" className="button button--quiet" onClick={() => void downloadSample()}>
            Download a sample sheet
          </button>
        </div>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          accept={ACCEPT}
          aria-label="Choose an Excel or CSV file"
          onChange={(event) => {
            void open(event.target.files?.[0])
            event.target.value = ''
          }}
        />
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
        </figure>
        <ul className="promises">
          <li>
            <strong>The sheet stays with you.</strong> It is read inside this browser. Names and
            IDs are never sent to a server.
          </li>
          <li>
            <strong>Public repos only.</strong> A private or mistyped link is shown as
            “Not found”.
          </li>
          <li>
            <strong>No account needed.</strong> You do not have to log in to GitHub.
          </li>
        </ul>
      </div>
    </section>
  )
}
