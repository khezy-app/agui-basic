import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { apiFetch, buildQuery } from '../api/client'
import { ApiError, isApiError, toFieldErrors } from '../api/errors'
import type { TaskCreateInput, TaskPatchInput } from '../api/tasks'

type StubResponseInit = {
  status: number
  statusText?: string
  body?: string
  ok?: boolean
}

function stubFetch(init: StubResponseInit): Mock {
  const response = {
    ok: init.ok ?? (init.status >= 200 && init.status < 300),
    status: init.status,
    statusText: init.statusText ?? '',
    text: async () => init.body ?? '',
  }
  const fetchMock = vi.fn<() => Promise<unknown>>().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastInit(fetchMock: Mock): RequestInit {
  const calls = fetchMock.mock.calls
  const call = calls[calls.length - 1]
  if (!call) throw new Error('fetch was not called')
  return (call[1] ?? {}) as RequestInit
}

function lastUrl(fetchMock: Mock): string {
  const calls = fetchMock.mock.calls
  const call = calls[calls.length - 1]
  if (!call) throw new Error('fetch was not called')
  return String(call[0])
}

async function captureApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (isApiError(error)) return error
    throw error
  }
  throw new Error('expected the call to reject')
}

function c1Body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'https://agui-basic.local/problems/validation-failed',
    title: 'Validation failed',
    status: 400,
    detail: '1 field is invalid',
    instance: '/api/tasks',
    errors: [{ field: 'title', message: 'must not be blank' }],
    ...overrides,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildQuery', () => {
  it('repeats array keys and omits empty arrays', () => {
    expect(buildQuery({ status: ['TODO', 'BLOCKED'], priority: [] })).toBe(
      '?status=TODO&status=BLOCKED',
    )
  })

  it('omits null, undefined and empty-string params', () => {
    expect(buildQuery({ q: null, assigneeId: undefined, tag: '', page: 0 })).toBe('?page=0')
  })

  it('serialises booleans explicitly rather than dropping a false value', () => {
    expect(buildQuery({ force: false, overdue: true })).toBe('?force=false&overdue=true')
  })

  it('returns an empty suffix when nothing survives', () => {
    expect(buildQuery({ status: [], q: null })).toBe('')
    expect(buildQuery(undefined)).toBe('')
  })
})

describe('apiFetch — URL, headers and body', () => {
  it('prefixes the base url, appends the query, and sends Accept only on a GET', async () => {
    const fetchMock = stubFetch({ status: 200, body: '{"content":[]}' })

    await apiFetch('/tasks', {
      query: {
        status: ['TODO', 'BLOCKED'],
        sort: '-dueDate',
        page: 0,
        size: 20,
        unassigned: null,
        overdue: null,
      },
    })

    expect(lastUrl(fetchMock)).toBe(
      '/api/tasks?status=TODO&status=BLOCKED&sort=-dueDate&page=0&size=20',
    )
    const init = lastInit(fetchMock)
    expect(init.method).toBe('GET')
    expect(init.headers).toEqual({ Accept: 'application/json' })
    expect(init.body).toBeUndefined()
    expect(init.credentials).toBe('omit')
  })

  it('adds Content-Type only when a body is present', async () => {
    const fetchMock = stubFetch({ status: 200, body: '{}' })

    await apiFetch('/tasks', { method: 'POST', body: { title: 'x' } })

    const init = lastInit(fetchMock)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
    expect(init.body).toBe(JSON.stringify({ title: 'x' }))
  })
})

