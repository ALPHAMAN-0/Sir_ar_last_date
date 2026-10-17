// GraphQL documents. Values always travel as variables, never inside the text.

const REPO_FIELDS = `fragment RepoFields on Repository {
  nameWithOwner isEmpty isFork isArchived createdAt pushedAt
  parent { nameWithOwner } templateRepository { nameWithOwner }
  defaultBranchRef { name target { ... on Commit { oid committedDate history(first: 1) { totalCount } } } }
  refs(refPrefix: "refs/heads/", first: 100, orderBy: {field: ALPHABETICAL, direction: ASC}) { totalCount nodes { name } }
}`

/** One aliased `repository` field per repo: r0, r1, ... with variables o0/n0, o1/n1, ... */
export function reposDocument(count: number): string {
  const variables: string[] = []
  const fields: string[] = []
  for (let i = 0; i < count; i++) {
    variables.push(`$o${i}: String!, $n${i}: String!`)
    fields.push(`  r${i}: repository(owner: $o${i}, name: $n${i}) { ...RepoFields }`)
  }
  return `query Repos(${variables.join(', ')}) {\n${fields.join('\n')}\n}\n${REPO_FIELDS}`
}

// Commit stats (additions/deletions) are left out on purpose: they make the
// query about ten times slower. Parents are needed to work out push times.
export const COMMITS_DOCUMENT = `query Commits($owner: String!, $name: String!, $oid: GitObjectID!, $after: String) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit {
        history(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            oid committedDate authoredDate messageHeadline
            parents(first: 5) { nodes { oid } }
            author { name user { login } }
          }
        }
      }
    }
  }
}`

/**
 * The text of up to 40 file contents of one repo: b0, b1, ... with variables
 * $b0, $b1, ... An object lookup is no connection, so the call costs one point.
 */
export function blobsDocument(count: number): string {
  const variables = ['$owner: String!', '$name: String!']
  const fields: string[] = []
  for (let i = 0; i < count; i++) {
    variables.push(`$b${i}: GitObjectID!`)
    fields.push(`    b${i}: object(oid: $b${i}) { ...BlobText }`)
  }
  return `query Blobs(${variables.join(', ')}) {\n  repository(owner: $owner, name: $name) {\n${fields.join('\n')}\n  }\n}\nfragment BlobText on Blob { isBinary isTruncated text }`
}
