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
  treeUrl,
  type TreeResponse,
} from '../../shared/api.ts'
import { ApiError, createClient, type Pause } from '../api/client.ts'
import {
  NO_RULES,
  readRules,
  rulesInput,
  type RuleField,
  type Rules,
  type RulesInput,
} from '../logic/marking.ts'
import { apiRepoName } from '../logic/repoName.ts'
import { judgeTerm, labTasks, TERMS, type ListingState, type Lookup, type Term } from '../logic/termFolder.ts'
import { parseDeadlineInput } from '../logic/time.ts'
import { judge, type ActivityData, type Status, type Verdict } from '../logic/verdict.ts'
import { parseRepoLink, type LinkResult } from '../sheet/parseRepoLink.ts'
import {
  buildRows,
  detectMapping,
  extraHeaders,
  MAX_EXTRA_COLUMNS,
  MAX_FILE_BYTES,
  MAX_ROWS,
  SheetError,
  withExtra,
  type ColumnMapping,
  type SheetData,
  type SheetKind,
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
  kind: SheetKind
  rows: SheetRow[]
  truncated: boolean
  /** Headers of a lab sheet's carried columns, in sheet order. Empty for a project sheet. */
  extraHeaders: string[]
}

/** Whose deadline and rules are in force: the project's, or one term's of a lab sheet. */
export type Scope = 'project' | Term
/** The deadline as typed and put into force, and the rules table, of one scope. */
export type ScopeSettings = { deadlineInput: string; rules: Rules }
const SCOPES: readonly Scope[] = ['project', ...TERMS]

