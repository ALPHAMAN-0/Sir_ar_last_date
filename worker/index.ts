import {
  API_BASE,
  parseActivityQuery,
  parseCommitQuery,
  parseCommitsQuery,
  parseReposQuery,
} from '../shared/api.ts'
import { ApiErr, badRequest, errorResponse } from './http.ts'
import { handleActivity } from './routes/activity.ts'
import { handleCommit } from './routes/commit.ts'
import { handleCommits } from './routes/commits.ts'
import { handleRepos } from './routes/repos.ts'
import { handleStatus } from './routes/status.ts'

/** One budget per visitor. IPv6 addresses are grouped by /64, the size of one home network. */
function visitorKey(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip
}

async function limit(limiter: RateLimit, request: Request): Promise<void> {
  const { success } = await limiter.limit({ key: visitorKey(request) })
  if (!success) {
    throw new ApiErr(429, 'rate_limited', 'Too many requests. Please wait a moment.', {
      retryAfter: 30,
    })
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new ApiErr(405, 'method_not_allowed', 'Only GET is supported.', { allow: 'GET, HEAD' })
  }
  // Browsers say where a request comes from. Other websites may not use this API.
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin' && site !== 'none') {
    throw new ApiErr(403, 'forbidden_origin', 'This API can only be used from its own page.')
  }

  const url = new URL(request.url)
  // Inputs are validated, and must be spelled canonically, before anything is
  // counted against the visitor or sent to GitHub.
  switch (url.pathname) {
    case `${API_BASE}/repos`: {
      const keys = parseReposQuery(url.search)
      if (!keys) throw badRequest()
      await limit(env.RL_GRAPHQL, request)
      return handleRepos(env, keys)
    }
    case `${API_BASE}/commits`: {
      const params = parseCommitsQuery(url.search)
      if (!params) throw badRequest()
      await limit(env.RL_GRAPHQL, request)
      return handleCommits(env, params)
    }
    case `${API_BASE}/activity`: {
      const params = parseActivityQuery(url.search)
      if (!params) throw badRequest()
      await limit(env.RL_REST, request)
      return handleActivity(env, params)
    }
    case `${API_BASE}/commit`: {
      const params = parseCommitQuery(url.search)
      if (!params) throw badRequest()
      await limit(env.RL_REST, request)
      return handleCommit(env, params)
    }
    case `${API_BASE}/status`: {
      if (url.search !== '') throw badRequest()
      await limit(env.RL_REST, request)
      return handleStatus(env)
    }
    default:
      throw new ApiErr(404, 'not_found', 'There is nothing at this address.')
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await route(request, env)
    } catch (error) {
      if (error instanceof ApiErr) return errorResponse(error)
      // Log the kind of failure only. The message is never sent to the visitor.
      console.error('unhandled error:', error instanceof Error ? error.name : typeof error)
      return errorResponse(new ApiErr(500, 'internal', 'Something went wrong on the server.'))
    }
  },
} satisfies ExportedHandler<Env>
