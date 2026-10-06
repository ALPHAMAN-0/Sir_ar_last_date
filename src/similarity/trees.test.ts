import { describe, expect, it } from 'vitest'
import { treeUrl, type TreeDir, type TreeFile, type TreeResponse } from '../../shared/api.ts'
import { ApiError } from '../api/client.ts'
import { createTreeLoader, type Get } from './trees.ts'

const HEAD = 'a'.repeat(40)
const input = (repo = 'octocat/hello-world') => ({ repo, headOid: HEAD, branch: 'main' })

let hashes = 0
const file = (path: string, size = 2000): TreeFile => ({
  path,
  sha: (++hashes).toString(16).padStart(40, '0'),
  size,
})
const dir = (path: string, sha: string): TreeDir => ({ path, sha })
const listing = (files: TreeFile[], dirs: TreeDir[] = []): TreeResponse => ({ files, dirs, tooLarge: false })
const TOO_LARGE: TreeResponse = { files: [], dirs: [], tooLarge: true }

/** A fake request queue: answers come from a map of URL to answer (or to an error to throw). */
function queue(answers: Record<string, TreeResponse | Error | Array<TreeResponse | Error>>) {
  const calls: Array<{ url: string; priority: number | undefined }> = []
  const get = (async (url: string, priority?: number) => {
    calls.push({ url, priority })
    const answer = answers[url]
    const next = Array.isArray(answer) ? (answer.length > 1 ? answer.shift() : answer[0]) : answer
    if (next === undefined) throw new ApiError(404, 'repo_or_sha_not_found', 'Repo or commit not found.')
    if (next instanceof Error) throw next
    return next
  }) as Get
  return { get, calls }
}

describe('load', () => {
  it('asks the Worker once for the whole repo and keeps the files worth comparing', async () => {
    const url = treeUrl({ repo: 'octocat/hello-world', sha: HEAD })
    const { get, calls } = queue({
      [url]: listing([
        file('src/app.js'),
        file('README.md'),
        file('node_modules/react/index.js'),
        file('package-lock.json'),
        file('public/logo.png'),
        file('src/empty.css', 10),
      ]),
    })
    const tree = await createTreeLoader(get).load(input())
    expect(calls).toEqual([{ url, priority: 2 }])
    expect(tree).toMatchObject({ repo: 'octocat/hello-world', branch: 'main', headOid: HEAD, unopened: 0 })
    expect(tree.files.map((f) => f.path)).toEqual(['README.md', 'src/app.js'])
    expect(tree.skipped).toEqual({ thirdParty: 1, tool: 1, binary: 1, tiny: 1 })
  })

  it('asks only once per commit, however often it is called', async () => {
    const { get, calls } = queue({ [treeUrl({ repo: 'octocat/hello-world', sha: HEAD })]: listing([file('a.js')]) })
    const loader = createTreeLoader(get)
    const [first, second] = await Promise.all([loader.load(input()), loader.load(input())])
    await loader.load(input())
    expect(calls).toHaveLength(1)
    expect(second).toBe(first)
  })

  it('asks again after a failure instead of remembering it', async () => {
    const url = treeUrl({ repo: 'octocat/hello-world', sha: HEAD })
    const { get, calls } = queue({ [url]: [new ApiError(502, 'github_error', 'GitHub answered with status 502.'), listing([file('a.js')])] })
    const loader = createTreeLoader(get)
    await expect(loader.load(input())).rejects.toThrow('GitHub answered')
    await expect(loader.load(input())).resolves.toMatchObject({ files: [{ path: 'a.js' }] })
    expect(calls).toHaveLength(2)
  })

  it('waits out "too many requests" by asking again, so a big class finishes by itself', async () => {
    const url = treeUrl({ repo: 'octocat/hello-world', sha: HEAD })
    const limited = new ApiError(429, 'rate_limited', 'Too many requests. Please wait a moment.', { retryAfter: 30 })
    const { get, calls } = queue({ [url]: [limited, limited, listing([file('a.js')])] })
    const tree = await createTreeLoader(get).load(input())
    expect(tree.files).toHaveLength(1)
    expect(calls).toHaveLength(3)
  })

  it('gives up after four rounds of "too many requests"', async () => {
    const url = treeUrl({ repo: 'octocat/hello-world', sha: HEAD })
    const { get, calls } = queue({ [url]: new ApiError(429, 'rate_limited', 'Too many requests.') })
    await expect(createTreeLoader(get).load(input())).rejects.toThrow('Too many requests')
    expect(calls).toHaveLength(4)
  })

  it('does not ask again for errors that waiting cannot fix', async () => {
    const url = treeUrl({ repo: 'octocat/hello-world', sha: HEAD })
    const { get, calls } = queue({ [url]: new ApiError(503, 'quota_reserved', 'The shared GitHub limit is used up for this hour.') })
    await expect(createTreeLoader(get).load(input())).rejects.toThrow('shared GitHub limit')
    expect(calls).toHaveLength(1)
  })

  it('rejects an answer that is not a file list', async () => {
    const url = treeUrl({ repo: 'octocat/hello-world', sha: HEAD })
    const { get } = queue({ [url]: { paths: ['a.js'] } as unknown as TreeResponse })
    await expect(createTreeLoader(get).load(input())).rejects.toThrow('unreadable file list')
  })
})

