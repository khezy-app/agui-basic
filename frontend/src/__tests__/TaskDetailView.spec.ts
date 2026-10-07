import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { ApiError } from '../api/errors'
import { taskApi } from '../api/tasks'
import { teamApi } from '../api/team'
import ErrorBlock from '../components/task/ErrorBlock.vue'
import { useConfirm } from '../composables/confirm'
import { routes } from '../router'
import { useTaskStore } from '../stores/tasks'
import TaskDetailView from '../views/TaskDetailView.vue'
import { EMPTY_STATS, makePage, makeTask, TEAM_MEMBERS } from './fixtures'
import type { Task } from '../domain/task'

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

vi.mock('../api/team', () => ({ teamApi: { list: vi.fn<typeof teamApi.list>() } }))

let router: Router
let wrapper: VueWrapper | undefined

async function mountDetail(task: Task | null, failure?: ApiError) {
  const pinia = createPinia()
  setActivePinia(pinia)

  vi.mocked(teamApi.list).mockResolvedValue(TEAM_MEMBERS)
  vi.mocked(taskApi.list).mockResolvedValue(makePage([]))
  vi.mocked(taskApi.stats).mockResolvedValue(EMPTY_STATS)
  if (failure) {
    vi.mocked(taskApi.get).mockRejectedValue(failure)
  } else if (task) {
    vi.mocked(taskApi.get).mockResolvedValue(task)
  }

  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/tasks/t1')
  await router.isReady()

  wrapper = mount(TaskDetailView, { props: { id: 't1' }, global: { plugins: [pinia, router] } })
  await flushPromises()

  return { wrapper, store: useTaskStore(pinia) }
}

beforeEach(() => {
  vi.clearAllMocks()
  wrapper = undefined
  // The confirm dialog is a singleton; make sure no prompt leaks between tests.
  const { state, settleConfirm } = useConfirm()
  if (state.value) settleConfirm(false)
})

afterEach(() => {
  wrapper?.unmount()
})

describe('TaskDetailView', () => {
  it('renders every field, resolving the assignee and reporter names', async () => {
    const { wrapper: view } = await mountDetail(
      makeTask({
        id: 't1',
        title: 'Fix login redirect',
        description: 'The redirect loops after logout.',
        assigneeId: 'm1',
        reporterId: 'm2',
        dueDate: '2026-02-01',
        estimateHours: 3,
        tags: ['bug', 'auth'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      }),
    )

    const text = view.text()
    expect(text).toContain('Fix login redirect')
    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('Grace Hopper')
    expect(text).toContain('The redirect loops after logout.')
    expect(text).toContain('3 h')
    expect(text).toContain('bug')
    expect(text).toContain('auth')

    // Absolute timestamps live in the `title` (the visible text is human-friendly).
    expect(view.get('dd[title="2026-01-01T00:00:00Z"]').text()).toBe('1 Jan 2026')
  })

  it('flags an overdue due date', async () => {
    const { wrapper: view } = await mountDetail(
      makeTask({ id: 't1', dueDate: '2020-01-01', isOverdue: true }),
    )

    expect(view.find('.overdue-flag').exists()).toBe(true)
  })

  it('shows an error block with a back link when the task is not found', async () => {
    const { wrapper: view } = await mountDetail(
      null,
      new ApiError({ title: 'Not found', status: 404, kind: 'not-found', detail: 'no task' }),
    )

    expect(view.findComponent(ErrorBlock).exists()).toBe(true)
    expect(view.text()).toContain('Not found')
    expect(view.get('.back-link').attributes('href')).toBe('/tasks')
  })

  it('confirms, deletes and navigates back to the list', async () => {
    const { wrapper: view } = await mountDetail(makeTask({ id: 't1', title: 'Fix login' }))
    vi.mocked(taskApi.remove).mockResolvedValue(undefined)

    await view.get('.delete-button').trigger('click')
    await flushPromises()

    const { state, settleConfirm } = useConfirm()
    expect(state.value?.title).toBe('Delete task')
    expect(taskApi.remove).not.toHaveBeenCalled()

    settleConfirm(true)
    await flushPromises()

    expect(taskApi.remove).toHaveBeenCalledWith('t1', false)
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/tasks'))
  })

  it('does not delete when the confirmation is dismissed', async () => {
    const { wrapper: view } = await mountDetail(makeTask({ id: 't1' }))

    await view.get('.delete-button').trigger('click')
    await flushPromises()

    useConfirm().settleConfirm(false)
    await flushPromises()

    expect(taskApi.remove).not.toHaveBeenCalled()
  })

  it('changes status through the store and reverts the control on failure', async () => {
    const { wrapper: view } = await mountDetail(makeTask({ id: 't1', status: 'TODO' }))
    vi.mocked(taskApi.changeStatus).mockRejectedValue(
      new ApiError({
        title: 'Illegal transition',
        status: 409,
        kind: 'illegal-transition',
        detail: 'TODO → IN_PROGRESS is not allowed',
      }),
    )

    const select = view.get('.status-control')
    await select.setValue('IN_PROGRESS')
    await flushPromises()

    expect(taskApi.changeStatus).toHaveBeenCalledTimes(1)
    // OPEN-9: no optimistic update, so a rejected change snaps back to the server value.
    expect((select.element as HTMLSelectElement).value).toBe('TODO')
  })
})
