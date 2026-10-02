import { describe, expect, it } from 'vitest'
import type { ActivityEvent, CommitInfo } from '../../shared/api.ts'
import { ZERO_OID } from '../../shared/validate.ts'
import { arrivedLate, attributePushes } from './pushAttribution.ts'

const oid = (name: string) => name.padEnd(40, '0')
const commit = (name: string, ...parents: string[]): CommitInfo => ({
  oid: oid(name),
  // Dates written by the author; deliberately useless here.
  committedAt: '2000-01-01T00:00:00Z',
  authoredAt: '2000-01-01T00:00:00Z',
  headline: name,
  parents: parents.map(oid),
  authorName: null,
  authorLogin: null,
})
const push = (ts: string, after: string, before = '', type = 'push'): ActivityEvent => ({
  ts,
  type,
  ref: 'refs/heads/main',
  before: before ? oid(before) : ZERO_OID,
  after: oid(after),
  actor: null,
})

const T1 = '2026-10-01T10:00:00Z'
const T2 = '2026-10-02T10:00:00Z'
const T3 = '2026-10-03T10:00:00Z'

describe('attributePushes', () => {
  it('gives every commit the time of the push that brought it', () => {
    const commits = [commit('c3', 'c2'), commit('c2', 'c1'), commit('c1')]
    const events = [push(T3, 'c3', 'c2'), push(T1, 'c1', '', 'branch_creation'), push(T2, 'c2', 'c1')]
    const result = attributePushes(commits, events)
    expect(result.get(oid('c1'))?.pushedAt).toBe(T1)
    expect(result.get(oid('c2'))?.pushedAt).toBe(T2)
    expect(result.get(oid('c3'))?.pushedAt).toBe(T3)
  })

  it('assigns several commits to one push', () => {
    const commits = [commit('c3', 'c2'), commit('c2', 'c1'), commit('c1')]
    const result = attributePushes(commits, [push(T1, 'c1', '', 'branch_creation'), push(T2, 'c3', 'c1')])
    expect(result.get(oid('c2'))?.pushedAt).toBe(T2)
    expect(result.get(oid('c3'))?.pushedAt).toBe(T2)
  })

  it('follows both parents of a merge', () => {
    // main: c1 - c2 - m ; side: c1 - s1 - s2, merged into m
    const commits = [
      commit('m', 'c2', 's2'),
      commit('s2', 's1'),
      commit('s1', 'c1'),
      commit('c2', 'c1'),
      commit('c1'),
    ]
    const events = [
      push(T1, 'c1', '', 'branch_creation'),
      push(T2, 'c2', 'c1'),
      push(T3, 'm', 'c2', 'pr_merge'),
    ]
    const result = attributePushes(commits, events)
    expect(result.get(oid('c2'))?.pushedAt).toBe(T2)
    for (const name of ['s1', 's2', 'm']) expect(result.get(oid(name))?.pushedAt, name).toBe(T3)
  })

  it('dates rewritten history from the force push', () => {
    // c2 was replaced by d2; only d2 is still in the history.
    const commits = [commit('d2', 'c1'), commit('c1')]
    const events = [
      push(T1, 'c1', '', 'branch_creation'),
      push(T2, 'c2', 'c1'),
      push(T3, 'd2', 'c2', 'force_push'),
    ]
    const result = attributePushes(commits, events)
    expect(result.get(oid('d2'))?.pushedAt).toBe(T3)
    expect(result.get(oid('c1'))?.pushedAt).toBe(T1)
    expect(result.has(oid('c2'))).toBe(false)
  })

  it('marks commits older than the log as "already there before"', () => {
    const commits = [commit('c3', 'c2'), commit('c2', 'c1'), commit('c1')]
    const result = attributePushes(commits, [push(T3, 'c3', 'c2')])
    expect(result.get(oid('c3'))).toEqual({ pushedAt: T3, knownBefore: null })
    expect(result.get(oid('c2'))).toEqual({ pushedAt: null, knownBefore: T3 })
    expect(result.get(oid('c1'))).toEqual({ pushedAt: null, knownBefore: T3 })
  })

  it('ignores branch deletions and returns nothing without events', () => {
    const commits = [commit('c1')]
    expect(attributePushes(commits, []).size).toBe(0)
    const deleted: ActivityEvent = { ...push(T2, 'c1', 'c1', 'branch_deletion'), after: ZERO_OID }
    expect(attributePushes(commits, [deleted]).size).toBe(0)
  })
})

describe('arrivedLate', () => {
  const deadline = Date.parse(T2)

  it('compares the push time with the deadline', () => {
    expect(arrivedLate({ pushedAt: T1, knownBefore: null }, deadline)).toBe(false)
    expect(arrivedLate({ pushedAt: T2, knownBefore: null }, deadline)).toBe(false)
    expect(arrivedLate({ pushedAt: T3, knownBefore: null }, deadline)).toBe(true)
  })

  it('knows a commit is in time when it predates an in-time event', () => {
    expect(arrivedLate({ pushedAt: null, knownBefore: T1 }, deadline)).toBe(false)
    expect(arrivedLate({ pushedAt: null, knownBefore: T3 }, deadline)).toBeNull()
  })

  it('is unknown without a deadline or without push data', () => {
    expect(arrivedLate({ pushedAt: T3, knownBefore: null }, null)).toBeNull()
    expect(arrivedLate(undefined, deadline)).toBeNull()
  })
})
