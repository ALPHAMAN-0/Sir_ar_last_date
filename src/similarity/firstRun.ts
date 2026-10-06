// Decides which pairs are checked for who had the files first, reads what
// that needs, and keeps the cost inside a budget.
//
// What is read belongs to a repo, not to a pair: a repo that sits in five
// pairs is read once. The strong pairs are checked by themselves; a weak pair
// is checked when its row is opened, because weak pairs can involve half the
// class and nobody may ever look at them.

import {
  arrivalOf,
  judgePair,
  originOf,
  pairKey,
  sharedBlobs,
  type Commits,
  type PairEvidence,
  type RepoHistory,
  type Rival,
  type SharedBlob,
} from './first.ts'
import { MAX_SNAPSHOTS_PER_REPO, type Allowance, type HistoryLoader } from './history.ts'
import type { RepoFacts } from './run.ts'
import type { PairSummary, RepoFiles, Tier } from './types.ts'

/** File lists one comparison may ask for by itself, on top of one per repo. */
export const AUTO_SNAPSHOT_BUDGET = 300
/** File lists one opened row may ask for: both of its repos, read to their limit, and some for others. */
export const OPEN_SNAPSHOT_BUDGET = 3 * MAX_SNAPSHOTS_PER_REPO
/** Repos read at the same time. Each is read push by push, one request after the other. */
const REPOS_AT_ONCE = 3

/** Pairs worth the requests without anybody asking. */
const AUTO_TIERS: ReadonlySet<Tier> = new Set<Tier>(['almost_all', 'most', 'part'])

export type FirstState =
  /** Not checked. Opening the row checks it. */
  | { state: 'waiting' }
  | { state: 'checking' }
  | { state: 'ready'; evidence: PairEvidence }

export type FirstStates = ReadonlyMap<string, FirstState>
/** Repos read so far, of those that have to be read. */
export type FirstProgress = { done: number; total: number }

export type FirstInput = {
  /** Pairs of different repos, strongest first. */
  pairs: readonly PairSummary[]
  /** The compared file lists, by repo. */
  trees: ReadonlyMap<string, RepoFiles>
  facts: ReadonlyMap<string, RepoFacts>
  /** Contents so widespread that they are not counted. */
  starter: ReadonlySet<string>
}

export type FirstRun = {
  /** Checks a pair that is still waiting. Does nothing for any other. */
  open(key: string): void
  /** Late answers are dropped from here on. */
  stop(): void
}

export type FirstDeps = {
  history: HistoryLoader
  /** The commit list behind a repo's head. May fail. */
  commits: (repo: string, headOid: string) => Promise<Commits>
}

/** Lets `max` tasks run at a time. */
function gate(max: number) {
  let running = 0
  const queue: Array<() => void> = []
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running >= max) await new Promise<void>((resolve) => queue.push(resolve))
    running++
    try {
      return await task()
    } finally {
      running--
      queue.shift()?.()
    }
  }
}

type Pair = { key: string; a: string; b: string; blobs: SharedBlob[] }

