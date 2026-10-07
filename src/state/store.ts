// The page's single source of truth: the uploaded sheet, the deadline, and
// everything fetched about each repo. Components read it through hooks.ts.

import {
  activityUrl,
  MAX_REPOS_PER_CALL,
  reposUrl,
  statusUrl,
  type ActivityEvent,
  type ActivityResponse,
  type RepoMeta,
  type RepoOk,
  type ReposResponse,
  type StatusResponse,
} from '../../shared/api.ts'
import { ApiError, createClient, type Pause } from '../api/client.ts'
import { apiRepoName } from '../logic/repoName.ts'
import { parseDeadlineInput } from '../logic/time.ts'
import { judge, type ActivityData, type Status, type Verdict } from '../logic/verdict.ts'
import { parseRepoLink, type LinkResult } from '../sheet/parseRepoLink.ts'
import {
  buildRows,
  detectMapping,
  MAX_FILE_BYTES,
  MAX_ROWS,
  SheetError,
  type ColumnMapping,
  type SheetData,
  type SheetRow,
} from '../sheet/columns.ts'

export type SortColumn =
  | 'row'
  | 'id'
  | 'name'
  | 'repo'
  | 'status'
  | 'lateBy'
  | 'createdAt'
  | 'pushedAt'
  | 'committedAt'
  | 'commits'
export type Sort = { column: SortColumn; descending: boolean }

export type Sheet = {
  fileName: string
  sheetName: string
  rows: SheetRow[]
  truncated: boolean
}

export type AppState = {
  sheet: Sheet | null
  /** Kept only until the page is reloaded; lets the user re-pick the columns. */
  columns: { data: SheetData; mapping: ColumnMapping } | null
  /** What is typed in the deadline box. */
  deadlineInput: string
  /** The deadline in force: last millisecond that counts as on time. */
  deadline: number | null
  deadlineShifted: boolean
  repos: ReadonlyMap<string, RepoMeta>
  activity: ReadonlyMap<string, ActivityData>
  /** Oldest fetch time among the repo facts currently shown. */
  checkedAt: number | null
  loadingRepos: number
  pause: Pause | null
  quota: StatusResponse | null
  sort: Sort
  statusFilter: Status | 'all'
  search: string
  uploadError: string | null
}

const STORAGE_KEY = 'sirar:v1'
const DEFAULT_SORT: Sort = { column: 'pushedAt', descending: true }
const SORT_COLUMNS: readonly SortColumn[] = [
  'row', 'id', 'name', 'repo', 'status', 'lateBy', 'createdAt', 'pushedAt', 'committedAt', 'commits',
]
/** Pages of 100 push events. Past this the repo is flagged for a person to look at. */
const MAX_ACTIVITY_PAGES = 5
/** How far the person screen and the download read the push log, so that both find the same first push. */
export const HISTORY_PAGES = 3

type Saved = {
  fileName: string
  sheetName: string
  truncated: boolean
  rows: Array<[rowNumber: number, id: string, name: string, rawLink: string]>
  deadlineInput: string
  sort: Sort
}

function restore(): Partial<AppState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const saved = JSON.parse(raw) as Partial<Saved>
    const patch: Partial<AppState> = {}
    if (Array.isArray(saved.rows) && typeof saved.fileName === 'string') {
      const rows: SheetRow[] = []
      for (const entry of saved.rows.slice(0, MAX_ROWS)) {
        if (!Array.isArray(entry)) continue
        const [rowNumber, id, name, rawLink] = entry
        if (typeof rowNumber !== 'number') continue
        rows.push({
          rowId: `r${rowNumber}`,
          rowNumber,
          id: String(id ?? ''),
          name: String(name ?? ''),
          rawLink: String(rawLink ?? ''),
          link: parseRepoLink(String(rawLink ?? '')),
        })
      }
      patch.sheet = {
        fileName: saved.fileName,
        sheetName: String(saved.sheetName ?? ''),
        rows,
        truncated: saved.truncated === true,
      }
    }
    if (typeof saved.deadlineInput === 'string' && saved.deadlineInput) {
      const parsed = parseDeadlineInput(saved.deadlineInput)
      if (parsed) {
        patch.deadlineInput = saved.deadlineInput
        patch.deadline = parsed.ms
        patch.deadlineShifted = parsed.shifted
      }
    }
    if (saved.sort && SORT_COLUMNS.includes(saved.sort.column)) {
      patch.sort = { column: saved.sort.column, descending: saved.sort.descending === true }
    }
    return patch
  } catch {
    return {}
  }
}

let appliedDeadlineInput = ''

