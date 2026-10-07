import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { taskApi } from '../api/tasks'
import TaskTable from '../components/task/TaskTable.vue'
import type { Task } from '../domain/task'
import { routes } from '../router'
import { useTaskStore } from '../stores/tasks'
import { useTeamStore } from '../stores/team'
import { makePage, makeTask, TEAM_MEMBERS } from './fixtures'

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

async function mountTable(tasks: Task[]) {
  const pinia = createPinia()
  setActivePinia(pinia)

  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/tasks')
  await router.isReady()

  vi.mocked(taskApi.list).mockResolvedValue(makePage(tasks))
  const store = useTaskStore(pinia)
  await store.fetchList()

  const team = useTeamStore(pinia)
  team.members = TEAM_MEMBERS

  wrapper = mount(TaskTable, { global: { plugins: [pinia, router] } })
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

describe('TaskTable', () => {
  it('renders one row per task with title, badge, priority, assignee and due date', async () => {
    const mounted = await mountTable([
      makeTask({
        id: 'a',
        title: 'Alpha',
        status: 'IN_REVIEW',
        priority: 'HIGH',
        assigneeId: 'm1',
        dueDate: '2026-10-07',
      }),
      makeTask({ id: 'b', title: 'Beta' }),
    ])

    expect(mounted.wrapper.findAll('.task-row')).toHaveLength(2)

    const first = mounted.wrapper.get('.task-row')
    expect(first.text()).toContain('Alpha')
    expect(first.text()).toContain('In Review')
    expect(first.text()).toContain('High')
    expect(first.text()).toContain('Ada Lovelace')
    expect(first.text()).toContain('7 Oct 2026')
  })

  it('flags an overdue due date and shows an em dash for a null one', async () => {
    const mounted = await mountTable([
      makeTask({ id: 'a', dueDate: '2020-01-01', isOverdue: true }),
      makeTask({ id: 'b', dueDate: null }),
    ])

    const dueCells = mounted.wrapper.findAll('tbody .col-due')
    expect(dueCells).toHaveLength(2)

    const overdue = dueCells[0]
    const empty = dueCells[1]
    expect(overdue?.classes()).toContain('due-overdue')
    expect(overdue?.attributes('title')).toBe('Overdue')
    expect(empty?.text()).toBe('—')
    expect(empty?.classes()).not.toContain('due-overdue')
  })

  it('reflects the store sort and toggles it when a header is clicked', async () => {
    const mounted = await mountTable([makeTask()])

    expect(mounted.wrapper.get('.col-title').attributes('aria-sort')).toBe('none')

    await mounted.wrapper.get('.col-title .sort-button').trigger('click')
    await flushPromises()
    expect(mounted.store.query.sort).toBe('title')
    expect(mounted.store.query.descending).toBe(false)
    expect(mounted.wrapper.get('.col-title').attributes('aria-sort')).toBe('ascending')

    await mounted.wrapper.get('.col-title .sort-button').trigger('click')
    await flushPromises()
    expect(mounted.store.query.descending).toBe(true)
    expect(mounted.wrapper.get('.col-title').attributes('aria-sort')).toBe('descending')
  })

  it('selects the whole page from the header checkbox and shows an indeterminate state', async () => {
    const mounted = await mountTable([makeTask({ id: 'a' }), makeTask({ id: 'b' })])

    await mounted.wrapper.get('thead input[type="checkbox"]').setValue(true)
    expect(mounted.store.selectedIds).toEqual(['a', 'b'])

    const header = () =>
      mounted.wrapper.get('thead input[type="checkbox"]').element as HTMLInputElement
    expect(header().indeterminate).toBe(false)

    mounted.store.toggleSelection('a')
    await flushPromises()

    expect(header().indeterminate).toBe(true)
    expect(header().checked).toBe(false)
  })

  it('navigates on row click but not from the selection checkbox', async () => {
    const mounted = await mountTable([makeTask({ id: 'abc' })])
    const push = vi.spyOn(router, 'push')

    await mounted.wrapper.get('.task-row input[type="checkbox"]').trigger('click')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()

    await mounted.wrapper.get('.task-row').trigger('click')
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/tasks/abc')
  })

  it('offers only the legal next statuses and a reopen affordance for CANCELLED', async () => {
    const mounted = await mountTable([
      makeTask({ id: 'done', status: 'DONE' }),
      makeTask({ id: 'cancelled', status: 'CANCELLED' }),
    ])

    const rows = mounted.wrapper.findAll('.task-row')
    const doneRow = rows[0]
    const cancelledRow = rows[1]
    if (!doneRow || !cancelledRow) throw new Error('expected both rows to render')

    await doneRow.get('.row-actions-toggle').trigger('click')
    const labels = doneRow.findAll('select option').map((option) => option.text())
    expect(labels).toContain('In Review')
    expect(labels).toContain('Cancelled')
    expect(labels).not.toContain('Backlog')

    await cancelledRow.get('.row-actions-toggle').trigger('click')
    expect(cancelledRow.find('.status-reopen').exists()).toBe(true)
    expect(cancelledRow.find('select').exists()).toBe(false)
  })
})
