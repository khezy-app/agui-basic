import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { ApiError } from '../api/errors'
import { taskApi } from '../api/tasks'
import { DEFAULT_TASK_QUERY, type PageResponse, type Task, type TaskStats } from '../domain/task'
import type { TaskFormValue } from '../domain/validation'
import { useTaskStore } from '../stores/tasks'
import { useUiStore } from '../stores/ui'

vi.mock('../api/tasks', () => ({
  taskApi: {
    list: vi.fn<typeof taskApi.list>(),
    stats: vi.fn<typeof taskApi.stats>(),
    get: vi.fn<typeof taskApi.get>(),
    create: vi.fn<typeof taskApi.create>(),
    patch: vi.fn<typeof taskApi.patch>(),
    remove: vi.fn<typeof taskApi.remove>(),
    changeStatus: vi.fn<typeof taskApi.changeStatus>(),
    bulkStatus: vi.fn<typeof taskApi.bulkStatus>(),
  },
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Task 1',
    description: null,
    status: 'TODO',
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
    ...overrides,
  }
}

function makePage(
  content: Task[],
  overrides: Partial<PageResponse<Task>> = {},
): PageResponse<Task> {
  return { content, page: 0, size: 20, totalElements: content.length, totalPages: 1, ...overrides }
}

const VALID_FORM: TaskFormValue = {
  title: 'New task',
  description: '',
  status: 'TODO',
  priority: 'MEDIUM',
  assigneeId: null,
  reporterId: null,
  dueDate: '',
  estimateHours: '',
  tags: [],
}

const EMPTY_STATS: TaskStats = {
  total: 0,
  byStatus: {
    BACKLOG: 0,
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    BLOCKED: 0,
    DONE: 0,
    CANCELLED: 0,
  },
  byPriority: { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 },
  assignees: [],
  overdueTotal: 0,
  dueThisWeek: 0,
  unassignedTotal: 0,
  createdLast7Days: 0,
}

describe('useTaskStore', () => {
  let store: ReturnType<typeof useTaskStore>
  let pushToast: Mock

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())

    vi.mocked(taskApi.list).mockResolvedValue(makePage([]))
    vi.mocked(taskApi.stats).mockResolvedValue(EMPTY_STATS)
    vi.mocked(taskApi.get).mockResolvedValue(makeTask())
    vi.mocked(taskApi.create).mockResolvedValue(makeTask())
    vi.mocked(taskApi.patch).mockResolvedValue(makeTask())
    vi.mocked(taskApi.remove).mockResolvedValue(undefined)
    vi.mocked(taskApi.changeStatus).mockResolvedValue(makeTask())
    vi.mocked(taskApi.bulkStatus).mockResolvedValue({ updated: 0, tasks: [] })

    const ui = useUiStore()
    pushToast = vi.spyOn(ui, 'pushToast').mockImplementation(() => {})
    store = useTaskStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts idle with the default query', () => {
    expect(store.listState).toBe('idle')
    expect(store.tasks).toEqual([])
    expect(store.query).toEqual(DEFAULT_TASK_QUERY)
    expect(store.view).toBe('task-list')
  })

  it('loads the first page without a toast', async () => {
    vi.mocked(taskApi.list).mockResolvedValue(
      makePage([makeTask()], { totalElements: 1, totalPages: 1 }),
    )

    await store.fetchList()

    expect(store.listState).toBe('ready')
    expect(store.tasks.map((task) => task.id)).toEqual(['t1'])
    expect(store.totalElements).toBe(1)
    expect(store.totalPages).toBe(1)
    expect(pushToast).not.toHaveBeenCalled()
  })

  it('aborts an in-flight list request so only the last response wins', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    let resolveFirst: ((value: PageResponse<Task>) => void) | undefined

    vi.mocked(taskApi.list)
      .mockImplementationOnce(
        () =>
          new Promise<PageResponse<Task>>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(makePage([makeTask({ id: 'second' })]))

    const first = store.fetchList()
    const second = store.fetchList()

    await second
    expect(abortSpy).toHaveBeenCalledTimes(1)
    expect(store.tasks.map((task) => task.id)).toEqual(['second'])

    resolveFirst?.(makePage([makeTask({ id: 'first' })]))
    await first

    expect(store.tasks.map((task) => task.id)).toEqual(['second'])
  })

  it('treats an aborted list request as a no-op', async () => {
    const cancelled = new ApiError({
      title: 'Request cancelled',
      status: 0,
      kind: 'network',
      detail: 'Request cancelled',
      retryable: false,
    })

    vi.mocked(taskApi.list)
      .mockImplementationOnce(
        (_query, signal) =>
          new Promise<PageResponse<Task>>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(cancelled))
          }),
      )
      .mockResolvedValueOnce(makePage([makeTask({ id: 'fresh' })]))

    const first = store.fetchList()
    const second = store.fetchList()

    await second
    await first

    expect(pushToast).not.toHaveBeenCalled()
    expect(store.listState).toBe('ready')
    expect(store.tasks.map((task) => task.id)).toEqual(['fresh'])
  })

  it('surfaces a 500 as listError plus one toast', async () => {
    vi.mocked(taskApi.list).mockRejectedValue(
      new ApiError({ title: 'Server error', status: 500, kind: 'internal-error', detail: 'boom' }),
    )

    await store.fetchList()

    expect(store.listState).toBe('error')
    expect(store.listError?.status).toBe(500)
    expect(pushToast).toHaveBeenCalledTimes(1)
    expect(pushToast).toHaveBeenCalledWith({ kind: 'error', title: 'Server error', detail: 'boom' })
  })

  it('resets to page 0 when a filter changes', async () => {
    vi.mocked(taskApi.list).mockResolvedValue(
      makePage([makeTask()], { totalElements: 100, totalPages: 5 }),
    )

    await store.fetchList()
    await store.setPage(2)
    expect(store.query.page).toBe(2)

    vi.mocked(taskApi.list).mockClear()
    await store.setFilter('statuses', ['TODO'])

    expect(store.query.page).toBe(0)
    expect(store.query.statuses).toEqual(['TODO'])
    expect(taskApi.list).toHaveBeenCalledTimes(1)
  })

  it('honours an explicit page in setQuery', async () => {
    await store.setQuery({ page: 2 })

    expect(store.query.page).toBe(2)
  })

  it('clears filters on clearFilters but keeps sort and size', async () => {
    await store.setQuery({ statuses: ['TODO'], q: 'login', sort: 'title', size: 50, page: 2 })

    await store.clearFilters()

    expect(store.query.statuses).toEqual([])
    expect(store.query.q).toBeNull()
    expect(store.query.sort).toBe('title')
    expect(store.query.size).toBe(50)
    expect(store.query.page).toBe(0)
    expect(store.isFiltered).toBe(false)
  })

  it('toggles descending when the same field is sorted twice', async () => {
    await store.setSort('createdAt')
    expect(store.query.descending).toBe(false)

    await store.setSort('createdAt')
    expect(store.query.descending).toBe(true)
  })

  it('defaults a new sort field to ascending', async () => {
    await store.setSort('title')

    expect(store.query.sort).toBe('title')
    expect(store.query.descending).toBe(false)
  })

  it('drops selected ids when the page changes', async () => {
    vi.mocked(taskApi.list).mockResolvedValueOnce(
      makePage([makeTask({ id: 'a' }), makeTask({ id: 'b' })], { page: 0, totalPages: 2 }),
    )

    await store.fetchList()
    store.selectAll(['a', 'b'])
    expect(store.selectedIds).toEqual(['a', 'b'])

    vi.mocked(taskApi.list).mockResolvedValueOnce(
      makePage([makeTask({ id: 'c' })], { page: 1, totalPages: 2 }),
    )
    await store.setPage(1)

    expect(store.query.page).toBe(1)
    expect(store.selectedIds).toEqual([])
  })

  it('exposes the FE-10 projections', async () => {
    vi.mocked(taskApi.list).mockResolvedValue(
      makePage([makeTask({ id: 'a' }), makeTask({ id: 'b' })]),
    )

    await store.fetchList()
    store.selectAll(['a', 'b'])

    expect(store.visibleTaskIds).toEqual(['a', 'b'])
    expect(store.selectedTasks.map((task) => task.id)).toEqual(['a', 'b'])
    expect(store.allOnPageSelected).toBe(true)
    expect(store.isEmpty).toBe(false)
    expect(store.pageCount).toBe(1)
  })

  it('records the current view for the AI context', () => {
    store.setView('task-detail')

    expect(store.view).toBe('task-detail')
  })

  it('rejects an invalid form without calling the API', async () => {
    const result = await store.saveTask('create', null, { ...VALID_FORM, title: '   ' })

    expect(result).toBe(false)
    expect(taskApi.create).not.toHaveBeenCalled()
    expect(store.formState).toBe('error')
    expect(store.formErrors.title).toBeDefined()
  })

  it('creates via POST without server-owned fields and refetches', async () => {
    const result = await store.saveTask('create', null, VALID_FORM)

    expect(result).toBe(true)
    expect(taskApi.create).toHaveBeenCalledTimes(1)

    const body = vi.mocked(taskApi.create).mock.calls[0]?.[0] as Record<string, unknown>
    expect(body).not.toHaveProperty('version')
    expect(body).not.toHaveProperty('isOverdue')
    expect(taskApi.list).toHaveBeenCalledTimes(1)
    expect(taskApi.stats).toHaveBeenCalledTimes(1)
    expect(store.formState).toBe('idle')
  })

  it('PATCHes with the version of the loaded task', async () => {
    vi.mocked(taskApi.list).mockResolvedValue(makePage([makeTask({ id: 't1', version: 7 })]))
    await store.fetchList()

    const result = await store.saveTask('patch', 't1', VALID_FORM)

    expect(result).toBe(true)
    expect(taskApi.patch).toHaveBeenCalledWith('t1', expect.anything(), 7)
  })

  it('maps a server 400 onto formErrors', async () => {
    vi.mocked(taskApi.create).mockRejectedValue(
      new ApiError({
        title: 'Validation failed',
        status: 400,
        kind: 'validation-failed',
        detail: 'invalid',
        fieldErrors: [{ field: 'title', message: 'must not be blank' }],
      }),
    )

    const result = await store.saveTask('create', null, VALID_FORM)

    expect(result).toBe(false)
    expect(store.formState).toBe('error')
    expect(store.formErrors).toEqual({ title: 'must not be blank' })
  })

  it('shows an illegal transition detail verbatim and does not refetch', async () => {
    vi.mocked(taskApi.changeStatus).mockRejectedValue(
      new ApiError({
        title: 'Illegal transition',
        status: 409,
        kind: 'illegal-transition',
        detail: 'DONE → BACKLOG is not allowed',
      }),
    )

    const result = await store.changeStatus('t1', 'BACKLOG')

    expect(result).toBe(false)
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', detail: 'DONE → BACKLOG is not allowed' }),
    )
    expect(taskApi.list).not.toHaveBeenCalled()
  })

  it('flags a version conflict as retryable', async () => {
    vi.mocked(taskApi.changeStatus).mockRejectedValue(
      new ApiError({
        title: 'Version conflict',
        status: 409,
        kind: 'version-conflict',
        detail: 'reload the task and try again',
      }),
    )

    const result = await store.changeStatus('t1', 'DONE')

    expect(result).toBe(false)
    expect(store.formErrors.version).toBe('reload the task and try again')
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ retryable: true }))
  })

  it('reports a rejected bulk change without refetching', async () => {
    store.selectAll(['a', 'b'])
    vi.mocked(taskApi.bulkStatus).mockRejectedValue(
      new ApiError({
        title: 'Illegal transition',
        status: 409,
        kind: 'illegal-transition',
        detail: 'Cannot move "Fix login" to DONE',
      }),
    )

    const result = await store.bulkChangeStatus(['a', 'b'], 'DONE')

    expect(result).toBe(false)
    expect(taskApi.bulkStatus).toHaveBeenCalledTimes(1)
    expect(taskApi.list).not.toHaveBeenCalled()
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.stringContaining('Fix login') }),
    )
    expect(store.selectedIds).toEqual(['a', 'b'])
  })

  it('clears the selection and refetches after a bulk change', async () => {
    vi.mocked(taskApi.bulkStatus).mockResolvedValue({ updated: 2, tasks: [] })
    store.selectAll(['a', 'b'])

    const result = await store.bulkChangeStatus(['a', 'b'], 'DONE')

    expect(result).toBe(true)
    expect(store.selectedIds).toEqual([])
    expect(taskApi.list).toHaveBeenCalledTimes(1)
    expect(taskApi.stats).toHaveBeenCalledTimes(1)
  })

  it('refetches and clears the detail when the open task is deleted', async () => {
    await store.fetchDetail('t1')
    expect(store.activeTask).not.toBeNull()

    const result = await store.deleteTask('t1')

    expect(result).toBe(true)
    expect(taskApi.remove).toHaveBeenCalledWith('t1', false)
    expect(taskApi.list).toHaveBeenCalledTimes(1)
    expect(taskApi.stats).toHaveBeenCalledTimes(1)
    expect(store.activeTask).toBeNull()
    expect(store.activeTaskId).toBeNull()
  })
})