function save(): void {
  try {
    if (!state.sheet) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    const saved: Saved = {
      fileName: state.sheet.fileName,
      sheetName: state.sheet.sheetName,
      truncated: state.sheet.truncated,
      rows: state.sheet.rows.map((row) => [row.rowNumber, row.id, row.name, row.rawLink]),
      deadlineInput: appliedDeadlineInput,
      sort: state.sort,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Storage can be full or blocked. The page still works, it just forgets on reload.
  }
}

let state: AppState = {
  sheet: null,
  columns: null,
  deadlineInput: '',
  deadline: null,
  deadlineShifted: false,
  repos: new Map(),
  activity: new Map(),
  checkedAt: null,
  loadingRepos: 0,
  pause: null,
  quota: null,
  sort: DEFAULT_SORT,
  statusFilter: 'all',
  search: '',
  uploadError: null,
}

const listeners = new Set<() => void>()
export const getState = (): AppState => state
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export const client = createClient({ concurrency: 6, onPause: (pause) => set({ pause }) })

// Bookkeeping that the screen does not need to see.
type ActivityJob = {
  v: string
  next: string | null | undefined
  pages: number
  /** The furthest page anybody asked for. A load under way reads on to it. */
  wanted: number
  /** The load under way, so that a second caller can wait for it. */
  loading: Promise<void> | null
  probing: boolean
}
const repoLoading = new Set<string>()
const activityJobs = new Map<string, ActivityJob>()
/** Bumped whenever the sheet changes, so late answers for an old sheet are dropped. */
let generation = 0

function sheetKeys(sheet: Sheet): string[] {
  const keys = new Set<string>()
  for (const row of sheet.rows) if (row.link.ok) keys.add(row.link.key)
  return [...keys].sort()
}

const linkFor = (key: string): LinkResult => ({ ok: true, owner: '', repo: '', key })

/** Starts whatever downloads the current sheet and deadline still need. */
function ensure(): void {
  const sheet = state.sheet
  if (!sheet) return
  const keys = sheetKeys(sheet)
  const missing = keys.filter((key) => !state.repos.has(key) && !repoLoading.has(key))
  if (missing.length > 0) void loadRepos(missing)

  for (const key of keys) {
    const meta = state.repos.get(key)
    if (!meta || meta.state !== 'ok') continue
    const { need } = judge({
      link: linkFor(key),
      meta,
      activity: state.activity.get(key),
      deadline: state.deadline,
    })
    if (need === 'activity') void loadActivity(key)
    else if (need === 'probe') void loadProbe(key)
  }
}

const NO_SPLIT = new Set(['quota_reserved', 'rate_limited', 'github_throttled', 'misconfigured', 'github_auth'])

async function loadChunk(keys: string[], gen: number): Promise<void> {
  try {
    const response = await client.get<ReposResponse>(reposUrl(keys), 0)
    if (gen !== generation) return
    const repos = new Map(state.repos)
    const activity = new Map(state.activity)
    for (const meta of response.repos) {
      repos.set(meta.key, meta)
      // A new push makes the stored push log out of date.
      const job = activityJobs.get(meta.key)
      const version = meta.state === 'ok' ? (meta.pushedAt ?? meta.createdAt) : null
      if (job && job.v !== version) {
        activityJobs.delete(meta.key)
        activity.delete(meta.key)
      }
    }
    const fetchedAt = Date.parse(response.fetchedAt)
    set({
      repos,
      activity,
      checkedAt: state.checkedAt === null ? fetchedAt : Math.min(state.checkedAt, fetchedAt),
    })
  } catch (error) {
    if (gen !== generation) return
    const code = error instanceof ApiError ? error.code : 'network'
    // One slow repo can sink a whole batch, so split it and try the halves.
    if (keys.length > 1 && !NO_SPLIT.has(code)) {
      const half = Math.ceil(keys.length / 2)
      await Promise.all([loadChunk(keys.slice(0, half), gen), loadChunk(keys.slice(half), gen)])
      return
    }
    const repos = new Map(state.repos)
    for (const key of keys) repos.set(key, { key, state: 'error', code })
    set({ repos })
  }
}

async function loadRepos(keys: string[]): Promise<void> {
  const gen = generation
  for (const key of keys) repoLoading.add(key)
  set({ loadingRepos: repoLoading.size })

  const chunks: string[][] = []
  for (let i = 0; i < keys.length; i += MAX_REPOS_PER_CALL) {
    chunks.push(keys.slice(i, i + MAX_REPOS_PER_CALL))
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      await loadChunk(chunk, gen)
      if (gen !== generation) return
      for (const key of chunk) repoLoading.delete(key)
      set({ loadingRepos: repoLoading.size })
      ensure()
    }),
  )
  if (gen === generation) void loadQuota()
}

async function loadQuota(): Promise<void> {
  try {
    set({ quota: await client.get<StatusResponse>(statusUrl(), 3) })
  } catch {
    // The quota display is a nicety; the page works without it.
  }
}

