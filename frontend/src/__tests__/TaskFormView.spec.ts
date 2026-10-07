import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'

import { ApiError } from '../api/errors'
import { taskApi } from '../api/tasks'
import { teamApi } from '../api/team'
import ErrorBlock from '../components/task/ErrorBlock.vue'
import LoadingBlock from '../components/task/LoadingBlock.vue'
import TaskForm from '../components/task/TaskForm.vue'
import { useConfirm } from '../composables/confirm'
import { useTaskDraft } from '../composables/useTaskDraft'
import type { Task } from '../domain/task'
import { routes } from '../router'
import { useTaskStore } from '../stores/tasks'
import { EMPTY_STATS, makePage, makeTask, TEAM_MEMBERS } from './fixtures'

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

// Mount through a RouterView so `onBeforeRouteLeave` finds its route record.
const Host = defineComponent({ render: () => h(RouterView) })

let router: Router
let wrapper: VueWrapper | undefined

async function mountAt(path: string) {
  const pinia = createPinia()
  setActivePinia(pinia)

  vi.mocked(teamApi.list).mockResolvedValue(TEAM_MEMBERS)
  vi.mocked(taskApi.list).mockResolvedValue(makePage([]))
  vi.mocked(taskApi.stats).mockResolvedValue(EMPTY_STATS)

  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()

  wrapper = mount(Host, { global: { plugins: [pinia, router] } })
  await flushPromises()

  return { wrapper, store: useTaskStore(pinia), router }
}

beforeEach(() => {
  vi.clearAllMocks()
  wrapper = undefined
  useTaskDraft().clear()
  const { state, settleConfirm } = useConfirm()
  if (state.value) settleConfirm(false)
})

afterEach(() => {
  wrapper?.unmount()
})

describe('TaskFormView', () => {
  it('creates from /tasks/new and navigates to the created task', async () => {
    vi.mocked(taskApi.create).mockResolvedValue(makeTask({ id: 't-new' }))
    vi.mocked(taskApi.get).mockResolvedValue(makeTask({ id: 't-new' }))

    const { wrapper: view, router: r } = await mountAt('/tasks/new')

    await view.get('#title').setValue('Fix login redirect')
    await view.get('form').trigger('submit')
    await flushPromises()

    expect(taskApi.create).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(r.currentRoute.value.path).toBe('/tasks/t-new'))
  })

  it('stays on /tasks/new when the create is rejected and maps the field error', async () => {
    vi.mocked(taskApi.create).mockRejectedValue(
      new ApiError({
        title: 'Validation failed',
        status: 400,
        kind: 'validation-failed',
        detail: 'invalid',
        fieldErrors: [{ field: 'title', message: 'must not be blank' }],
      }),
    )

    const { wrapper: view, store, router: r } = await mountAt('/tasks/new')

    await view.get('#title').setValue('A title')
    await view.get('form').trigger('submit')
    await flushPromises()

    expect(r.currentRoute.value.path).toBe('/tasks/new')
    expect(store.formErrors.title).toBe('must not be blank')
    expect((view.get('#title').element as HTMLInputElement).value).toBe('A title')
  })

  it('shows the loading block while /tasks/:id/edit loads', async () => {
    vi.mocked(taskApi.get).mockImplementation(() => new Promise<Task>(() => {}))

    const { wrapper: view } = await mountAt('/tasks/t1/edit')

    expect(view.findComponent(LoadingBlock).exists()).toBe(true)
    expect(view.findComponent(TaskForm).exists()).toBe(false)
  })

  it('renders the form once /tasks/:id/edit has loaded the task', async () => {
    vi.mocked(taskApi.get).mockResolvedValue(makeTask({ id: 't1', title: 'Loaded task' }))

    const { wrapper: view } = await mountAt('/tasks/t1/edit')

    expect(view.findComponent(TaskForm).exists()).toBe(true)
    expect((view.get('#title').element as HTMLInputElement).value).toBe('Loaded task')
  })

  it('renders the not-found block with a back link for a missing task', async () => {
    vi.mocked(taskApi.get).mockRejectedValue(
      new ApiError({ title: 'Not found', status: 404, kind: 'not-found', detail: 'no task' }),
    )

    const { wrapper: view } = await mountAt('/tasks/t1/edit')

    expect(view.findComponent(ErrorBlock).exists()).toBe(true)
    expect(view.get('.back-link').attributes('href')).toBe('/tasks')
  })

  it('saves an edit in place and navigates back to the detail view', async () => {
    vi.mocked(taskApi.get).mockResolvedValue(makeTask({ id: 't1', title: 'Loaded' }))
    vi.mocked(taskApi.patch).mockResolvedValue(makeTask({ id: 't1', title: 'Saved' }))

    const { wrapper: view, router: r } = await mountAt('/tasks/t1/edit')

    await view.get('#title').setValue('Saved')
    await view.get('form').trigger('submit')
    await flushPromises()

    expect(taskApi.patch).toHaveBeenCalledWith('t1', expect.anything(), 1)
    await vi.waitFor(() => expect(r.currentRoute.value.path).toBe('/tasks/t1'))
  })

  it('prompts before leaving a dirty form and honours the answer', async () => {
    const { wrapper: view, router: r } = await mountAt('/tasks/new')

    await view.get('#title').setValue('Dirty draft')
    const { state, settleConfirm } = useConfirm()

    const blocked = r.push('/tasks')
    await flushPromises()
    expect(state.value?.title).toBe('Discard unsaved changes?')

    settleConfirm(false)
    await flushPromises()
    await blocked
    expect(r.currentRoute.value.path).toBe('/tasks/new')

    const allowed = r.push('/tasks')
    await flushPromises()
    settleConfirm(true)
    await flushPromises()
    await allowed
    expect(r.currentRoute.value.path).toBe('/tasks')
  })

  it('leaves without prompting when nothing was changed', async () => {
    const { router: r } = await mountAt('/tasks/new')

    await r.push('/tasks')
    await flushPromises()

    expect(r.currentRoute.value.path).toBe('/tasks')
  })
})
