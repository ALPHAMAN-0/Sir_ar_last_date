import type { CommitInfo, CommitsParams, CommitsResponse } from '../../shared/api.ts'
import { splitRepoKey } from '../../shared/validate.ts'
import { graphql } from '../github.ts'
import { ApiErr, CACHE, json } from '../http.ts'
import { COMMITS_DOCUMENT } from '../queries.ts'

type RawCommit = {
  oid: string
  committedDate: string
  authoredDate: string
  messageHeadline: string
  parents: { nodes: Array<{ oid: string }> }
  author: { name: string | null; user: { login: string } | null } | null
}
type RawData = {
  repository: {
    object: {
      history?: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: RawCommit[]
      }
    } | null
  } | null
}

/**
 * One page (100) of the history behind a given head commit. The page is
 * addressed by commit id, so its content never changes and it is cached long.
 */
export async function handleCommits(env: Env, params: CommitsParams): Promise<Response> {
  const { owner, name } = splitRepoKey(params.repo)
  const { data } = await graphql<RawData>(env, COMMITS_DOCUMENT, {
    owner,
    name,
    oid: params.ref,
    after: params.after ?? null,
  })
  if (!data?.repository) {
    throw new ApiErr(404, 'repo_not_found', 'This repo was not found.', { cache: CACHE.edge(60) })
  }
  const history = data.repository.object?.history
  if (!history) {
    throw new ApiErr(404, 'commit_not_found', 'This commit was not found.', {
      cache: CACHE.edge(60),
    })
  }

  const commits: CommitInfo[] = history.nodes.map((node) => ({
    oid: node.oid,
    committedAt: node.committedDate,
    authoredAt: node.authoredDate,
    headline: node.messageHeadline,
    parents: node.parents.nodes.map((parent) => parent.oid),
    authorName: node.author?.name ?? null,
    authorLogin: node.author?.user?.login ?? null,
  }))
  const body: CommitsResponse = {
    commits,
    next: history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null,
  }
  return json(body, CACHE.immutable)
}
