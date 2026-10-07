import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { buildStatusPlan, updateTaskStatus } from '@/agui/handlers'
import type { ToolHandlerResult } from '@/agui/handlers'
import type { Task, TaskStatus } from '@/domain/task'
import { useCoworkStore } from '@/stores/cowork'
import { useTaskStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'

const CALL = { id: 'c1', messageId: 'm1' }

function task(id: string, status: TaskStatus, title = `Task ${id}`): Task {
  return {
    id,
    title,
    description: null,
    status,
    priority: 'MEDIUM',
    assigneeId: null,
    reporterId: null,
    dueDate: null,
    estimateHours: null,
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 1,
    isOverdue: false,
    isUnassigned: true,
  }
}

/** Serves `GET /tasks/:id` from a map; unknown ids 404 with the C1 envelope. */
function stubTaskApi(byId: Record<string, Task>): Mock {
  const fetchMock = vi
    .fn<(input: RequestInfo | URL) => Promise<unknown>>()
    .mockImplementation((input) => {
      const id = String(input).split('/tasks/')[1]?.split('?')[0] ?? ''
      const found = byId[id]
      if (!found) {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () =>
            JSON.stringify({ type: 'not-found', title: 'Task not found', status: 404, detail: '' }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(found),
      })
    })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function loadPage(...tasks: Task[]): void {
  useTaskStore().tasks = tasks
}

/** Asserts the call failed and narrows the union so `error` can be read. */
function failureOf(result: ToolHandlerResult): string {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected a failure')
  return result.error
}

describe('buildStatusPlan', () => {
  it('marks a legal transition as allowed', () => {
    expect(
      buildStatusPlan([{ id: 't1', title: 'A', status: 'TODO' }], 'IN_PROGRESS', false),
    ).toEqual([
      {
        taskId: 't1',
        title: 'A',
        from: 'TODO',
        to: 'IN_PROGRESS',
        allowed: true,
        unchanged: false,
      },
    ])
  })

  it('marks an illegal transition with a human reason', () => {
    const [entry] = buildStatusPlan([{ id: 't1', title: 'A', status: 'BACKLOG' }], 'DONE', false)

    expect(entry?.allowed).toBe(false)
    expect(entry?.reason).toContain('Backlog')
    expect(entry?.reason).toContain('Done')
  })

  it('reports an already-at-target task as unchanged, not as an error', () => {
    const [entry] = buildStatusPlan([{ id: 't1', title: 'A', status: 'DONE' }], 'DONE', false)

    expect(entry).toMatchObject({ allowed: true, unchanged: true })
    expect(entry?.reason).toBeUndefined()
  })

  it('needs an explicit reopen to leave CANCELLED', () => {
    const [blocked] = buildStatusPlan(
      [{ id: 't1', title: 'A', status: 'CANCELLED' }],
      'TODO',
      false,
    )
    expect(blocked?.allowed).toBe(false)

    const [reopened] = buildStatusPlan(
      [{ id: 't1', title: 'A', status: 'CANCELLED' }],
      'TODO',
      true,
    )
    expect(reopened?.allowed).toBe(true)
  })

  it('keeps going after a blocked row', () => {
    const plan = buildStatusPlan(
      [
        { id: 't1', title: 'A', status: 'BACKLOG' },
        { id: 't2', title: 'B', status: 'TODO' },
      ],
      'IN_PROGRESS',
      false,
    )

    expect(plan.map((entry) => entry.allowed)).toEqual([false, true])
  })
})

describe('update_task_status', () => {
  let fetchMock: Mock

  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock = stubTaskApi({})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fails on an invalid status before touching the network', async () => {
    const result = await updateTaskStatus({ taskId: 't1', status: 'DONE-ish' }, CALL)

    expect(failureOf(result)).toBe('invalid status')
    expect(result.content).toContain('IN_PROGRESS')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails when neither taskId nor taskIds is given', async () => {
    const result = await updateTaskStatus({ status: 'DONE' }, CALL)

    expect(failureOf(result)).toBe('update_task_status needs either taskId or taskIds')
  })

  it('rejects more than 100 ids', async () => {
    const result = await updateTaskStatus(
      { taskIds: Array.from({ length: 101 }, (_, i) => `t${i}`), status: 'DONE' },
      CALL,
    )

    expect(failureOf(result)).toBe('too many tasks')
  })

  it('fails when no id could be resolved at all', async () => {
    const result = await updateTaskStatus({ taskId: 'ghost', status: 'DONE' }, CALL)

    expect(failureOf(result)).toBe('no task could be resolved')
  })

  it('resolves ids from the loaded page without refetching them', async () => {
    loadPage(task('t1', 'TODO'))
    const promise = updateTaskStatus({ taskId: 't1', status: 'IN_PROGRESS' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())
    useCoworkStore().settleProposedStatusChange({ kind: 'approved', updated: 1, unchanged: 0 })

    const result = await promise

    expect(result).toEqual({ ok: true, content: 'approved: 1 updated' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('records the plan for the confirmation card', async () => {
    loadPage(task('t1', 'TODO', 'Login'), task('t2', 'BACKLOG', 'Signup'))
    const promise = updateTaskStatus({ taskIds: ['t1', 't2'], status: 'IN_PROGRESS' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())

    const plan = useCoworkStore().pendingStatusChange?.plan
    expect(plan?.map((entry) => entry.allowed)).toEqual([true, false])
    expect(plan?.[1]?.reason).toBeTruthy()
    useCoworkStore().settleProposedStatusChange({ kind: 'approved', updated: 1, unchanged: 0 })
    await promise
  })

  it('reports a 404 id as not_found and still proposes the rest', async () => {
    loadPage(task('t1', 'TODO'))
    const promise = updateTaskStatus({ taskIds: ['t1', 'ghost'], status: 'IN_PROGRESS' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())
    useCoworkStore().settleProposedStatusChange({ kind: 'approved', updated: 1, unchanged: 0 })

    const result = await promise

    expect(result.ok).toBe(true)
    expect(result.content).toContain('not_found=[ghost]')
  })

  it('fetches an id that is not on the loaded page', async () => {
    stubTaskApi({ t9: task('t9', 'TODO', 'Remote') })
    const promise = updateTaskStatus({ taskId: 't9', status: 'DONE' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())

    expect(useCoworkStore().pendingStatusChange?.plan[0]?.title).toBe('Remote')
    useCoworkStore().settleProposedStatusChange({ kind: 'approved', updated: 1, unchanged: 0 })
    await promise
  })

  it('de-duplicates an id given in both arguments', async () => {
    loadPage(task('t1', 'TODO'))
    const promise = updateTaskStatus({ taskId: 't1', taskIds: ['t1'], status: 'IN_PROGRESS' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())

    expect(useCoworkStore().pendingStatusChange?.plan).toHaveLength(1)
    useCoworkStore().settleProposedStatusChange({ kind: 'approved', updated: 1, unchanged: 0 })
    await promise
  })

  it('returns the counts on approval, including the unchanged ones', async () => {
    loadPage(task('t1', 'TODO'), task('t2', 'DONE'))
    const promise = updateTaskStatus({ taskIds: ['t1', 't2'], status: 'DONE' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())
    useCoworkStore().settleProposedStatusChange({ kind: 'approved', updated: 1, unchanged: 1 })

    expect(await promise).toEqual({ ok: true, content: 'approved: 1 updated, 1 unchanged' })
  })

  it('fails on rejection', async () => {
    loadPage(task('t1', 'TODO'))
    const promise = updateTaskStatus({ taskId: 't1', status: 'DONE' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())
    useCoworkStore().settleProposedStatusChange({ kind: 'rejected' })

    expect(await promise).toEqual({
      ok: false,
      content: 'rejected by user',
      error: 'user rejected the status change',
    })
  })

  it('fails on dismissal — a cancel is a failure, never a silent success (FR-AI-07)', async () => {
    loadPage(task('t1', 'TODO'))
    const promise = updateTaskStatus({ taskId: 't1', status: 'DONE' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())
    useCoworkStore().settleProposedStatusChange({ kind: 'dismissed' })

    expect(await promise).toEqual({
      ok: false,
      content: 'dismissed by user',
      error: 'user dismissed the confirmation',
    })
  })

  it('clears the card once the user answers', async () => {
    loadPage(task('t1', 'TODO'))
    const promise = updateTaskStatus({ taskId: 't1', status: 'DONE' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())
    useCoworkStore().settleProposedStatusChange({ kind: 'approved', updated: 1, unchanged: 0 })
    await promise

    expect(useCoworkStore().pendingStatusChange).toBeNull()
  })

  it('dismisses an open card rather than orphaning it when a new one arrives', async () => {
    loadPage(task('t1', 'TODO'), task('t2', 'TODO'))
    const first = updateTaskStatus({ taskId: 't1', status: 'DONE' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())
    const second = updateTaskStatus({ taskId: 't2', status: 'DONE' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange?.plan[0]?.taskId).toBe('t2'))

    useCoworkStore().settleProposedStatusChange({ kind: 'approved', updated: 1, unchanged: 0 })

    expect(failureOf(await first)).toBe('user dismissed the confirmation')
    expect((await second).ok).toBe(true)
  })

  it('performs no backend write itself (FR-AI-19)', async () => {
    loadPage(task('t1', 'TODO'))
    const promise = updateTaskStatus({ taskId: 't1', status: 'DONE' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())
    useCoworkStore().settleProposedStatusChange({ kind: 'approved', updated: 1, unchanged: 0 })
    await promise

    const methods = fetchMock.mock.calls.map((call) =>
      String((call[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase(),
    )
    expect(methods.filter((method) => method !== 'GET')).toEqual([])
  })
})

/**
 * FE-12 completes the loop FE-11 left open: approving the confirmation card is what
 * performs the write, from the **frontend**, through the normal REST endpoint. No backend
 * write tool is involved (FR-AI-19, OPEN-2).
 */
describe('approving the status confirmation performs the write (FE-12, FR-AI-19)', () => {
  const PAGE = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 1 }
  const STATS = {
    total: 0,
    byStatus: {},
    byPriority: {},
    assignees: [],
    overdueTotal: 0,
    dueThisWeek: 0,
    unassignedTotal: 0,
    createdLast7Days: 0,
  }

  function jsonResponse(body: unknown) {
    return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(body) }
  }

  /** Serves the refetches the store performs after a successful write, plus the write. */
  function stubBackend(bulkStatus?: unknown) {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>(
      (input) => {
        const url = String(input)
        if (url.includes('/tasks/bulk-status'))
          return Promise.resolve(jsonResponse(bulkStatus ?? { updated: 2, tasks: [] }))
        if (url.includes('/tasks/stats')) return Promise.resolve(jsonResponse(STATS))
        return Promise.resolve(jsonResponse(PAGE))
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function posts(fetchMock: Mock): RequestInit[] {
    return fetchMock.mock.calls
      .map((call) => call[1] as RequestInit | undefined)
      .filter((init): init is RequestInit => String(init?.method ?? 'GET').toUpperCase() === 'POST')
  }

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes through POST /api/tasks/bulk-status and resolves the documented content string', async () => {
    loadPage(task('t1', 'TODO'), task('t2', 'TODO'), task('t3', 'IN_PROGRESS'))
    const fetchMock = stubBackend({ updated: 2, tasks: [] })
    const handler = updateTaskStatus({ taskIds: ['t1', 't2', 't3'], status: 'IN_PROGRESS' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())

    await useCoworkStore().approveStatusChange()

    expect(await handler).toEqual({ ok: true, content: 'approved: 2 updated, 1 unchanged' })
    const writeCalls = posts(fetchMock)
    expect(writeCalls).toHaveLength(1)
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes('/tasks/bulk-status')),
    ).toBe(true)
  })

  it('never calls a backend write tool — the only write is the REST POST', async () => {
    loadPage(task('t1', 'TODO'), task('t2', 'TODO'))
    const fetchMock = stubBackend({ updated: 2, tasks: [] })
    const handler = updateTaskStatus({ taskIds: ['t1', 't2'], status: 'IN_PROGRESS' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())

    await useCoworkStore().approveStatusChange()
    await handler

    // Every non-GET request is the one bulk-status POST — nothing else, and no tool call.
    const nonGet = fetchMock.mock.calls.filter(
      (call) =>
        String((call[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase() !== 'GET',
    )
    expect(nonGet).toHaveLength(1)
    expect(String(nonGet[0]?.[0])).toContain('/tasks/bulk-status')
  })

  it('rejecting the card writes nothing and fails the handler', async () => {
    loadPage(task('t1', 'TODO'))
    const fetchMock = stubBackend()
    const handler = updateTaskStatus({ taskId: 't1', status: 'DONE' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())

    useCoworkStore().rejectStatusChange()

    expect(await handler).toEqual({
      ok: false,
      content: 'rejected by user',
      error: 'user rejected the status change',
    })
    expect(posts(fetchMock)).toHaveLength(0)
  })

  it('reports a failed write to the model instead of claiming the user rejected it', async () => {
    loadPage(task('t1', 'TODO'), task('t2', 'TODO'))
    // The bulk endpoint fails, so `bulkChangeStatus` returns false with a form error.
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>(
      (input) => {
        const url = String(input)
        if (url.includes('/tasks/bulk-status')) {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            text: async () =>
              JSON.stringify({
                type: 'illegal-transition',
                title: 'Illegal transition',
                status: 409,
                detail: 't2: Done cannot become In Progress',
              }),
          })
        }
        if (url.includes('/tasks/stats')) return Promise.resolve(jsonResponse(STATS))
        return Promise.resolve(jsonResponse(PAGE))
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const handler = updateTaskStatus({ taskIds: ['t1', 't2'], status: 'IN_PROGRESS' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())

    await useCoworkStore().approveStatusChange()
    const result = await handler

    expect(result.ok).toBe(false)
    expect(result.content).toContain('rejected')
    expect(result.content).not.toBe('rejected by user')
  })

  it('refuses a blocked batch without any write and tells the model why', async () => {
    loadPage(task('t1', 'BACKLOG'), task('t2', 'CANCELLED'))
    const fetchMock = stubBackend()
    const handler = updateTaskStatus({ taskIds: ['t1', 't2'], status: 'DONE' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingStatusChange).not.toBeNull())

    await useCoworkStore().approveStatusChange()
    const result = await handler

    expect(result.ok).toBe(false)
    expect(posts(fetchMock)).toHaveLength(0)
    expect(useUiStore().toasts.some((toast) => toast.kind === 'error')).toBe(true)
  })
})