describe('load: a repo too large to list at once', () => {
  const repo = 'student/todo'
  const url = (sha: string, flat = false) => treeUrl({ repo, sha, flat })
  const FRONT = 'f'.repeat(40)
  const BACK = 'b'.repeat(40)
  const MODULES = 'c'.repeat(40)
  const SRC = 'd'.repeat(40)
  const GIT = 'e'.repeat(40)

  // root/              2 files, too big as a whole
  //   backend/         small: listed in one go
  //   frontend/        too big as a whole (its node_modules)
  //     node_modules/  never opened
  //     src/           small
  //   .github/         never opened
  const answers = {
    [url(HEAD)]: TOO_LARGE,
    [url(HEAD, true)]: listing([file('README.md'), file('package.json')], [dir('backend', BACK), dir('frontend', FRONT), dir('.github', GIT)]),
    [url(BACK)]: listing([file('server.js'), file('routes/todo.js')]),
    [url(FRONT)]: TOO_LARGE,
    [url(FRONT, true)]: listing([file('index.html')], [dir('node_modules', MODULES), dir('src', SRC)]),
    [url(SRC)]: listing([file('App.jsx'), file('components/List.jsx')]),
  }

  it('walks it folder by folder and never opens the folders that are not compared', async () => {
    const { get, calls } = queue(answers)
    const tree = await createTreeLoader(get).load({ repo, headOid: HEAD, branch: 'main' })
    expect(tree.files.map((f) => f.path)).toEqual([
      'README.md',
      'backend/routes/todo.js',
      'backend/server.js',
      'frontend/index.html',
      'frontend/src/App.jsx',
      'frontend/src/components/List.jsx',
      'package.json',
    ])
    expect(tree.unopened).toBe(2)
    const asked = calls.map((call) => call.url)
    expect(asked).toHaveLength(6)
    expect(asked.some((u) => u.includes(MODULES))).toBe(false)
    expect(asked.some((u) => u.includes(GIT))).toBe(false)
  })

  it('reports the repo as too large when one folder alone cannot be listed', async () => {
    const { get } = queue({ ...answers, [url(FRONT, true)]: TOO_LARGE })
    const { trees, errors } = await createTreeLoader(get).loadAll([{ repo, headOid: HEAD, branch: 'main' }])
    expect(trees.size).toBe(0)
    expect(errors.get(repo)).toEqual({ kind: 'too_large', message: 'This repo has too many files to list.' })
  })

  it('stops walking one repo after 40 folder requests', async () => {
    // Every folder holds one more folder that is too big to list in one go.
    const calls: string[] = []
    const get = (async (requestUrl: string) => {
      calls.push(requestUrl)
      if (!requestUrl.endsWith('flat=1')) return TOO_LARGE
      return listing([file('x.js')], [dir('deeper', (calls.length + 1).toString(16).padStart(40, '0'))])
    }) as Get
    const { errors } = await createTreeLoader(get).loadAll([{ repo, headOid: HEAD, branch: 'main' }])
    expect(errors.get(repo)?.kind).toBe('too_large')
    // The first request for the whole repo, then 40 for its folders.
    expect(calls.length).toBe(41)
  })
})

describe('loadAll', () => {
  const urlOf = (repo: string) => treeUrl({ repo, sha: HEAD })

  it('loads every repo, keeps sheet order, and reports progress', async () => {
    const { get } = queue({
      [urlOf('a/one')]: listing([file('a.js')]),
      [urlOf('b/two')]: listing([file('b.js')]),
      [urlOf('c/three')]: listing([file('c.js')]),
    })
    const progress: Array<[number, number]> = []
    const { trees, errors } = await createTreeLoader(get).loadAll(
      [input('c/three'), input('a/one'), input('b/two')],
      (done, total) => progress.push([done, total]),
    )
    expect([...trees.keys()]).toEqual(['c/three', 'a/one', 'b/two'])
    expect(errors.size).toBe(0)
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]])
  })

  it('asks once for a repo that is listed twice', async () => {
    const { get, calls } = queue({ [urlOf('a/one')]: listing([file('a.js')]) })
    const { trees } = await createTreeLoader(get).loadAll([input('a/one'), input('a/one')])
    expect(trees.size).toBe(1)
    expect(calls).toHaveLength(1)
  })

  it('keeps going when one repo fails, and says why in plain words', async () => {
    const { get } = queue({
      [urlOf('a/ok')]: listing([file('a.js')]),
      [urlOf('c/limit')]: new ApiError(503, 'quota_reserved', 'The shared GitHub limit is used up for this hour.'),
      [urlOf('d/down')]: new ApiError(0, 'network', 'No connection to the server.'),
      [urlOf('e/slow')]: new ApiError(429, 'rate_limited', 'Too many requests. Please wait a moment.'),
      [urlOf('f/odd')]: new Error('boom'),
    })
    const { trees, errors } = await createTreeLoader(get).loadAll(
      ['a/ok', 'b/gone', 'c/limit', 'd/down', 'e/slow', 'f/odd'].map(input),
    )
    expect([...trees.keys()]).toEqual(['a/ok'])
    expect(Object.fromEntries(errors)).toEqual({
      'b/gone': { kind: 'not_found', message: 'GitHub no longer shows this repo. It may be private or deleted now.' },
      'c/limit': { kind: 'limit', message: 'The shared GitHub limit is used up for this hour.' },
      'd/down': { kind: 'unavailable', message: 'No connection to the server.' },
      'e/slow': { kind: 'limit', message: 'Too many requests for now. Press Try again in a minute.' },
      'f/odd': { kind: 'unavailable', message: 'The file list could not be loaded.' },
    })
  })

  it('returns empty maps for no input', async () => {
    const { get, calls } = queue({})
    const { trees, errors } = await createTreeLoader(get).loadAll([])
    expect(trees.size).toBe(0)
    expect(errors.size).toBe(0)
    expect(calls).toHaveLength(0)
  })
})
