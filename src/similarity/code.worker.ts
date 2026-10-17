// Runs the shared-code comparison off the main thread, so the page stays
// responsive while a large class is compared. The page spawns it with:
//
//   new Worker(new URL('./code.worker.ts', import.meta.url), { type: 'module' })
//
// The fingerprints go in; only one small summary per pair comes back.

import { analyseCode, type CodeAnalysis, type CodeRepo } from './sharedCode.ts'

export type CodeRequest = { repos: CodeRepo[]; commonLimit: number }
export type { CodeAnalysis }

self.addEventListener('message', (event: MessageEvent<CodeRequest>) => {
  const result = analyseCode(event.data.repos, { commonLimit: event.data.commonLimit })
  ;(self as unknown as Worker).postMessage(result)
})
