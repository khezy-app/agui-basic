import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { ApiError } from '../api/errors'
import { taskApi } from '../api/tasks'
import BulkActionBar from '../components/task/BulkActionBar.vue'
import type { Task } from '../domain/task'
import { useTaskStore } from '../stores/tasks'
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

let wrapper: VueWrapper | undefined

async function mountBar(tasks: Task[], selectedIds: string[]) {
  const pinia = createPinia()
  setActivePinia(pinia)

  vi.mocked(taskApi.list).mockResolvedValue(makePage(tasks))
  const store = useTaskStore(pinia)
  await store.fetchList()
  store.selectAll(selectedIds)

  wrapper = mount(BulkActionBar, { global: { plugins: [pinia] } })
  await flushPromises()

  return { wrapper, store }
}

beforeEach(() => {
  vi.clearAllMocks()
  wrapper = undefined
})

afterEach(() => {
  wrapper?.unmount()
})

describe('BulkActionBar', () => {
  it('offers the intersection of legal targets across the selection', async () => {
    const mounted = await mountBar(
      [makeTask({ id: 'a', status: 'TODO' }), makeTask({ id: 'b', status: 'DONE' })],
      ['a', 'b'],
    )

    await mounted.wrapper.get('.bulk-actions button').trigger('click')

    const targets = mounted.wrapper
      .findAll('.bulk-target option:not([disabled])')
      .map((option) => option.text())
    expect(targets).toEqual(['Cancelled'])
  })

  it('disables confirm with an explanation when there is no common target', async () => {
    const mounted = await mountBar(
      [makeTask({ id: 'a', status: 'CANCELLED' }), makeTask({ id: 'b', status: 'TODO' })],
      ['a', 'b'],
    )

    await mounted.wrapper.get('.bulk-actions button').trigger('click')

    expect(mounted.wrapper.find('.bulk-empty-hint').exists()).toBe(true)
    expect(mounted.wrapper.get('.bulk-confirm').attributes('disabled')).toBeDefined()
  })

  it('confirms with the selected ids, the chosen status and the loaded versions', async () => {
    const mounted = await mountBar(
      [
        makeTask({ id: 'a', status: 'TODO', version: 3 }),
        makeTask({ id: 'b', status: 'TODO', version: 5 }),
      ],
      ['a', 'b'],
    )
    vi.mocked(taskApi.bulkStatus).mockResolvedValue({ updated: 2, tasks: [] })

    await mounted.wrapper.get('.bulk-actions button').trigger('click')
    await mounted.wrapper.get('.bulk-target select').setValue('IN_PROGRESS')
    await mounted.wrapper.get('.bulk-confirm').trigger('click')
    await flushPromises()

    expect(taskApi.bulkStatus).toHaveBeenCalledWith({
      ids: ['a', 'b'],
      status: 'IN_PROGRESS',
      reopen: false,
      expectedVersions: { a: 3, b: 5 },
    })
    expect(mounted.store.selectedIds).toEqual([])
  })

  it('keeps the panel open and shows the multi-line detail when the change is rejected', async () => {
    const mounted = await mountBar(
      [makeTask({ id: 'a', status: 'TODO' }), makeTask({ id: 'b', status: 'TODO' })],
      ['a', 'b'],
    )
    vi.mocked(taskApi.bulkStatus).mockRejectedValue(
      new ApiError({
        title: 'Illegal transition',
        status: 409,
        kind: 'illegal-transition',
        detail: 'Cannot move "Fix login" to IN_PROGRESS\nCannot move "Fix signup" to IN_PROGRESS',
      }),
    )

    await mounted.wrapper.get('.bulk-actions button').trigger('click')
    await mounted.wrapper.get('.bulk-target select').setValue('IN_PROGRESS')
    await mounted.wrapper.get('.bulk-confirm').trigger('click')
    await flushPromises()

    expect(mounted.wrapper.find('.bulk-panel').exists()).toBe(true)
    const error = mounted.wrapper.get('.bulk-error')
    expect(error.text()).toContain('Fix login')
    expect(error.text()).toContain('Fix signup')
  })
})