function putActivity(key: string, patch: Partial<ActivityData>): void {
  const previous = state.activity.get(key)
  const activity = new Map(state.activity)
  activity.set(key, {
    events: [],
    exhausted: false,
    capped: false,
    settled: true,
    probe: null,
    failed: false,
    ...previous,
    ...patch,
  })
  set({ activity })
}

function activityJob(key: string, meta: RepoOk): ActivityJob {
  const v = meta.pushedAt ?? meta.createdAt
  let job = activityJobs.get(key)
  if (!job || job.v !== v) {
    job = { v, next: undefined, pages: 0, wanted: 0, loading: null, probing: false }
    activityJobs.set(key, job)
  }
  return job
}

/**
 * Loads the push log of the default branch, newest first, until it reaches
 * the deadline (or `minPages`, for the person screen and the download), the
 * end, or the limit. The promise settles when the log has been read that far,
 * also for a caller that arrives while it is being read.
 */
export function loadActivity(key: string, minPages = 1): Promise<void> {
  const meta = state.repos.get(key)
  if (!meta || meta.state !== 'ok' || !meta.defaultBranch) return Promise.resolve()
  const job = activityJob(key, meta)
  job.wanted = Math.max(job.wanted, minPages)
  if (!job.loading) {
    const run: Promise<void> = readActivity(key, apiRepoName(meta), meta.defaultBranch, job).then((finished) => {
      // Refresh lets go of a load under way, and another may have begun since.
      if (job.loading === run) job.loading = null
      if (finished) ensure()
    })
    job.loading = run
  }
  return job.loading
}

/** Answers false when the sheet or the repo changed meanwhile, and the pages read are dropped. */
async function readActivity(key: string, repo: string, branch: string, job: ActivityJob): Promise<boolean> {
  const gen = generation
  let events: ActivityEvent[] = state.activity.get(key)?.events ?? []
  let settled = state.activity.get(key)?.settled ?? true

  try {
    while (job.next !== null && job.pages < MAX_ACTIVITY_PAGES) {
      const deadline = state.deadline
      const reachesDeadline =
        deadline === null || events.some((event) => Date.parse(event.ts) <= deadline)
      if (job.pages >= job.wanted && reachesDeadline) break

      const page = await client.get<ActivityResponse>(
        activityUrl({ repo, v: job.v, ref: branch, after: job.next ?? undefined }),
        1,
      )
      if (gen !== generation || activityJobs.get(key) !== job) return false
      events = [...events, ...page.events]
      settled = page.settled
      job.next = page.next
      job.pages++
    }
    putActivity(key, {
      events,
      settled,
      exhausted: job.next === null,
      capped: job.next !== null && job.pages >= MAX_ACTIVITY_PAGES,
      failed: false,
    })
  } catch {
    if (gen !== generation || activityJobs.get(key) !== job) return false
    putActivity(key, { events, failed: true })
  }
  return true
}

/** Loads the oldest events on any branch: "was anything on GitHub by the deadline?" */
async function loadProbe(key: string): Promise<void> {
  const meta = state.repos.get(key)
  if (!meta || meta.state !== 'ok') return
  const job = activityJob(key, meta)
  if (job.probing) return
  job.probing = true
  const gen = generation
  try {
    const page = await client.get<ActivityResponse>(
      activityUrl({ repo: apiRepoName(meta), v: job.v, asc: true }),
      1,
    )
    if (gen !== generation || activityJobs.get(key) !== job) return
    putActivity(key, { probe: page.events })
  } catch {
    if (gen !== generation || activityJobs.get(key) !== job) return
    putActivity(key, { probe: [], failed: true })
  } finally {
    job.probing = false
  }
  ensure()
}

function resetData(): void {
  generation++
  repoLoading.clear()
  activityJobs.clear()
}

function adoptSheet(fileName: string, data: SheetData, mapping: ColumnMapping): void {
  const rows = buildRows(data, mapping)
  resetData()
  set({
    sheet: { fileName, sheetName: data.sheetName, rows, truncated: data.truncated },
    columns: { data, mapping },
    repos: new Map(),
    activity: new Map(),
    checkedAt: null,
    loadingRepos: 0,
    statusFilter: 'all',
    search: '',
    uploadError: null,
  })
  save()
  ensure()
}

const SHEET_ERROR_TEXT = {
  too_big: 'This file is larger than 5 MB. Please upload a smaller sheet.',
  unreadable: 'This file could not be read. Please upload an Excel (.xlsx, .xls) or CSV file.',
  empty: 'This sheet is empty.',
} as const

