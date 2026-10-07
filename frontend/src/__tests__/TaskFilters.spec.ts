import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { taskApi } from '../api/tasks'
import TaskFilters from '../components/task/TaskFilters.vue'
import { useTaskStore } from '../stores/tasks'
import { useTeamStore } from '../stores/team'
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

let wrapper: VueWrapper | undefined

async function mountFilters() {
  const pinia = createPinia()
  setActivePinia(pinia)

  vi.mocked(taskApi.list).mockResolvedValue(makePage([]))
  useTeamStore(pinia).members = TEAM_MEMBERS

  wrapper = mount(TaskFilters, { global: { plugins: [pinia] } })
  await flushPromises()

  return { view: wrapper, store: useTaskStore(pinia) }
}

/** The `<label>` of a status/priority checkbox, matched by its visible text. */
function option(view: VueWrapper, text: string) {
  const match = view.findAll('.filter-option').find((label) => label.text().trim() === text)
  if (match === undefined) throw new Error(`no filter option "${text}"`)
  return match
}

beforeEach(() => {
  vi.clearAllMocks()
  wrapper = undefined
})

afterEach(() => {
  wrapper?.unmount()
})

describe('TaskFilters', () => {
  it('toggles a status into the full array, and back to empty on the last uncheck', async () => {
    const { view, store } = await mountFilters()

    await option(view, 'To Do').get('input').setValue(true)
    await flushPromises()
    expect(store.query.statuses).toEqual(['TODO'])

    await option(view, 'Blocked').get('input').setValue(true)
    await flushPromises()
    expect(store.query.statuses).toEqual(['TODO', 'BLOCKED'])

    await option(view, 'To Do').get('input').setValue(false)
    await option(view, 'Blocked').get('input').setValue(false)
    await flushPromises()
    expect(store.query.statuses).toEqual([])
  })

  it('selects "Unassigned" and clears it again when a member is chosen', async () => {
    const { view, store } = await mountFilters()

    await view.get('select[aria-label="Assignee"]').setValue('unassigned')
    await flushPromises()
    expect(store.query.unassigned).toBe(true)
    expect(store.query.assigneeId).toBeNull()

    await view.get('select[aria-label="Assignee"]').setValue('m1')
    await flushPromises()
    expect(store.query.assigneeId).toBe('m1')
    expect(store.query.unassigned).toBe(false)
  })

  it('maps the due select to overdue / dueWithinDays', async () => {
    const { view, store } = await mountFilters()

    await view.get('select[aria-label="Due"]').setValue('overdue')
    await flushPromises()
    expect(store.query.overdue).toBe(true)
    expect(store.query.dueWithinDays).toBeNull()

    await view.get('select[aria-label="Due"]').setValue('week')
    await flushPromises()
    expect(store.query.overdue).toBe(false)
    expect(store.query.dueWithinDays).toBe(7)
  })

  it('renders a chip per active filter and removes just that filter', async () => {
    const { view, store } = await mountFilters()

    await option(view, 'To Do').get('input').setValue(true)
    await flushPromises()

    const chip = view.get('.filter-chip')
    expect(chip.text()).toContain('Status: To Do')

    await chip.get('.chip-remove').trigger('click')
    await flushPromises()
    expect(store.query.statuses).toEqual([])
    expect(view.find('.filter-chip').exists()).toBe(false)
  })

  it('disables "Clear all" until a filter is active, then clears everything', async () => {
    const { view, store } = await mountFilters()

    expect(view.get('.clear-all').attributes('disabled')).toBeDefined()

    await option(view, 'Urgent').get('input').setValue(true)
    await flushPromises()
    expect(view.get('.clear-all').attributes('disabled')).toBeUndefined()

    await view.get('.clear-all').trigger('click')
    await flushPromises()
    expect(store.query.priorities).toEqual([])
    expect(store.isFiltered).toBe(false)
  })

  it('blocks an inverted created-range until corrected', async () => {
    const { view, store } = await mountFilters()

    await view.get('input[aria-label="Created from"]').setValue('2026-02-01')
    await view.get('input[aria-label="Created to"]').setValue('2026-01-01')
    await flushPromises()

    expect(view.find('.range-hint').exists()).toBe(true)
    const rangeApply = view.findAll('.inline-input')[1]
    if (rangeApply === undefined) throw new Error('no created-range block')
    expect(rangeApply.get('button').attributes('disabled')).toBeDefined()

    await view.get('input[aria-label="Created to"]').setValue('2026-03-01')
    await flushPromises()
    await rangeApply.get('button').trigger('click')
    await flushPromises()

    expect(store.query.createdFrom).toBe('2026-02-01')
    expect(store.query.createdTo).toBe('2026-03-01')
  })

  it('applies a lower-cased tag through the text input', async () => {
    const { view, store } = await mountFilters()

    await view.get('input[list="task-tag-options"]').setValue('BUGS')
    const tagApply = view.findAll('.inline-input')[0]
    if (tagApply === undefined) throw new Error('no tag block')
    await tagApply.get('button').trigger('click')
    await flushPromises()

    expect(store.query.tag).toBe('bugs')
  })
})
