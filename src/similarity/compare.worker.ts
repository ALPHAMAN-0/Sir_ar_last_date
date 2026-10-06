// Runs the comparison off the main thread, so the page stays responsive while
// a large class is compared. The page spawns it with:
//
//   new Worker(new URL('./compare.worker.ts', import.meta.url), { type: 'module' })
//
// Only numbers travel back: one small summary per pair, never the file lists.

import { analyse } from './compare.ts'
import type { RepoFiles } from './types.ts'

export type CompareRequest = { repos: RepoFiles[]; commonLimit?: number }

self.addEventListener('message', (event: MessageEvent<CompareRequest>) => {
  const result = analyse(event.data.repos, { commonLimit: event.data.commonLimit })
  ;(self as unknown as Worker).postMessage(result)
})
