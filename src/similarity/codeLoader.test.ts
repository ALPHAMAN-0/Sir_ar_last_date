import { describe, expect, it } from 'vitest'
import { MAX_BLOBS_PER_CALL, type BlobsResponse, type TreeFile } from '../../shared/api.ts'
import { ApiError } from '../api/client.ts'
import { MAX_BATCH_BYTES, MAX_CODE_FILES, batches, createCodeLoader } from './codeLoader.ts'
import { noSkips } from './rules.ts'
import type { RepoFiles } from './types.ts'

const hex = (n: number) => n.toString(16).padStart(40, '0')

/** A code text of `count` different lines. */
const program = (count: number, name = 'x') =>
  Array.from({ length: count }, (_, i) => `let ${name}${i} = compute(${i}, "${name} ${i}") + offset * ${i + 3};`).join('\n')

function tree(name: string, files: TreeFile[], headOid = hex(9)): RepoFiles {
  return { repo: name, branch: 'main', headOid, files, skipped: noSkips(), unopened: 0 }
}

type Asked = { repo: string; shas: string[] }

/**
 * A fake `/blobs`: `texts` by content hash. A hash in `binary` is a picture;
 * one in `big` makes any answer holding it too large. Every question is noted.
 */
function fakeGet(texts: Record<string, string>, options: { binary?: string[]; big?: string[]; fail?: ApiError } = {}) {
  const asked: Asked[] = []
  const get = async <T,>(url: string): Promise<T> => {
    const params = new URL(url, 'https://app.example').searchParams
    const question = { repo: params.get('repo') ?? '', shas: params.getAll('b') }
    asked.push(question)
    if (options.fail) throw options.fail
    if (question.shas.some((sha) => options.big?.includes(sha))) {
      return { blobs: [], tooLarge: true } satisfies BlobsResponse as T
    }
    const body: BlobsResponse = {
      tooLarge: false,
      blobs: question.shas.map((sha) =>
        options.binary?.includes(sha) ? { sha, skipped: 'binary' } : sha in texts ? { sha, text: texts[sha] } : { sha, skipped: 'missing' },
      ),
    }
    return body as T
  }
  return { get, asked }
}

describe('batches', () => {
  it('asks for each content once, A to Z, so the same repo always asks the same questions', () => {
    const files = [
      { path: 'b.js', sha: hex(2), size: 100 },
      { path: 'a.js', sha: hex(1), size: 100 },
      { path: 'copy/a.js', sha: hex(1), size: 100 },
    ]
    expect(batches(files)).toEqual([[hex(1), hex(2)]])
  })

  it('splits by count and by size, and sends a big file on its own', () => {
    const many = Array.from({ length: MAX_BLOBS_PER_CALL + 1 }, (_, i) => ({ path: `${i}.js`, sha: hex(i + 1), size: 10 }))
    expect(batches(many).map((batch) => batch.length)).toEqual([MAX_BLOBS_PER_CALL, 1])

    const heavy = [
      { path: 'a.js', sha: hex(1), size: MAX_BATCH_BYTES - 10 },
      { path: 'b.js', sha: hex(2), size: 100 },
      { path: 'c.js', sha: hex(3), size: MAX_BATCH_BYTES + 5 },
    ]
    expect(batches(heavy)).toEqual([[hex(1)], [hex(2)], [hex(3)]])
  })
})

