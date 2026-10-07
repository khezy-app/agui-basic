import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { LocationQuery, RouteLocationNormalizedLoaded } from 'vue-router'

import { DEFAULT_TASK_QUERY, type TaskQuery } from '../domain/task'
import { useTeamStore } from '../stores/team'
import { deepEqual, parseTaskQuery, taskQueryToRouteQuery, tasksRouteWith } from '../utils/query'
import { TEAM_MEMBERS } from './fixtures'

/** Builds a `LocationQuery` from a query string, keeping repeated keys as arrays. */
function toLocationQuery(search: string): LocationQuery {
  const params = new URLSearchParams(search)
  const query: LocationQuery = {}
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key)
    query[key] = values.length > 1 ? values : (values[0] ?? null)
  }
  return query
}

function makeRoute(query: LocationQuery = {}): RouteLocationNormalizedLoaded {
  return { query } as unknown as RouteLocationNormalizedLoaded
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('parseTaskQuery', () => {
  it('returns every field with its default for an empty URL', () => {
    expect(parseTaskQuery({})).toEqual(DEFAULT_TASK_QUERY)
  })

  it('merges repeated keys and comma-separated values, dropping unknown entries', () => {
    const parsed = parseTaskQuery(
      toLocationQuery('status=TODO&status=BLOCKED&priority=HIGH,low&priority=NOPE'),
    )

    expect(parsed.statuses).toEqual(['TODO', 'BLOCKED'])
    expect(parsed.priorities).toEqual(['HIGH', 'LOW'])
  })

  it('reads booleans, the due window, dates and the sort prefix', () => {
    const parsed = parseTaskQuery(
      toLocationQuery(
        'unassigned=true&overdue=true&due=7&from=2026-01-01&to=2026-02-01&sort=-dueDate',
      ),
    )

    expect(parsed.unassigned).toBe(true)
    expect(parsed.overdue).toBe(true)
    expect(parsed.dueWithinDays).toBe(7)
    expect(parsed.createdFrom).toBe('2026-01-01')
    expect(parsed.createdTo).toBe('2026-02-01')
    expect(parsed.sort).toBe('dueDate')
    expect(parsed.descending).toBe(true)
  })

  it('falls back to defaults for malformed page, size, due, sort and date values', () => {
    const parsed = parseTaskQuery(
      toLocationQuery('page=-1&size=999&due=abc&sort=nonsense&from=2026-13-40&tag=BUGS'),
    )

    expect(parsed.page).toBe(0)
    expect(parsed.size).toBe(20)
    expect(parsed.dueWithinDays).toBeNull()
    expect(parsed.sort).toBe('createdAt')
    expect(parsed.descending).toBe(true)
    expect(parsed.createdFrom).toBeNull()
    expect(parsed.tag).toBe('bugs')
  })

  it('accepts an assignee id, and resolves assigneeName through the loaded team store', () => {
    expect(parseTaskQuery(toLocationQuery('assignee=m2')).assigneeId).toBe('m2')

    setActivePinia(createPinia())
    useTeamStore().members = TEAM_MEMBERS
    expect(parseTaskQuery(toLocationQuery('assigneeName=Grace%20Hopper')).assigneeId).toBe('m2')

    // The convenience degrades to null when members are not loaded yet.
    setActivePinia(createPinia())
    expect(parseTaskQuery(toLocationQuery('assigneeName=Grace%20Hopper')).assigneeId).toBeNull()
  })
})

describe('taskQueryToRouteQuery', () => {
  it('omits defaults so /tasks stays clean', () => {
    expect(taskQueryToRouteQuery(DEFAULT_TASK_QUERY)).toEqual({})
  })

  it('produces short, comma-joined params', () => {
    const query: TaskQuery = {
      ...DEFAULT_TASK_QUERY,
      statuses: ['TODO', 'BLOCKED'],
      priorities: ['URGENT'],
      unassigned: true,
      dueWithinDays: 7,
      sort: 'dueDate',
      descending: false,
      page: 2,
      size: 50,
    }

    expect(taskQueryToRouteQuery(query)).toEqual({
      status: 'TODO,BLOCKED',
      priority: 'URGENT',
      unassigned: 'true',
      due: '7',
      sort: 'dueDate',
      page: '2',
      size: '50',
    })
  })
})

describe('round-trip', () => {
  const urls = [
    '',
    'status=TODO',
    'status=TODO,BLOCKED&priority=URGENT',
    'unassigned=true&overdue=true',
    'due=7&from=2026-01-01&to=2026-02-01',
    'sort=-dueDate&page=3&size=50',
    'q=flaky+test&tag=BUGS',
    'assignee=m1',
  ]

  it('is stable: an emitted URL re-parses to the same query', () => {
    for (const url of urls) {
      const parsed = parseTaskQuery(toLocationQuery(url))
      const emitted = taskQueryToRouteQuery(parsed)
      expect(parseTaskQuery(emitted)).toEqual(parsed)
      // Serialising again must not change the URL (idempotent).
      expect(taskQueryToRouteQuery(parseTaskQuery(emitted))).toEqual(emitted)
    }
  })

  it('never emits defaults', () => {
    expect(taskQueryToRouteQuery(parseTaskQuery(toLocationQuery('page=0&size=20')))).toEqual({})
  })
})

describe('deepEqual', () => {
  it('compares arrays order-insensitively and objects by value', () => {
    expect(deepEqual(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(deepEqual({ a: 1, b: [2, 3] }, { b: [3, 2], a: 1 })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(deepEqual(['a'], ['a', 'b'])).toBe(false)
  })
})

describe('tasksRouteWith', () => {
  it('builds a named /tasks link from the partial, over the defaults', () => {
    expect(tasksRouteWith({ overdue: true }, makeRoute())).toEqual({
      name: 'tasks',
      query: { overdue: 'true' },
    })
  })

  it('clears managed filters the partial does not name (show me X, not X ∩ what I had)', () => {
    const route = makeRoute({ status: 'TODO', q: 'flaky', page: '2' })

    expect(tasksRouteWith({ overdue: true }, route)).toEqual({
      name: 'tasks',
      query: { overdue: 'true' },
    })
  })

  it('preserves unrelated query params', () => {
    const route = makeRoute({ utm: 'demo', status: 'TODO' })

    expect(tasksRouteWith({ unassigned: true }, route)).toEqual({
      name: 'tasks',
      query: { utm: 'demo', unassigned: 'true' },
    })
  })
})
