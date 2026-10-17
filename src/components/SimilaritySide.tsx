// One side of a pair on the similarity tab: who handed the repo in, and a link to it.

import { repoUrl } from '../logic/people.ts'
import { groupLabel, type RepoGroup } from '../similarity/run.ts'

export function Side({ group, max }: { group: RepoGroup; max?: number }) {
  return (
    <>
      <strong>{groupLabel(group, max)}</strong>
      <a className="similarity__repo mono" href={repoUrl(group.repo)} target="_blank" rel="noopener noreferrer">
        {group.nameWithOwner}
      </a>
      {group.isFork ? <span className="tag">Fork</span> : null}
    </>
  )
}
