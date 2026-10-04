// Web Worker that runs compareAll off the main thread so the UI never
// blocks on a large class size. The page spawns this with:
//
//   const worker = new Worker(
//     new URL('./compare.worker.ts', import.meta.url),
//     { type: 'module' },
//   )
//   worker.postMessage({ trees })
//   worker.addEventListener('message', (event) => { ... event.data.pairs ... })

import { compareAll } from './compare.ts'
import type { FileTree, Pair } from './types.ts'

type InMessage = { trees: Array<[string, FileTree]> }
type OutMessage = { pairs: Pair[] }

self.addEventListener('message', (event: MessageEvent<InMessage>) => {
  const trees = new Map<string, FileTree>(event.data.trees)
  const pairs = compareAll(trees)
  const out: OutMessage = { pairs }
  ;(self as unknown as Worker).postMessage(out)
})