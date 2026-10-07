import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import App from '../App.vue'
import { routes } from '../router'
import { useUiStore } from '../stores/ui'

// The shell is mounted on data-backed routes (`/` fetches stats, `/tasks` fetches the
// list); stub the API modules so the shell tests never touch the network.
vi.mock('../api/tasks', () => ({
  taskApi: {
    list: vi.fn<() => Promise<unknown>>().mockResolvedValue({
      content: [],
      page: 0,
      size: 20,
      totalElements: 0,
      totalPages: 0,
    }),
    stats: vi.fn<() => Promise<unknown>>().mockResolvedValue({
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
    }),
    get: vi.fn<() => unknown>(),
    create: vi.fn<() => unknown>(),
    patch: vi.fn<() => unknown>(),
    remove: vi.fn<() => unknown>(),
    changeStatus: vi.fn<() => unknown>(),
    bulkStatus: vi.fn<() => unknown>(),
  },
}))

vi.mock('../api/team', () => ({
  teamApi: { list: vi.fn<() => Promise<unknown>>().mockResolvedValue([]) },
}))

async function mountApp(path = '/') {
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()

  const wrapper = mount(App, { global: { plugins: [pinia, router] } })
  await flushPromises()

  return { wrapper, ui: useUiStore(pinia) }
}

describe('App shell', () => {
  it('renders the sidebar with three nav items, the AI entry enabled', async () => {
    const { wrapper } = await mountApp()

    expect(wrapper.findAll('.nav-item')).toHaveLength(3)
    expect(wrapper.findAll('.nav-label').map((label) => label.text())).toEqual([
      'Dashboard',
      'Tasks',
      'AI Cowork',
    ])

    // FE-13: the AI Cowork entry toggles the docked panel instead of being disabled.
    const aiItem = wrapper.get('.nav-button')
    expect(aiItem.text()).toContain('AI Cowork')
    expect(aiItem.attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.app-shell-panel').exists()).toBe(false)

    await aiItem.trigger('click')
    expect(wrapper.find('.app-shell-panel').exists()).toBe(true)

    // Close it again so the shared panel state does not leak into the other shell tests.
    await wrapper.get('.app-shell-panel [aria-label="Close panel"]').trigger('click')
    expect(wrapper.find('.app-shell-panel').exists()).toBe(false)
  })

  it('renders the tasks route placeholder when navigating to /tasks', async () => {
    const { wrapper } = await mountApp('/tasks')

    expect(wrapper.get('.app-content h2').text()).toBe('Tasks')
    expect(wrapper.find('.app-shell-nav').exists()).toBe(true)
  })

  it('renders the not-found view but keeps the shell on unknown routes', async () => {
    const { wrapper } = await mountApp('/nope')

    expect(wrapper.get('.app-content h2').text()).toBe('Page not found')
    expect(wrapper.find('.app-shell-nav').exists()).toBe(true)
  })

  it('renders a toast with title and detail, and removes it on dismiss', async () => {
    const { wrapper, ui } = await mountApp()

    ui.pushToast({ kind: 'error', title: 'Save failed', detail: 'Title is required' })
    await flushPromises()

    const toast = wrapper.get('.toast')
    expect(toast.text()).toContain('Save failed')
    expect(toast.text()).toContain('Title is required')

    ui.toasts.slice().forEach((entry) => ui.dismissToast(entry.id))
    await flushPromises()

    expect(wrapper.find('.toast').exists()).toBe(false)
  })
})
