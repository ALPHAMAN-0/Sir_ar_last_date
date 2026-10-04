// Page-side glue: given the repos from the store and a fetcher
// configuration, fetch every tree (from trees.ts) and then run the
// comparison (from compare.worker.ts). Returns the pairs and any
// per-repo errors so the UI can show them.

import type { RepoOk } from '../../shared/api.ts'
import { compareAll } from './compare.ts'
import { fetchAll, type FetchAllOptions, type FetchAllResult, type TreeError } from './trees.ts'
import type { FileTree, Pair } from './types.ts'

export type RunOptions = FetchAllOptions & {
  /**
   * Inject a different comparison strategy. Defaults to running
   * compareAll on a Web Worker; tests inject the in-thread function.
   */
  compare?: (trees: Map<string, FileTree>) => Pair[]
}

export type RunResult = {
  pairs: Pair[]
  errors: Map<string, TreeError>
  trees: Map<string, FileTree>
}

/** Repos in the wrong state can't be compared (no head, not public, etc.). */
export function comparableRepos(repos: readonly RepoOk[]): RepoOk[] {
  return repos.filter((repo) => repo.headOid !== null && repo.defaultBranch !== null)
}

/** Builds the inputs that `fetchAll` wants. */
export function treeInputs(repos: readonly RepoOk[]): Array<{ repo: string; headOid: string; branch: string }> {
  return repos.map((repo) => ({
    repo: repo.key,
    headOid: repo.headOid as string,
    branch: repo.defaultBranch as string,
  }))
}

const defaultCompare = (trees: Map<string, FileTree>): Pair[] => compareAll(trees)

/**
 * End-to-end: fetch every tree, then compare. The two steps are kept
 * distinct so it can stream progress ("fetching 12 / 28") before
 * ("comparing 378 pairs").
 */
export async function runComparison(repos: readonly RepoOk[], options: RunOptions = {}): Promise<RunResult> {
  const { compare = defaultCompare, ...fetchOptions } = options
  const inputs = treeInputs(comparableRepos(repos))
  const fetchResult: FetchAllResult = await fetchAll(inputs, fetchOptions)
  const pairs = compare(fetchResult.trees)
  return { pairs, errors: fetchResult.errors, trees: fetchResult.trees }
}