/** Reads an uploaded file in the browser. The file itself is never sent anywhere. */
export async function loadFile(file: File): Promise<void> {
  if (file.size > MAX_FILE_BYTES) {
    set({ uploadError: SHEET_ERROR_TEXT.too_big })
    return
  }
  try {
    // The Excel library is large, so it is fetched only when a file is chosen.
    const { readSheet } = await import('../sheet/parseSheet.ts')
    const data = readSheet(await file.arrayBuffer())
    adoptSheet(file.name, data, detectMapping(data.grid))
  } catch (error) {
    const problem = error instanceof SheetError ? error.problem : 'unreadable'
    set({ uploadError: SHEET_ERROR_TEXT[problem] })
  }
}

export function remapColumns(mapping: ColumnMapping): void {
  if (state.columns && state.sheet) adoptSheet(state.sheet.fileName, state.columns.data, mapping)
}

export function clearSheet(): void {
  resetData()
  appliedDeadlineInput = ''
  set({
    sheet: null,
    columns: null,
    repos: new Map(),
    activity: new Map(),
    checkedAt: null,
    loadingRepos: 0,
    deadlineInput: '',
    deadline: null,
    deadlineShifted: false,
    statusFilter: 'all',
    search: '',
    uploadError: null,
  })
  save()
}

/** Fetches every repo again. Old values stay on screen until the new ones arrive. */
export function refresh(): void {
  const sheet = state.sheet
  if (!sheet) return
  generation++
  repoLoading.clear()
  // Failed or still-settling push logs are thrown away so they are fetched again.
  const activity = new Map(state.activity)
  for (const [key, data] of activity) {
    if (data.failed || !data.settled) {
      activity.delete(key)
      activityJobs.delete(key)
    }
  }
  for (const job of activityJobs.values()) {
    job.loading = null
    job.probing = false
  }
  set({ activity, checkedAt: null })
  void loadRepos(sheetKeys(sheet))
}

export function setDeadlineInput(value: string): void {
  set({ deadlineInput: value })
}

/** Puts the typed deadline into force. Done on a button, not on every keystroke. */
export function applyDeadline(): boolean {
  const value = state.deadlineInput
  if (!value) {
    appliedDeadlineInput = ''
    set({ deadline: null, deadlineShifted: false })
    save()
    return true
  }
  const parsed = parseDeadlineInput(value)
  if (!parsed) return false
  appliedDeadlineInput = value
  set({ deadline: parsed.ms, deadlineShifted: parsed.shifted })
  save()
  ensure()
  return true
}

export function setSort(column: SortColumn): void {
  const same = state.sort.column === column
  // Dates and counts are most useful newest/largest first; text reads best A to Z.
  const startsDescending = ['pushedAt', 'createdAt', 'committedAt', 'commits', 'lateBy'].includes(column)
  set({ sort: { column, descending: same ? !state.sort.descending : startsDescending } })
  save()
}

export function setStatusFilter(statusFilter: Status | 'all'): void {
  set({ statusFilter })
}

export function setSearch(search: string): void {
  set({ search })
}

export type PersonRow = {
  row: SheetRow
  meta: RepoMeta | undefined
  activity: ActivityData | undefined
  verdict: Verdict
}

/** One judged entry per sheet row, in sheet order. */
export function judgeRows(
  sheet: Sheet,
  repos: ReadonlyMap<string, RepoMeta>,
  activity: ReadonlyMap<string, ActivityData>,
  deadline: number | null,
): PersonRow[] {
  const seen = new Map<string, number>()
  for (const row of sheet.rows) {
    if (row.link.ok) seen.set(row.link.key, (seen.get(row.link.key) ?? 0) + 1)
  }
  return sheet.rows.map((row) => {
    const key = row.link.ok ? row.link.key : null
    const meta = key ? repos.get(key) : undefined
    const log = key ? activity.get(key) : undefined
    return {
      row,
      meta,
      activity: log,
      verdict: judge({
        link: row.link,
        meta,
        activity: log,
        deadline,
        duplicate: key !== null && (seen.get(key) ?? 0) > 1,
      }),
    }
  })
}

/** The same rows as they are now, for code that has waited for something to load. */
export function currentPeople(): PersonRow[] {
  const { sheet, repos, activity, deadline } = state
  return sheet ? judgeRows(sheet, repos, activity, deadline) : []
}

/** One repo as it is now, whoever handed it in. */
export function repoFacts(key: string): Pick<PersonRow, 'meta' | 'activity' | 'verdict'> {
  const meta = state.repos.get(key)
  const activity = state.activity.get(key)
  return { meta, activity, verdict: judge({ link: linkFor(key), meta, activity, deadline: state.deadline }) }
}

/** Called once when the page starts. */
export function start(): void {
  const restored = restore()
  appliedDeadlineInput = restored.deadlineInput ?? ''
  if (Object.keys(restored).length > 0) set(restored)
  ensure()
}
