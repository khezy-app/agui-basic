import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { ApiError } from '../api/errors'
import { taskApi } from '../api/tasks'
import EmptyState from '../components/task/EmptyState.vue'
import ErrorBlock from '../components/task/ErrorBlock.vue'
import LoadingBlock from '../components/task/LoadingBlock.vue'
import TaskTable from '../components/task/TaskTable.vue'
import type { PageResponse, Task } from '../domain/task'
import { routes } from '../router'
import { useTaskStore } from '../stores/tasks'
import TaskListView from '../views/TaskListView.vue'
import { makePage, makeTask } from './fixtures'

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

let router: Router
let wrapper: VueWrapper | undefined

async function mountView(path = '/tasks') {
  const pinia = createPinia()
  setActivePinia(pinia)

  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()

  wrapper = mount(TaskListView, { global: { plugins: [pinia, router] } })
  await flushPromises()

  return { wrapper, store: useTaskStore(pinia) }
}

function listed(tasks: Task[]) {
  vi.mocked(taskApi.list).mockResolvedValue(makePage(tasks))
}

beforeEach(() => {
  vi.clearAllMocks()
  wrapper = undefined
})

afterEach(() => {
  wrapper?.unmount()
})

describe('TaskListView', () => {
  it('shows the loading skeleton on a cold load', async () => {
    vi.mocked(taskApi.list).mockImplementation(() => new Promise<PageResponse<Task>>(() => {}))

    const { wrapper: view } = await mountView()

    expect(view.findComponent(LoadingBlock).exists()).toBe(true)
    expect(view.findComponent(TaskTable).exists()).toBe(false)
  })

  it('shows an error block with title + detail, and retry refetches', async () => {
    vi.mocked(taskApi.list).mockRejectedValue(
      new ApiError({ title: 'Server error', status: 500, kind: 'internal-error', detail: 'boom' }),
    )

    const { wrapper: view } = await mountView()

    const block = view.findComponent(ErrorBlock)
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('Server error')
    expect(block.text()).toContain('boom')
    expect(taskApi.list).toHaveBeenCalledTimes(1)

    listed([makeTask()])
    await block.get('.error-retry').trigger('click')
    await flushPromises()

    expect(taskApi.list).toHaveBeenCalledTimes(2)
    expect(view.findComponent(TaskTable).exists()).toBe(true)
  })

  it('shows the create CTA empty state when there are no tasks', async () => {
    listed([])

    const { wrapper: view } = await mountView()

    const empty = view.findComponent(EmptyState)
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('No tasks yet')
    expect(empty.text()).toContain('Create task')
  })

  it('renders the table when tasks are loaded', async () => {
    listed([makeTask({ id: 'a' }), makeTask({ id: 'b' })])

    const { wrapper: view } = await mountView()

    expect(view.findComponent(TaskTable).exists()).toBe(true)
    expect(view.findComponent(EmptyState).exists()).toBe(false)
  })

  it('distinguishes a filtered-empty result from an unfiltered empty store', async () => {
    listed([])

    const { wrapper: view, store } = await mountView()
    expect(view.findComponent(EmptyState).text()).toContain('No tasks yet')

    await store.setQuery({ q: 'nothing-matches' })
    await flushPromises()

    expect(view.findComponent(EmptyState).text()).toContain('No tasks match these filters')
  })

  it('shows the selection bar only while something is selected', async () => {
    listed([makeTask({ id: 't1' })])

    const { wrapper: view, store } = await mountView()
    expect(view.find('.bulk-bar').exists()).toBe(false)

    store.selectAll(['t1'])
    await flushPromises()
    expect(view.get('.bulk-bar').text()).toContain('1 selected')

    await view.get('.bulk-clear').trigger('click')
    await flushPromises()
    expect(view.find('.bulk-bar').exists()).toBe(false)
  })

  it('hydrates the store from the URL and fetches once with those filters', async () => {
    listed([])

    const { store } = await mountView('/tasks?status=TODO&overdue=true')

    expect(store.query.statuses).toEqual(['TODO'])
    expect(store.query.overdue).toBe(true)
    expect(taskApi.list).toHaveBeenCalledTimes(1)
    expect(vi.mocked(taskApi.list).mock.calls[0]?.[0]).toMatchObject({
      statuses: ['TODO'],
      overdue: true,
    })
  })

  it('writes the store query back to the URL on a filter change', async () => {
    listed([])

    const { store } = await mountView()
    await store.setFilter('statuses', ['BLOCKED'])
    await flushPromises()

    expect(router.currentRoute.value.query.status).toBe('BLOCKED')
  })
})
