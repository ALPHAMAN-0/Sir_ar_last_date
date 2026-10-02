import type { StatusResponse } from '../../shared/api.ts'
import { quotaSnapshot, RESERVE } from '../github.ts'
import { CACHE, json } from '../http.ts'

/** How much of the shared GitHub limit is left, so the page can warn before it runs out. */
export async function handleStatus(env: Env): Promise<Response> {
  const { core, graphql } = await quotaSnapshot(env)
  const body: StatusResponse = {
    fetchedAt: new Date().toISOString(),
    core,
    graphql,
    reserve: RESERVE,
  }
  return json(body, CACHE.edge(30))
}
