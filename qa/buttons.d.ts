// Shape of one entry in qa/buttons.json. Kept next to the JSON so the editor
// checks every field, and so the test runner can import the same type.

export type Screen =
  | 'upload'
  | 'single-check'
  | 'register'
  | 'deadline'
  | 'column-picker'
  | 'people-table'
  | 'person'
  | 'timeline'
  | 'similarity'
  | 'error-boundary'

/** What must be true before the runner can find and click this control. */
export type Requires = {
  /** A sheet must be saved in localStorage. */
  hasSheet?: boolean
  /** The app hash must start with this value, e.g. "#/" or "#/p/r2". */
  route?: string
  /** The deadline must be set (any non-null value). */
  hasDeadline?: boolean
  /** A row in the table must have at least one commit; used for "Show files" buttons. */
  hasCommits?: boolean
}

/** What the runner checks after the click. */
export type ExpectedAfter = {
  /** No `console.error` was called during the click. */
  noConsoleError?: boolean
  /** The document still has rendered content (no white-screen crash). */
  stillRendered?: boolean
}

export type ButtonEntry = {
  /** Stable id; one test report line per id. */
  id: string
  /** The visible text the test reads, used in failure messages. */
  label: string
  /** Plain CSS selector (or `text=…` for a clickable whose only label is its text). */
  selector: string
  /** Logical screen; informational, used for grouping in the report. */
  screen: Screen
  requires?: Requires
  expectedAfter?: ExpectedAfter
  /** Clicks to fire before the main click, in order. Used when a control only
   *  appears after another is clicked first (e.g. "Yes, remove" needs "Clear"). */
  preClicks?: string[]
  /** Why this control is in the registry. One short sentence. */
  notes?: string
}

export type ButtonsFile = { buttons: ButtonEntry[] }