export function createFirstRunner(deps: FirstDeps, limits: { auto?: number; open?: number } = {}) {
  const autoBudget = limits.auto ?? AUTO_SNAPSHOT_BUDGET
  const openBudget = limits.open ?? OPEN_SNAPSHOT_BUDGET

  function start(
    input: FirstInput,
    onChange: (states: FirstStates, progress: FirstProgress) => void,
  ): FirstRun {
    let live = true
    const states = new Map<string, FirstState>()
    const progress = { done: 0, total: 0 }
    const publish = () => {
      if (live) onChange(new Map(states), { ...progress })
    }
    /** So many file lists, and none at all once this run was stopped. */
    const budget = (count: number): Allowance => {
      let left = count
      return { take: () => live && left-- > 0 }
    }

    const pairs = new Map<string, Pair>()
    const histories = new Map<string, RepoHistory>()
    const commitLists = new Map<string, Commits | null>()
    const enter = gate(REPOS_AT_ONCE)

    // Which repos hold each content, and under which name. Starter files are nobody's.
    const holders = new Map<string, Map<string, string>>()
    for (const [repo, tree] of input.trees) {
      for (const file of tree.files) {
        if (input.starter.has(file.sha)) continue
        let repos = holders.get(file.sha)
        if (!repos) holders.set(file.sha, (repos = new Map()))
        if (!repos.has(repo)) repos.set(repo, file.path)
      }
    }
    /** The other repos of the sheet that hold this content. */
    const others = (sha: string, pair: Pair): Array<[repo: string, path: string]> =>
      [...(holders.get(sha) ?? [])].filter(([repo]) => repo !== pair.a && repo !== pair.b)

    function judge(pair: Pair): PairEvidence | null {
      const a = input.facts.get(pair.a)
      const b = input.facts.get(pair.b)
      if (!a || !b) return null
      const rivals = new Map<string, Rival[]>()
      for (const blob of pair.blobs) {
        const list: Rival[] = []
        for (const [repo, path] of others(blob.sha, pair)) {
          const facts = input.facts.get(repo)
          // A holder nothing is known about may have had the file at any time.
          const arrival = facts
            ? arrivalOf(blob.sha, path, histories.get(repo), facts)
            : { notBefore: 0, by: Infinity, push: null, hadEarlierVersion: false }
          list.push({ repo, arrival })
        }
        if (list.length > 0) rivals.set(blob.sha, list)
      }
      return judgePair({
        a,
        b,
        blobs: pair.blobs,
        aHistory: histories.get(pair.a),
        bHistory: histories.get(pair.b),
        rivals,
        aCommits: commitLists.get(pair.a),
        bCommits: commitLists.get(pair.b),
      })
    }

    /** Reads one repo: its history as far as `need` asks, and its commit list if it is one of a pair. */
    async function read(repo: string, need: ReadonlySet<string>, withCommits: boolean, allowance: Allowance) {
      const facts = input.facts.get(repo)
      const head = input.trees.get(repo)
      if (!facts || !head) return
      await enter(async () => {
        if (!live) return
        const [history, commits] = await Promise.all([
          deps.history.ensure(facts, head, need, allowance),
          withCommits
            ? deps.commits(repo, facts.headOid).then(
                (list) => list,
                () => null,
              )
            : Promise.resolve(undefined),
        ])
        histories.set(repo, history)
        if (commits !== undefined) commitLists.set(repo, commits)
      })
    }

    /** Checks these pairs: reads every repo they depend on, then judges each. */
    function check(keys: readonly string[], allowance: Allowance): void {
      const chosen = keys.map((key) => pairs.get(key)).filter((pair): pair is Pair => pair !== undefined)
      if (chosen.length === 0) return

      // What each repo has to be read for, over all of these pairs at once.
      const need = new Map<string, Set<string>>()
      const ofPair = new Set<string>()
      const want = (repo: string, sha: string) => {
        const set = need.get(repo)
        if (set) set.add(sha)
        else need.set(repo, new Set([sha]))
      }
      for (const pair of chosen) {
        states.set(pair.key, { state: 'checking' })
        ofPair.add(pair.a)
        ofPair.add(pair.b)
        for (const blob of pair.blobs) {
          want(pair.a, blob.sha)
          want(pair.b, blob.sha)
          for (const [repo] of others(blob.sha, pair)) want(repo, blob.sha)
        }
      }

      const reading = new Map<string, Promise<void>>()
      progress.total += need.size
      for (const [repo, shas] of need) {
        reading.set(
          repo,
          read(repo, shas, ofPair.has(repo), allowance).finally(() => {
            progress.done++
            publish()
          }),
        )
      }
      publish()

      for (const pair of chosen) {
        const depends = new Set([pair.a, pair.b])
        for (const blob of pair.blobs) for (const [repo] of others(blob.sha, pair)) depends.add(repo)
        void Promise.all([...depends].map((repo) => reading.get(repo))).then(() => {
          if (!live) return
          // Stopped by the budget: nothing is said until the row is opened and the rest is read.
          const cutShort = [...depends].some((repo) => histories.get(repo)?.stopped === 'budget')
          const evidence = cutShort ? null : judge(pair)
          states.set(pair.key, evidence ? { state: 'ready', evidence } : { state: 'waiting' })
          publish()
        })
      }
    }

    const automatic: string[] = []
    for (const summary of input.pairs) {
      const a = input.trees.get(summary.aKey)
      const b = input.trees.get(summary.bKey)
      const aFacts = input.facts.get(summary.aKey)
      const bFacts = input.facts.get(summary.bKey)
      if (!a || !b || !aFacts || !bFacts) continue
      const key = pairKey(summary.aKey, summary.bKey)
      const pair: Pair = { key, a: summary.aKey, b: summary.bKey, blobs: sharedBlobs(a, b, input.starter) }
      // A fork, a template copy, one account: settled by the repos' own facts, at no cost.
      if (originOf(aFacts, bFacts)) {
        states.set(key, { state: 'ready', evidence: judgePair({ a: aFacts, b: bFacts, blobs: pair.blobs }) })
        continue
      }
      pairs.set(key, pair)
      states.set(key, { state: 'waiting' })
      if (AUTO_TIERS.has(summary.tier)) automatic.push(key)
    }
    publish()
    check(automatic, budget(autoBudget))

    return {
      open(key) {
        if (live && states.get(key)?.state === 'waiting') check([key], budget(openBudget))
      },
      stop() {
        live = false
      },
    }
  }

  return { start }
}
