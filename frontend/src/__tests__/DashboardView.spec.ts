import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { ApiError } from '../api/errors'
import { taskApi } from '../api/tasks'
import { teamApi } from '../api/team'
import DueSoonList from '../components/dashboard/DueSoonList.vue'
import PriorityBreakdown from '../components/dashboard/PriorityBreakdown.vue'
import StatCards from '../components/dashboard/StatCards.vue'
import StatusDistribution from '../components/dashboard/StatusDistribution.vue'
import ErrorBlock from '../components/task/ErrorBlock.vue'
import LoadingBlock from '../components/task/LoadingBlock.vue'
import type { TaskStats } from '../domain/task'
import { routes } from '../router'
import { useTaskStore } from '../stores/tasks'
import DashboardView from '../views/DashboardView.vue'
import { makePage, TEAM_MEMBERS } from './fixtures'

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

vi.mock('../api/team', () => ({
  teamApi: { list: vi.fn<typeof teamApi.list>() },
}))

const STATS: TaskStats = {
  total: 12,
  byStatus: {
    BACKLOG: 1,
    TODO: 2,
    IN_PROGRESS: 3,
    IN_REVIEW: 1,
    BLOCKED: 1,
    DONE: 3,
    CANCELLED: 1,
  },
  byPriority: { LOW: 3, MEDIUM: 3, HIGH: 3, URGENT: 3 },
  assignees: [],
  overdueTotal: 2,
  dueThisWeek: 4,
  unassignedTotal: 1,
  createdLast7Days: 5,
}

let router: Router
let wrapper: VueWrapper | undefined

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)

  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.isReady()

  wrapper = mount(DashboardView, { global: { plugins: [pinia, router] } })
  await flushPromises()

  return { view: wrapper, store: useTaskStore(pinia) }
}

beforeEach(() => {
  vi.clearAllMocks()
  wrapper = undefined
  vi.mocked(teamApi.list).mockResolvedValue(TEAM_MEMBERS)
  vi.mocked(taskApi.list).mockResolvedValue(makePage([]))
  vi.mocked(taskApi.stats).mockResolvedValue(STATS)
})

afterEach(() => {
  wrapper?.unmount()
})

describe('DashboardView (FR-F-03, FR-F-13, FR-F-14)', () => {
  it('shows the loading block while stats are in flight', async () => {
    vi.mocked(taskApi.stats).mockImplementation(() => new Promise<TaskStats>(() => {}))

    const { view } = await mountView()

    expect(view.findComponent(LoadingBlock).exists()).toBe(true)
    expect(view.findComponent(StatCards).exists()).toBe(false)
  })

  it('shows the error block and refetches stats on retry', async () => {
    vi.mocked(taskApi.stats).mockRejectedValue(
      new ApiError({ title: 'Server error', status: 500, kind: 'internal-error', detail: 'boom' }),
    )

    const { view } = await mountView()

    const block = view.findComponent(ErrorBlock)
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('boom')
    expect(taskApi.stats).toHaveBeenCalledTimes(1)

    vi.mocked(taskApi.stats).mockResolvedValue(STATS)
    await block.get('.error-retry').trigger('click')
    await flushPromises()

    expect(taskApi.stats).toHaveBeenCalledTimes(2)
    expect(view.findComponent(StatCards).exists()).toBe(true)
  })

  it('renders every section once stats are ready', async () => {
    const { view } = await mountView()

    expect(view.findComponent(StatCards).exists()).toBe(true)
    expect(view.findComponent(StatusDistribution).exists()).toBe(true)
    expect(view.findComponent(PriorityBreakdown).exists()).toBe(true)
    expect(view.findComponent(DueSoonList).exists()).toBe(true)
  })

  it('sets the dashboard view and fetches members + stats exactly once on mount', async () => {
    const { store } = await mountView()

    expect(store.view).toBe('dashboard')
    expect(teamApi.list).toHaveBeenCalledTimes(1)
    expect(taskApi.stats).toHaveBeenCalledTimes(1)
  })

  it('makes the two documented short-list calls', async () => {
    await mountView()

    expect(taskApi.list).toHaveBeenCalledTimes(2)
    expect(vi.mocked(taskApi.list).mock.calls[0]?.[0]).toMatchObject({
      dueWithinDays: 7,
      sort: 'dueDate',
      descending: false,
      size: 5,
    })
    expect(vi.mocked(taskApi.list).mock.calls[1]?.[0]).toMatchObject({
      unassigned: true,
      sort: 'createdAt',
      descending: true,
      size: 5,
    })
  })

  it('refetches stats, the task page and both lists when Refresh is pressed', async () => {
    const { view } = await mountView()
    vi.clearAllMocks()
    vi.mocked(teamApi.list).mockResolvedValue(TEAM_MEMBERS)
    vi.mocked(taskApi.list).mockResolvedValue(makePage([]))
    vi.mocked(taskApi.stats).mockResolvedValue(STATS)

    await view.get('.refresh-button').trigger('click')
    await flushPromises()

    expect(taskApi.stats).toHaveBeenCalledTimes(1)
    expect(taskApi.list).toHaveBeenCalledTimes(3)
  })
})
