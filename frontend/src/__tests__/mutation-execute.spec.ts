import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { collectTaskIds, executeMutation, MAX_TASK_IDS, stripServerOwned } from '@/agui/mutation'
import { makeTask, TEAM_MEMBERS } from './fixtures'
import { useTaskStore } from '@/stores/tasks'
import { useTeamStore } from '@/stores/team'

vi.mock('@/api/tasks', () => ({
  taskApi: {
    get: vi.fn<(id: string) => Promise<unknown>>(),
    create: vi.fn<(input: unknown) => Promise<unknown>>(),
    patch: vi.fn<(id: string, input: unknown, v?: number) => Promise<unknown>>(),
    changeStatus: vi.fn<(id: string, input: unknown) => Promise<unknown>>(),
    bulkStatus: vi.fn<(input: unknown) => Promise<unknown>>(),
    remove: vi.fn<(id: string, force?: boolean) => Promise<unknown>>(),
    list: vi.fn<() => Promise<unknown>>(),
    stats: vi.fn<() => Promise<unknown>>(),
  },
}))

import { taskApi } from '@/api/tasks'

function withTeam(...members: typeof TEAM_MEMBERS): void {
  useTeamStore().members = members.length > 0 ? members : TEAM_MEMBERS
}

beforeEach(() => {
  setActivePinia(createPinia())
  withTeam()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('stripServerOwned (FR-B-19 / INV-5)', () => {
  it('drops server-owned keys and reports them', () => {
    const { patch, ignored } = stripServerOwned({
      taskId: 't1',
      title: 'New',
      status: 'DONE',
      version: 7,
      isOverdue: true,
    })

    expect(patch).toEqual({ taskId: 't1', title: 'New' })
    expect(ignored).toEqual(['status', 'version', 'isOverdue'])
  })
})

describe('collectTaskIds (FR-AI-14)', () => {
  it('de-duplicates a single id plus a list', () => {
    expect(collectTaskIds({ taskId: 'a', taskIds: ['a', 'b'] })).toEqual({ ids: ['a', 'b'] })
  })

  it('refuses more than 100 ids', () => {
    const ids = Array.from({ length: MAX_TASK_IDS + 1 }, (_, index) => `t${index}`)

    expect(collectTaskIds({ taskIds: ids })).toEqual({
      error: `at most ${MAX_TASK_IDS} tasks can be changed at once`,
    })
  })

  it('refuses an empty selection', () => {
    expect(collectTaskIds({})).toEqual({ error: 'no task id was given' })
  })
})

describe('executeMutation — create_task', () => {
  it('calls the store create path with the mapped input', async () => {
    const store = useTaskStore()
    const createTask = vi.spyOn(store, 'createTask').mockResolvedValue(makeTask({ id: 'new' }))

    const outcome = await executeMutation('create_task', {
      title: 'Fix login',
      priority: 'HIGH',
      assigneeName: 'Ada Lovelace',
      dueDate: '2026-02-01',
      estimateHours: 3.5,
      tags: ['bug'],
    })

    expect(outcome.ok).toBe(true)
    expect(createTask).toHaveBeenCalledTimes(1)
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({
      title: 'Fix login',
      priority: 'HIGH',
      assigneeId: 'm1',
      dueDate: '2026-02-01',
      estimateHours: '3.5',
      tags: ['bug'],
    })
  })

  it('fails without any store call when the assignee cannot be resolved (FR-AI-12)', async () => {
    const store = useTaskStore()
    const createTask = vi.spyOn(store, 'createTask')

    const outcome = await executeMutation('create_task', { title: 'X', assigneeName: 'Ghost' })

    expect(outcome).toEqual({ ok: false, error: "unknown team member 'Ghost'", ignored: [] })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('rejects a malformed dueDate before any request', async () => {
    const store = useTaskStore()
    const createTask = vi.spyOn(store, 'createTask')

    const outcome = await executeMutation('create_task', { title: 'X', dueDate: '01/02/2026' })

    expect(outcome).toMatchObject({ ok: false, error: 'dueDate must be a date as yyyy-MM-dd' })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('reports the store validation message when the write is refused', async () => {
    const store = useTaskStore()
    vi.spyOn(store, 'createTask').mockImplementation(async () => {
      store.formErrors = { title: 'must not be blank' }
      return null
    })

    expect(await executeMutation('create_task', { title: '   ' })).toMatchObject({
      ok: false,
      error: 'create_task needs a title',
    })
  })
})

describe('executeMutation — update_task_status', () => {
  it('uses changeStatus for a single id', async () => {
    const store = useTaskStore()
    const changeStatus = vi.spyOn(store, 'changeStatus').mockResolvedValue(true)
    const bulk = vi.spyOn(store, 'bulkChangeStatus')
    store.lastWrite = { kind: 'status', result: makeTask({ status: 'DONE' }) }

    const outcome = await executeMutation('update_task_status', { taskId: 't1', status: 'DONE' })

    expect(changeStatus).toHaveBeenCalledWith('t1', 'DONE', false)
    expect(bulk).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(true)
  })

  it('uses bulkChangeStatus in one call for several ids', async () => {
    const store = useTaskStore()
    const single = vi.spyOn(store, 'changeStatus')
    const bulk = vi.spyOn(store, 'bulkChangeStatus').mockResolvedValue(true)
    store.lastWrite = { kind: 'bulk-status', result: { updated: 2, tasks: [] } }

    const outcome = await executeMutation('update_task_status', {
      taskIds: ['t1', 't2'],
      status: 'DONE',
    })

    expect(bulk).toHaveBeenCalledTimes(1)
    expect(bulk).toHaveBeenCalledWith(['t1', 't2'], 'DONE', false)
    expect(single).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(true)
  })

  it('forwards reopen and never fans out beyond one request', async () => {
    const store = useTaskStore()
    const bulk = vi.spyOn(store, 'bulkChangeStatus').mockResolvedValue(true)
    store.lastWrite = { kind: 'bulk-status', result: { updated: 2, tasks: [] } }

    await executeMutation('update_task_status', {
      taskIds: ['c1', 'c2'],
      status: 'TODO',
      reopen: true,
    })

    expect(bulk).toHaveBeenCalledTimes(1)
    expect(bulk).toHaveBeenCalledWith(['c1', 'c2'], 'TODO', true)
  })

  it('refuses an invalid status locally', async () => {
    const store = useTaskStore()
    const bulk = vi.spyOn(store, 'bulkChangeStatus')

    expect(
      await executeMutation('update_task_status', { taskId: 't1', status: 'NOPE' }),
    ).toMatchObject({ ok: false })
    expect(bulk).not.toHaveBeenCalled()
  })

  it('surfaces the backend refusal as an error', async () => {
    const store = useTaskStore()
    vi.spyOn(store, 'bulkChangeStatus').mockImplementation(async () => {
      store.formErrors = { ids: 'one row is illegal' }
      return false
    })

    expect(
      await executeMutation('update_task_status', { taskIds: ['t1', 't2'], status: 'DONE' }),
    ).toMatchObject({
      ok: false,
      error: 'one row is illegal',
    })
  })
})

describe('executeMutation — update_task_fields', () => {
  it('loads the current task, strips server-owned keys and patches through saveTask', async () => {
    const store = useTaskStore()
    const current = makeTask({ id: 't1', title: 'Old', description: null, tags: [] })
    ;(taskApi.get as unknown as Mock).mockResolvedValue(current)
    const saveTask = vi.spyOn(store, 'saveTask').mockResolvedValue(true)
    store.lastWrite = { kind: 'patch', result: { ...current, title: 'New' } }

    const outcome = await executeMutation('update_task_fields', {
      taskId: 't1',
      title: 'New',
      status: 'DONE',
    })

    expect(outcome).toEqual({ ok: true, result: { ...current, title: 'New' }, ignored: ['status'] })
    expect(saveTask).toHaveBeenCalledTimes(1)
    // The untouched fields are carried over from the loaded task, not defaulted.
    expect(saveTask.mock.calls[0]?.[2]).toMatchObject({ title: 'New', priority: current.priority })
  })

  it('reports a stripped field even when the patch cannot be applied', async () => {
    const store = useTaskStore()
    ;(taskApi.get as unknown as Mock).mockResolvedValue(makeTask({ id: 't1' }))
    vi.spyOn(store, 'saveTask').mockResolvedValue(false)

    const outcome = await executeMutation('update_task_fields', {
      taskId: 't1',
      version: 3,
      title: 'X',
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.ignored).toEqual(['version'])
  })

  it('fails when the target task cannot be loaded', async () => {
    const store = useTaskStore()
    ;(taskApi.get as unknown as Mock).mockRejectedValue(new Error('404'))
    const saveTask = vi.spyOn(store, 'saveTask')

    expect(
      await executeMutation('update_task_fields', { taskId: 'ghost', title: 'X' }),
    ).toMatchObject({
      ok: false,
      error: "could not load task 'ghost'",
    })
    expect(saveTask).not.toHaveBeenCalled()
  })

  it('fails on an unresolvable assignee without patching', async () => {
    const store = useTaskStore()
    ;(taskApi.get as unknown as Mock).mockResolvedValue(makeTask({ id: 't1' }))
    const saveTask = vi.spyOn(store, 'saveTask')

    expect(
      await executeMutation('update_task_fields', { taskId: 't1', assigneeName: 'Ghost' }),
    ).toMatchObject({ ok: false, error: "unknown team member 'Ghost'" })
    expect(saveTask).not.toHaveBeenCalled()
  })
})

describe('executeMutation — delete_task', () => {
  it('calls deleteTask and reports the C6 shape', async () => {
    const store = useTaskStore()
    const deleteTask = vi.spyOn(store, 'deleteTask').mockResolvedValue(true)

    expect(await executeMutation('delete_task', { taskId: 't1' })).toEqual({
      ok: true,
      result: { deleted: 't1' },
      ignored: [],
    })
    expect(deleteTask).toHaveBeenCalledWith('t1', false)
  })

  it('fails without a task id', async () => {
    const store = useTaskStore()
    const deleteTask = vi.spyOn(store, 'deleteTask')

    expect(await executeMutation('delete_task', {})).toMatchObject({ ok: false })
    expect(deleteTask).not.toHaveBeenCalled()
  })
})

describe('executeMutation — contract', () => {
  it('refuses an unknown intent without touching the store', async () => {
    expect(await executeMutation('drop_everything', {})).toMatchObject({ ok: false })
  })

  it('refuses non-object arguments', async () => {
    expect(await executeMutation('create_task', 'oops')).toMatchObject({ ok: false })
  })

  it('returns a JSON-serialisable payload with no reactive proxy (C6)', async () => {
    const store = useTaskStore()
    vi.spyOn(store, 'createTask').mockResolvedValue(makeTask({ id: 'new' }))

    const outcome = await executeMutation('create_task', { title: 'X' })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected success')
    const roundTripped = JSON.parse(JSON.stringify(outcome.result))
    expect(roundTripped).toEqual(outcome.result)
    expect(Object.isFrozen(roundTripped)).toBe(false)
  })
})

describe('task store write responses (FE-12 contract)', () => {
  it('records the created task as the last write result', async () => {
    const store = useTaskStore()
    const created = makeTask({ id: 'new' })
    ;(taskApi.create as unknown as Mock).mockResolvedValue(created)
    ;(taskApi.list as unknown as Mock).mockResolvedValue({
      content: [],
      page: 0,
      size: 20,
      totalElements: 0,
      totalPages: 1,
    })
    ;(taskApi.stats as unknown as Mock).mockResolvedValue({})

    await store.createTask({
      title: 'X',
      description: '',
      status: 'TODO',
      priority: 'MEDIUM',
      assigneeId: null,
      reporterId: null,
      dueDate: '',
      estimateHours: '',
      tags: [],
    } as never)

    expect(store.lastWrite).toEqual({ kind: 'create', result: created })
  })
})
