import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { teamApi } from '../api/team'
import { taskApi, toQueryParams } from '../api/tasks'
import { DEFAULT_TASK_QUERY, type TaskQuery } from '../domain/task'

function stubFetch(body = '{}'): Mock {
  const fetchMock = vi.fn<() => Promise<unknown>>().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastCall(fetchMock: Mock): { url: string; init: RequestInit } {
  const calls = fetchMock.mock.calls
  const call = calls[calls.length - 1]
  if (!call) throw new Error('fetch was not called')
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit }
}

function lastBody(fetchMock: Mock): unknown {
  const { init } = lastCall(fetchMock)
  return init.body === undefined ? undefined : JSON.parse(String(init.body))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toQueryParams', () => {
  it('maps the default query to the canonical backend parameter names', () => {
    expect(toQueryParams(DEFAULT_TASK_QUERY)).toEqual({
      status: [],
      priority: [],
      assigneeId: null,
      unassigned: null,
      tag: null,
      q: null,
      overdue: null,
      dueWithinDays: null,
      createdFrom: null,
      createdTo: null,
      sort: '-createdAt',
      page: 0,
      size: 20,
    })
  })

  it('prefixes the sort with "-" only when descending', () => {
    const ascending: TaskQuery = { ...DEFAULT_TASK_QUERY, sort: 'dueDate', descending: false }
    expect(toQueryParams(ascending).sort).toBe('dueDate')
    expect(toQueryParams(DEFAULT_TASK_QUERY).sort).toBe('-createdAt')
  })

  it('keeps explicit true booleans and passes arrays through', () => {
    const query: TaskQuery = {
      ...DEFAULT_TASK_QUERY,
      statuses: ['TODO', 'BLOCKED'],
      priorities: ['HIGH'],
      unassigned: true,
      overdue: true,
    }
    const params = toQueryParams(query)

    expect(params.status).toEqual(['TODO', 'BLOCKED'])
    expect(params.priority).toEqual(['HIGH'])
    expect(params.unassigned).toBe(true)
    expect(params.overdue).toBe(true)
  })
})

describe('taskApi.list', () => {
  it('GETs /tasks with the mapped query and omits the empty filters', async () => {
    const fetchMock = stubFetch(
      '{"content":[],"page":0,"size":20,"totalElements":0,"totalPages":0}',
    )

    await taskApi.list(DEFAULT_TASK_QUERY)

    const { url, init } = lastCall(fetchMock)
    expect(url).toBe('/api/tasks?sort=-createdAt&page=0&size=20')
    expect(init.method).toBe('GET')
  })

  it('repeats array filters and flags only the true booleans', async () => {
    const fetchMock = stubFetch('{"content":[]}')
    const query: TaskQuery = {
      ...DEFAULT_TASK_QUERY,
      statuses: ['TODO', 'BLOCKED'],
      overdue: true,
      q: 'login',
    }

    await taskApi.list(query)

    expect(lastCall(fetchMock).url).toBe(
      '/api/tasks?status=TODO&status=BLOCKED&q=login&overdue=true&sort=-createdAt&page=0&size=20',
    )
  })

  it('forwards an abort signal', async () => {
    const fetchMock = stubFetch('{"content":[]}')
    const controller = new AbortController()

    await taskApi.list(DEFAULT_TASK_QUERY, controller.signal)

    expect(lastCall(fetchMock).init.signal).toBe(controller.signal)
  })
})

describe('taskApi single-task methods', () => {
  it('GET /tasks/stats', async () => {
    const fetchMock = stubFetch('{}')
    await taskApi.stats()
    expect(lastCall(fetchMock).url).toBe('/api/tasks/stats')
    expect(lastCall(fetchMock).init.method).toBe('GET')
  })

  it('GET /tasks/{id}', async () => {
    const fetchMock = stubFetch('{}')
    await taskApi.get('abc')
    expect(lastCall(fetchMock).url).toBe('/api/tasks/abc')
  })

  it('POST /tasks with the create body verbatim', async () => {
    const fetchMock = stubFetch('{}')
    const input = {
      title: 'Ship it',
      description: null,
      status: 'TODO' as const,
      priority: 'MEDIUM' as const,
      assigneeId: null,
      reporterId: null,
      dueDate: '2026-01-31',
      estimateHours: 3.5,
      tags: ['bug'],
    }

    await taskApi.create(input)

    const { url, init } = lastCall(fetchMock)
    expect(url).toBe('/api/tasks')
    expect(init.method).toBe('POST')
    expect(lastBody(fetchMock)).toEqual(input)
  })

  it('PATCH /tasks/{id} without a query when no expectedVersion is given', async () => {
    const fetchMock = stubFetch('{}')
    const input = {
      title: 'Ship it',
      description: null,
      priority: 'HIGH' as const,
      assigneeId: null,
      reporterId: null,
      dueDate: null,
      estimateHours: null,
      tags: [],
    }

    await taskApi.patch('abc', input)

    const { url, init } = lastCall(fetchMock)
    expect(url).toBe('/api/tasks/abc')
    expect(init.method).toBe('PATCH')
    expect(lastBody(fetchMock)).toEqual(input)
  })

  it('PATCH /tasks/{id}?expectedVersion=… when optimistic locking is requested', async () => {
    const fetchMock = stubFetch('{}')
    const input = {
      title: 'Ship it',
      description: null,
      priority: 'HIGH' as const,
      assigneeId: null,
      reporterId: null,
      dueDate: null,
      estimateHours: null,
      tags: [],
    }

    await taskApi.patch('abc', input, 3)

    expect(lastCall(fetchMock).url).toBe('/api/tasks/abc?expectedVersion=3')
  })

  it('DELETE /tasks/{id} sending force explicitly', async () => {
    const fetchMock = stubFetch('')
    await taskApi.remove('abc')
    expect(lastCall(fetchMock).url).toBe('/api/tasks/abc?force=false')
    expect(lastCall(fetchMock).init.method).toBe('DELETE')

    await taskApi.remove('abc', true)
    expect(lastCall(fetchMock).url).toBe('/api/tasks/abc?force=true')
  })

  it('POST /tasks/{id}/status with the status change body', async () => {
    const fetchMock = stubFetch('{}')
    const input = { status: 'IN_REVIEW' as const, reopen: false, expectedVersion: 2 }

    await taskApi.changeStatus('abc', input)

    const { url, init } = lastCall(fetchMock)
    expect(url).toBe('/api/tasks/abc/status')
    expect(init.method).toBe('POST')
    expect(lastBody(fetchMock)).toEqual(input)
  })

  it('POST /tasks/bulk-status with the bulk body', async () => {
    const fetchMock = stubFetch('{"updated":1,"tasks":[]}')
    const input = {
      ids: ['a', 'b'],
      status: 'DONE' as const,
      reopen: false,
      expectedVersions: { a: 1 },
    }

    await taskApi.bulkStatus(input)

    const { url, init } = lastCall(fetchMock)
    expect(url).toBe('/api/tasks/bulk-status')
    expect(init.method).toBe('POST')
    expect(lastBody(fetchMock)).toEqual(input)
  })
})

describe('teamApi.list', () => {
  it('GETs /team-members', async () => {
    const fetchMock = stubFetch('[]')
    await teamApi.list()
    expect(lastCall(fetchMock).url).toBe('/api/team-members')
    expect(lastCall(fetchMock).init.method).toBe('GET')
  })
})