export type AppState = {
  sheet: Sheet | null
  /** Kept only until the page is reloaded; lets the user re-pick the columns. */
  columns: { data: SheetData; mapping: ColumnMapping } | null
  /** What is typed in the deadline box. */
  deadlineInput: string
  /** The deadline in force: last millisecond that counts as on time. */
  deadline: number | null
  deadlineShifted: boolean
  /** The term being marked on a lab sheet. */
  term: Term
  /** The applied deadline and the rules of every scope, kept even while another is shown. */
  settings: Readonly<Record<Scope, ScopeSettings>>
  /** The rules in force, those of the current scope. */
  rules: Rules
  /** What is typed in the rules table. */
  rulesInput: RulesInput
  /** Fields of the rules table whose typed value cannot be used; the rules in force are the last good ones. */
  rulesBad: readonly RuleField[]
  /** Each student's bonus by `scope|student` (see `bonusOf`). */
  bonus: ReadonlyMap<string, number>
  /** One folder level of a repo by `repo@commit-or-folder-hash`, for a lab sheet's term folders. */
  trees: ReadonlyMap<string, ListingState>
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

const STORAGE_KEY = 'sirar:v2'
const DEFAULT_SORT: Sort = { column: 'pushedAt', descending: true }
const SORT_COLUMNS: readonly SortColumn[] = [
  'row', 'id', 'name', 'repo', 'status', 'lateBy', 'createdAt', 'pushedAt', 'committedAt', 'commits',
]
/** Pages of 100 push events. Past this the repo is flagged for a person to look at. */
const MAX_ACTIVITY_PAGES = 5
/** How far the person screen and the download read the push log, so that both find the same first push. */
export const HISTORY_PAGES = 3

/** Bonuses kept at most; far more than any class has students times scopes. */
const MAX_BONUSES = 10_000
/** Large enough for any mark scheme; anything larger in a save was not written by this page. */
const MAX_MARK = 100_000

type Saved = {
  kind: SheetKind
  fileName: string
  sheetName: string
  truncated: boolean
  rows: Array<[rowNumber: number, id: string, name: string, rawLink: string, extra?: string[]]>
  extraHeaders: string[]
  /** The project's applied deadline. Saves made before terms existed hold their only deadline here. */
  deadlineInput: string
  term: Term
  settings: Record<Scope, ScopeSettings>
  bonus: Array<[key: string, value: number]>
  sort: Sort
}

const blankSettings = (): Record<Scope, ScopeSettings> => ({
  project: { deadlineInput: '', rules: NO_RULES },
  mid: { deadlineInput: '', rules: NO_RULES },
  final: { deadlineInput: '', rules: NO_RULES },
})

/** The scope whose deadline and rules are in force for a sheet of this kind. */
const scopeFor = (kind: SheetKind | undefined, term: Term): Scope => (kind === 'lab' ? term : 'project')
const currentScope = (from: AppState = state): Scope => scopeFor(from.sheet?.kind, from.term)

/** The deadline and rules of a scope, as the boxes show them and as they are in force. */
function inForce(settings: Readonly<Record<Scope, ScopeSettings>>, scope: Scope): Partial<AppState> {
  const { deadlineInput, rules } = settings[scope]
  const parsed = deadlineInput ? parseDeadlineInput(deadlineInput) : null
  return {
    deadlineInput: parsed ? deadlineInput : '',
    deadline: parsed?.ms ?? null,
    deadlineShifted: parsed?.shifted ?? false,
    rules,
    rulesInput: rulesInput(rules),
    rulesBad: [],
  }
}

// A save is read back as untrusted: anything of the wrong type is dropped, never used.
const isMark = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_MARK
const asText = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
const asDeadlineInput = (value: unknown): string =>
  typeof value === 'string' && value !== '' && parseDeadlineInput(value) !== null ? value : ''

function asRules(value: unknown): Rules {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const amount = (field: unknown) => (isMark(field) && field >= 0 ? field : 0)
  return {
    total: isMark(raw.total) && raw.total > 0 ? raw.total : null,
    late: amount(raw.late),
    changed: amount(raw.changed),
    noSubmission: amount(raw.noSubmission),
  }
}

function asSettings(saved: Record<string, unknown>, kind: SheetKind): Record<Scope, ScopeSettings> {
  const settings = blankSettings()
  const raw = saved.settings
  if (raw && typeof raw === 'object') {
    for (const scope of SCOPES) {
      const entry = (raw as Record<string, unknown>)[scope]
      if (!entry || typeof entry !== 'object') continue
      const { deadlineInput, rules } = entry as Record<string, unknown>
      settings[scope] = { deadlineInput: asDeadlineInput(deadlineInput), rules: asRules(rules) }
    }
    return settings
  }
  // A save from before terms and the rules table: one deadline, and perhaps the old grading box.
  const grading = (saved.grading && typeof saved.grading === 'object' ? saved.grading : {}) as Record<string, unknown>
  settings[scopeFor(kind, 'mid')] = {
    deadlineInput: asDeadlineInput(saved.deadlineInput),
    rules: asRules({ total: grading.totalMark, late: grading.offForLate, changed: grading.offForChanged }),
  }
  return settings
}

function asBonus(value: unknown): Map<string, number> {
  const bonus = new Map<string, number>()
  if (!Array.isArray(value)) return bonus
  for (const entry of value.slice(0, MAX_BONUSES)) {
    if (!Array.isArray(entry)) continue
    const [key, amount] = entry as unknown[]
    if (typeof key === 'string' && key.length <= 300 && isMark(amount)) bonus.set(key, amount)
  }
  return bonus
}

function restore(): Partial<AppState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const saved = JSON.parse(raw) as Record<string, unknown>
    if (!saved || typeof saved !== 'object') return {}
    const patch: Partial<AppState> = {}
    // Saves before the two uploads had no field (all project sheets), or the old "performance" kind.
    const kind: SheetKind = saved.kind === 'lab' || saved.kind === 'performance' ? 'lab' : 'project'
    if (Array.isArray(saved.rows) && typeof saved.fileName === 'string') {
      const headers =
        kind === 'lab' && Array.isArray(saved.extraHeaders)
          ? saved.extraHeaders.slice(0, MAX_EXTRA_COLUMNS).map(asText)
          : []
      const rows: SheetRow[] = []
      for (const entry of saved.rows.slice(0, MAX_ROWS)) {
        if (!Array.isArray(entry)) continue
        const [rowNumber, id, name, rawLink, extra] = entry as unknown[]
        if (typeof rowNumber !== 'number') continue
        const row: SheetRow = {
          rowId: `r${rowNumber}`,
          rowNumber,
          id: String(id ?? ''),
          name: String(name ?? ''),
          rawLink: String(rawLink ?? ''),
          link: parseRepoLink(String(rawLink ?? '')),
        }
        if (kind === 'lab') {
          const cells = Array.isArray(extra) ? extra : []
          row.extra = headers.map((_, index) => asText(cells[index]))
        }
        rows.push(row)
      }
      patch.sheet = {
        kind,
        fileName: saved.fileName,
        sheetName: String(saved.sheetName ?? ''),
        rows,
        truncated: saved.truncated === true,
        extraHeaders: headers,
      }
    }
    patch.term = TERMS.find((term) => term === saved.term) ?? 'mid'
    patch.settings = asSettings(saved, kind)
    patch.bonus = asBonus(saved.bonus)
    Object.assign(patch, inForce(patch.settings, scopeFor(kind, patch.term)))
    const sort = saved.sort as Partial<Sort> | undefined
    if (sort && typeof sort === 'object' && SORT_COLUMNS.includes(sort.column as SortColumn)) {
      patch.sort = { column: sort.column as SortColumn, descending: sort.descending === true }
    }
    return patch
  } catch {
    return {}
  }
}