describe('apiFetch — success shapes', () => {
  it('resolves undefined for a 204', async () => {
    stubFetch({ status: 204 })
    await expect(apiFetch<void>('/tasks/1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('parses a JSON body', async () => {
    stubFetch({ status: 200, body: '{"id":"1","title":"Ship it"}' })
    await expect(apiFetch('/tasks/1')).resolves.toEqual({ id: '1', title: 'Ship it' })
  })

  it('throws malformed-response for an ok response with an unparseable body', async () => {
    stubFetch({ status: 200, body: '<html>not json</html>' })
    const error = await captureApiError(apiFetch('/tasks'))

    expect(error.kind).toBe('malformed-response')
    expect(error.status).toBe(200)
    // `retryable` follows the pinned formula only: status >= 500 || network || version-conflict.
    expect(error.retryable).toBe(false)
  })
})

describe('apiFetch — C1 error mapping', () => {
  it('maps a 400 envelope to validation-failed with mapped field errors', async () => {
    stubFetch({ status: 400, statusText: 'Bad Request', body: c1Body() })
    const error = await captureApiError(apiFetch('/tasks', { method: 'POST', body: {} }))

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.kind).toBe('validation-failed')
    expect(error.status).toBe(400)
    expect(error.message).toBe('Validation failed')
    expect(error.detail).toBe('1 field is invalid')
    expect(error.fieldErrors).toEqual([{ field: 'title', message: 'must not be blank' }])
    expect(toFieldErrors(error)).toEqual({ title: 'must not be blank' })
    expect(error.retryable).toBe(false)
  })

  it('reads the marker for a version conflict and marks it retryable', async () => {
    stubFetch({
      status: 409,
      body: c1Body({
        type: 'https://agui-basic.local/problems/version-conflict',
        title: 'Version conflict',
        status: 409,
        detail: 'The task changed since you loaded it.',
        errors: [],
      }),
    })
    const error = await captureApiError(apiFetch('/tasks/1', { method: 'PATCH', body: {} }))

    expect(error.kind).toBe('version-conflict')
    expect(error.retryable).toBe(true)
    expect(error.fieldErrors).toEqual([])
  })

  it('falls back to the HTTP status when the type carries no known marker', async () => {
    stubFetch({
      status: 404,
      body: c1Body({ type: 'about:blank', title: 'Not Found', status: 404, errors: [] }),
    })
    const error = await captureApiError(apiFetch('/tasks/1'))

    expect(error.kind).toBe('not-found')
    expect(error.fieldErrors).toEqual([])
  })

  it('synthesises an internal-error for a non-JSON 500 without leaking the raw body', async () => {
    stubFetch({
      status: 500,
      statusText: 'Internal Server Error',
      body: '<html><body>proxy blew up</body></html>',
    })
    const error = await captureApiError(apiFetch('/tasks'))

    expect(error.kind).toBe('internal-error')
    expect(error.status).toBe(500)
    expect(error.retryable).toBe(true)
    expect(error.message).toBe('Internal Server Error')
    expect(error.detail).toBe('')
    expect(error.message).not.toContain('<')
    expect(error.message).not.toContain('proxy blew up')
  })

  it('never returns undefined fieldErrors', async () => {
    stubFetch({ status: 503, statusText: '', body: '' })
    const error = await captureApiError(apiFetch('/tasks'))

    expect(error.fieldErrors).toEqual([])
    expect(error.message).toBe('Request failed with status 503')
  })
})

describe('apiFetch — transport failures', () => {
  it('maps a rejected fetch to a retryable network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await captureApiError(apiFetch('/tasks'))

    expect(error.kind).toBe('network')
    expect(error.status).toBe(0)
    expect(error.retryable).toBe(true)
    expect(error.detail).toBe('Failed to fetch')
  })

  it('maps an abort to a non-retryable network error', async () => {
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    const error = await captureApiError(apiFetch('/tasks'))

    expect(error.kind).toBe('network')
    expect(error.message).toBe('Request cancelled')
    expect(error.retryable).toBe(false)
  })
})

describe('request bodies cannot carry server-owned fields', () => {
  it('excludes server-owned keys from create and status from patch (compile-time)', () => {
    const hasId: 'id' extends keyof TaskCreateInput ? true : false = false
    const hasVersion: 'version' extends keyof TaskCreateInput ? true : false = false
    const hasCreatedAt: 'createdAt' extends keyof TaskCreateInput ? true : false = false
    const hasUpdatedAt: 'updatedAt' extends keyof TaskCreateInput ? true : false = false
    const hasIsOverdue: 'isOverdue' extends keyof TaskCreateInput ? true : false = false
    const hasIsUnassigned: 'isUnassigned' extends keyof TaskCreateInput ? true : false = false
    const patchHasStatus: 'status' extends keyof TaskPatchInput ? true : false = false

    expect([
      hasId,
      hasVersion,
      hasCreatedAt,
      hasUpdatedAt,
      hasIsOverdue,
      hasIsUnassigned,
      patchHasStatus,
    ]).toEqual([false, false, false, false, false, false, false])
  })

  it('accepts a complete create body, so the type is not accidentally unsatisfiable', () => {
    const input = {
      title: 'Ship it',
      description: null,
      status: 'TODO',
      priority: 'MEDIUM',
      assigneeId: null,
      reporterId: null,
      dueDate: null,
      estimateHours: null,
      tags: [],
    } satisfies TaskCreateInput

    expect(Object.keys(input)).toHaveLength(9)
  })
})