describe('createCodeLoader', () => {
  it('reads the code files of a repo and nothing else', async () => {
    const { get, asked } = fakeGet({ [hex(1)]: program(30), [hex(2)]: program(20, 'y') })
    const loader = createCodeLoader(get)
    const repo = await loader.load(
      tree('a/x', [
        { path: 'index.js', sha: hex(1), size: 2000 },
        { path: 'style.css', sha: hex(2), size: 2000 },
        { path: 'README.md', sha: hex(3), size: 2000 },
        { path: 'photo.psd.js', sha: hex(4), size: 999_999 },
      ]),
    )
    expect(asked).toEqual([{ repo: 'a/x', shas: [hex(1), hex(2)] }])
    expect(repo.code.files.map((file) => file.path)).toEqual(['index.js', 'style.css'])
    expect(repo.code.files[0].prints.values.length).toBeGreaterThan(0)
    expect(repo.unread).toBe(0)
  })

  it('counts the code files it could not read: binary, missing, a broken notebook', async () => {
    const { get } = fakeGet({ [hex(1)]: program(30), [hex(3)]: '{ not json' }, { binary: [hex(2)] })
    const repo = await createCodeLoader(get).load(
      tree('a/x', [
        { path: 'a.js', sha: hex(1), size: 100 },
        { path: 'b.js', sha: hex(2), size: 100 },
        { path: 'lab.ipynb', sha: hex(3), size: 100 },
        { path: 'gone.js', sha: hex(4), size: 100 },
      ]),
    )
    expect(repo.code.files.map((file) => file.path)).toEqual(['a.js'])
    expect(repo.unread).toBe(3)
  })

  it('asks again for half as many when an answer is too big, down to one file', async () => {
    const files = [1, 2, 3, 4].map((n) => ({ path: `${n}.js`, sha: hex(n), size: 100 }))
    const { get, asked } = fakeGet(Object.fromEntries(files.map((file) => [file.sha, program(10, `f${file.path}`)])), { big: [hex(4)] })
    const repo = await createCodeLoader(get).load(tree('a/x', files))
    expect(asked.map((question) => question.shas.length)).toEqual([4, 2, 2, 1, 1])
    expect(repo.code.files.map((file) => file.path)).toEqual(['1.js', '2.js', '3.js'])
    expect(repo.unread).toBe(1)
  })

  it('asks once per commit, and not at all for contents another repo already brought', async () => {
    const { get, asked } = fakeGet({ [hex(1)]: program(30) })
    const loader = createCodeLoader(get)
    const files = [{ path: 'a.js', sha: hex(1), size: 100 }]
    await loader.load(tree('a/x', files))
    await loader.load(tree('a/x', files))
    await loader.load(tree('b/y', [{ path: 'lab/a.js', sha: hex(1), size: 100 }]))
    expect(asked).toHaveLength(1)
  })

  it('reads the same content again when another kind of file holds it', async () => {
    // A .css file keeps "//"; a .js file drops it as a comment. So the language is part of the key.
    const { get, asked } = fakeGet({ [hex(1)]: program(30) })
    const loader = createCodeLoader(get)
    await loader.load(tree('a/x', [{ path: 'a.js', sha: hex(1), size: 100 }]))
    await loader.load(tree('b/y', [{ path: 'a.css', sha: hex(1), size: 100 }]))
    expect(asked).toHaveLength(2)
  })

  it('leaves out a repo with more code files than anyone types for a course', async () => {
    const files = Array.from({ length: MAX_CODE_FILES + 1 }, (_, i) => ({ path: `${i}.js`, sha: hex(i + 1), size: 100 }))
    const { get, asked } = fakeGet({})
    const { repos, errors } = await createCodeLoader(get).loadAll(new Map([['a/x', tree('a/x', files)]]))
    expect(asked).toHaveLength(0)
    expect(repos.size).toBe(0)
    expect(errors.get('a/x')?.kind).toBe('too_large')
  })

  it('reports a failure per repo, keeps the others, and does not remember the failure', async () => {
    const failing = fakeGet({}, { fail: new ApiError(404, 'repo_not_found', 'Repo not found.') })
    const loader = createCodeLoader(failing.get)
    const trees = new Map([['a/x', tree('a/x', [{ path: 'a.js', sha: hex(1), size: 100 }])]])
    const first = await loader.loadAll(trees)
    expect(first.errors.get('a/x')?.kind).toBe('not_found')
    expect(first.errors.get('a/x')?.message).toMatch(/no longer shows/)

    const limited = await createCodeLoader(fakeGet({}, { fail: new ApiError(503, 'quota_reserved', 'The shared GitHub limit is used up for this hour.') }).get).loadAll(trees)
    expect(limited.errors.get('a/x')).toEqual({ kind: 'limit', message: 'The shared GitHub limit is used up for this hour.' })
  })

  it('loads every repo, keeps the order of the sheet and says how far it is', async () => {
    const { get } = fakeGet({ [hex(1)]: program(30), [hex(2)]: program(30, 'y') })
    const trees = new Map([
      ['b/y', tree('b/y', [{ path: 'b.js', sha: hex(2), size: 100 }])],
      ['a/x', tree('a/x', [{ path: 'a.js', sha: hex(1), size: 100 }])],
      ['c/z', tree('c/z', [{ path: 'README.md', sha: hex(3), size: 100 }])],
    ])
    const progress: string[] = []
    const { repos } = await createCodeLoader(get).loadAll(trees, (done, total) => progress.push(`${done}/${total}`))
    expect([...repos.keys()]).toEqual(['b/y', 'a/x', 'c/z'])
    expect(repos.get('c/z')?.code.files).toEqual([])
    expect(progress).toEqual(['1/3', '2/3', '3/3'])
  })
})