function save(): void {
  try {
    if (!state.sheet) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    const saved: Saved = {
      kind: state.sheet.kind,
      fileName: state.sheet.fileName,
      sheetName: state.sheet.sheetName,
      truncated: state.sheet.truncated,
      rows: state.sheet.rows.map((row) =>
        row.extra ? [row.rowNumber, row.id, row.name, row.rawLink, row.extra] : [row.rowNumber, row.id, row.name, row.rawLink],
      ),
      extraHeaders: state.sheet.extraHeaders,
      deadlineInput: state.settings.project.deadlineInput,
      term: state.term,
      settings: state.settings,
      bonus: [...state.bonus],
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
  term: 'mid',
  settings: blankSettings(),
  rules: NO_RULES,
  rulesInput: rulesInput(NO_RULES),
  rulesBad: [],
  bonus: new Map(),
  trees: new Map(),
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
    const activity = state.activity.get(key)
    const verdict = judge({ link: linkFor(key), meta, activity, deadline: state.deadline })
    if (verdict.need === 'activity') void loadActivity(key)
    else if (verdict.need === 'probe') void loadProbe(key)
    else if (sheet.kind === 'lab') {
      // A lab sheet is judged by the term's folder: read the folder listings that judgement asks for,
      // then the term folder itself, for its lab tasks.
      const lookup = treeLookup(state.trees, key)
      const judged = judgeTerm({ verdict, meta, activity, deadline: state.deadline, term: state.term, lookup })
      if (judged.need !== null) void loadTree(key, judged.need)
      else if (judged.folder && lookup(judged.folder.sha) === undefined) void loadTree(key, judged.folder.sha)
    }
  }
}

const treeLookup =
  (trees: ReadonlyMap<string, ListingState>, key: string): Lookup =>
  (sha) =>
    trees.get(`${key}@${sha}`)

const treeLoading = new Set<string>()

/**
 * Reads one folder level of a repo, by commit or folder hash. The answer never
 * changes for a hash, so it is kept until the sheet changes; a failure is kept
 * until Refresh, and shown as "Check failed", never as the student's fault.
 */
async function loadTree(key: string, sha: string): Promise<void> {
  const id = `${key}@${sha}`
  const meta = state.repos.get(key)
  if (state.trees.has(id) || treeLoading.has(id) || !meta || meta.state !== 'ok') return
  treeLoading.add(id)
  let listing: ListingState
  try {
    const answer = await client.get<TreeResponse>(treeUrl({ repo: apiRepoName(meta), sha, flat: true }), 1)
    listing = answer.tooLarge ? 'failed' : { dirs: answer.dirs, files: answer.files }
  } catch {
    listing = 'failed'
  } finally {
    treeLoading.delete(id)
  }
  // Keyed by repo and hash, a late answer is still true; it is only dropped once the sheet is gone.
  if (!state.sheet) return
  set({ trees: new Map(state.trees).set(id, listing) })
  ensure()
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
  treeLoading.clear()
}

function adoptSheet(fileName: string, data: SheetData, chosen: ColumnMapping): void {
  const mapping = withExtra(data.grid, chosen)
  const rows = buildRows(data, mapping)
  resetData()
  const sheet: Sheet = {
    kind: mapping.kind,
    fileName,
    sheetName: data.sheetName,
    rows,
    truncated: data.truncated,
    extraHeaders: extraHeaders(data, mapping),
  }
  set({
    sheet,
    columns: { data, mapping },
    // A sheet of the other kind brings its own deadline and rules.
    ...inForce(state.settings, scopeFor(sheet.kind, state.term)),
    repos: new Map(),
    activity: new Map(),
    trees: new Map(),
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

/**
 * Reads an uploaded file in the browser, as the kind of sheet the teacher chose.
 * The file itself is never sent anywhere.
 */
export async function loadFile(file: File, kind: SheetKind = 'project'): Promise<void> {
  if (file.size > MAX_FILE_BYTES) {
    set({ uploadError: SHEET_ERROR_TEXT.too_big })
    return
  }
  try {
    // The Excel library is large, so it is fetched only when a file is chosen.
    const { readSheet } = await import('../sheet/parseSheet.ts')
    const data = readSheet(await file.arrayBuffer())
    adoptSheet(file.name, data, detectMapping(data.grid, kind))
  } catch (error) {
    const problem = error instanceof SheetError ? error.problem : 'unreadable'
    set({ uploadError: SHEET_ERROR_TEXT[problem] })
  }
}

export function remapColumns(mapping: ColumnMapping): void {
  if (state.columns && state.sheet) {
    adoptSheet(state.sheet.fileName, state.columns.data, { ...mapping, kind: state.sheet.kind })
  }
}

export function clearSheet(): void {
  resetData()
  const settings = blankSettings()
  set({
    sheet: null,
    columns: null,
    repos: new Map(),
    activity: new Map(),
    trees: new Map(),
    checkedAt: null,
    loadingRepos: 0,
    term: 'mid',
    settings,
    ...inForce(settings, 'project'),
    bonus: new Map(),
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
  // A folder listing never changes for its hash; only failed ones are asked for again.
  const trees = new Map([...state.trees].filter(([, listing]) => listing !== 'failed'))
  treeLoading.clear()
  set({ activity, trees, checkedAt: null })
  void loadRepos(sheetKeys(sheet))
}

export function setDeadlineInput(value: string): void {
  set({ deadlineInput: value })
}

/** Puts the typed deadline into force. Done on a button, not on every keystroke. */
export function applyDeadline(): boolean {
  const value = state.deadlineInput
  const scope = currentScope()
  const keep = (deadlineInput: string) => ({
    ...state.settings,
    [scope]: { ...state.settings[scope], deadlineInput },
  })
  if (!value) {
    set({ deadline: null, deadlineShifted: false, settings: keep('') })
    save()
    return true
  }
  const parsed = parseDeadlineInput(value)
  if (!parsed) return false
  set({ deadline: parsed.ms, deadlineShifted: parsed.shifted, settings: keep(value) })
  save()
  ensure()
  return true
}

/**
 * Switches a lab sheet between Mid and Final. Each term keeps its own
 * deadline and rules table, and the rows are judged again by that term's folder.
 */
export function setTerm(term: Term): void {
  if (state.term === term) return
  const scope = scopeFor(state.sheet?.kind, term)
  set({ term, ...(scope === currentScope() ? {} : inForce(state.settings, scope)) })
  save()
  ensure()
}

/**
 * One field of the rules table, in force as it is typed. A value that cannot be
 * used is kept in the box and named in `rulesBad`; the last good rules stay in force.
 */
export function setRuleInput(field: RuleField, text: string): void {
  const input = { ...state.rulesInput, [field]: text }
  const reading = readRules(input)
  if (!reading.ok) {
    set({ rulesInput: input, rulesBad: reading.bad })
    return
  }
  const scope = currentScope()
  set({
    rulesInput: input,
    rulesBad: [],
    rules: reading.rules,
    settings: { ...state.settings, [scope]: { ...state.settings[scope], rules: reading.rules } },
  })
  save()
}

/**
 * Who a bonus belongs to: the student ID when the row has one, so that a
 * re-sorted or updated sheet keeps each bonus with its student; else the sheet row.
 */
export function studentKey(row: SheetRow): string {
  const id = row.id.trim().toLowerCase()
  return id ? `id:${id}` : `row:${row.rowNumber}`
}

/** The bonus of a student in the scope in force, or null when there is none. */
export function bonusOf(row: SheetRow, from: AppState = state): number | null {
  return from.bonus.get(`${currentScope(from)}|${studentKey(row)}`) ?? null
}

/** Sets or, with null, removes a student's bonus in the scope in force. */
export function setBonus(row: SheetRow, value: number | null): void {
  const key = `${currentScope()}|${studentKey(row)}`
  if ((state.bonus.get(key) ?? null) === value) return
  const bonus = new Map(state.bonus)
  if (value === null) bonus.delete(key)
  else if (bonus.size < MAX_BONUSES || bonus.has(key)) bonus.set(key, value)
  set({ bonus })
  save()
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
  /**
   * A lab sheet's term folder at the head commit, and the lab tasks in it.
   * `tasks` is missing while they are being read, null when there are none to read.
   * Missing on a project sheet.
   */
  lab?: { folder: string | null; tasks?: readonly string[] | null }
}

/** A lab sheet's row, judged by the term's folder (termFolder.ts) instead of the whole repo. */
function judgeLabRow(
  person: PersonRow,
  key: string | null,
  deadline: number | null,
  trees: ReadonlyMap<string, ListingState>,
  term: Term,
): PersonRow {
  const lookup: Lookup = key ? treeLookup(trees, key) : () => undefined
  const judged = judgeTerm({ verdict: person.verdict, meta: person.meta, activity: person.activity, deadline, term, lookup })
  const { folder } = judged
  const reading = judged.need !== null || judged.verdict.need !== null || judged.verdict.status === 'checking'
  let lab: PersonRow['lab']
  if (folder) {
    const listing = lookup(folder.sha)
    lab =
      listing === undefined
        ? { folder: folder.path }
        : { folder: folder.path, tasks: listing === 'failed' ? null : labTasks(listing) }
  } else {
    lab = reading ? { folder: null } : { folder: null, tasks: null }
  }
  return { ...person, verdict: judged.verdict, lab }
}

/**
 * One judged entry per sheet row, in sheet order. A lab sheet's rows are judged
 * by the term's folder, from the folder listings read so far.
 */
export function judgeRows(
  sheet: Sheet,
  repos: ReadonlyMap<string, RepoMeta>,
  activity: ReadonlyMap<string, ActivityData>,
  deadline: number | null,
  trees: ReadonlyMap<string, ListingState> = new Map(),
  term: Term = 'mid',
): PersonRow[] {
  const seen = new Map<string, number>()
  for (const row of sheet.rows) {
    if (row.link.ok) seen.set(row.link.key, (seen.get(row.link.key) ?? 0) + 1)
  }
  return sheet.rows.map((row) => {
    const key = row.link.ok ? row.link.key : null
    const meta = key ? repos.get(key) : undefined
    const log = key ? activity.get(key) : undefined
    const person: PersonRow = {
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
    return sheet.kind === 'lab' ? judgeLabRow(person, key, deadline, trees, term) : person
  })
}

/** The same rows as they are now, for code that has waited for something to load. */
export function currentPeople(): PersonRow[] {
  const { sheet, repos, activity, deadline, trees, term } = state
  return sheet ? judgeRows(sheet, repos, activity, deadline, trees, term) : []
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
  if (Object.keys(restored).length > 0) set(restored)
  ensure()
}
