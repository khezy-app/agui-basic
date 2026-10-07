import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import DueSoonList from '../components/dashboard/DueSoonList.vue'
import type { Task } from '../domain/task'
import { routes } from '../router'
import { useTeamStore } from '../stores/team'
import { makeTask, TEAM_MEMBERS } from './fixtures'

let wrapper: VueWrapper | undefined

async function mountList(dueSoon: Task[], unassigned: Task[]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useTeamStore(pinia).members = TEAM_MEMBERS

  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.isReady()

  wrapper = mount(DueSoonList, {
    props: { dueSoon, unassigned },
    global: { plugins: [pinia, router] },
  })
  return wrapper
}

beforeEach(() => {
  wrapper = undefined
})

afterEach(() => {
  wrapper?.unmount()
})

describe('DueSoonList (FR-F-14)', () => {
  it('caps each list at five rows and offers a "View all" link', async () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      makeTask({ id: `t${index}`, title: `Task ${index}` }),
    )

    const view = await mountList(many, many)

    expect(view.findAll('.due-panel[data-list="due-soon"] .due-row')).toHaveLength(5)
    expect(view.findAll('.due-panel[data-list="unassigned"] .due-row')).toHaveLength(5)
    expect(view.findAll('.view-all')).toHaveLength(2)
  })

  it('shows a one-line muted message instead of an empty panel', async () => {
    const view = await mountList([], [])

    expect(view.get('.due-panel[data-list="due-soon"] .due-empty').text()).toContain('Nothing due')
    expect(view.get('.due-panel[data-list="unassigned"] .due-empty').text()).toContain('assignee')
    expect(view.find('.due-row').exists()).toBe(false)
  })

  it('deep-links "View all" to the matching filter', async () => {
    const view = await mountList([makeTask()], [makeTask()])

    const dueSoonHref = view.get('.due-panel[data-list="due-soon"] .view-all').attributes('href')
    expect(dueSoonHref).toContain('due=7')
    expect(dueSoonHref).toContain('sort=dueDate')

    const unassignedHref = view
      .get('.due-panel[data-list="unassigned"] .view-all')
      .attributes('href')
    expect(unassignedHref).toContain('unassigned=true')
  })

  it('flags an overdue date, links the title to the detail page and names the assignee', async () => {
    const view = await mountList(
      [
        makeTask({
          id: 'a',
          title: 'Late',
          dueDate: '2026-01-01',
          isOverdue: true,
          assigneeId: 'm1',
        }),
      ],
      [makeTask({ id: 'b', title: 'No owner', assigneeId: null, dueDate: null })],
    )

    const overdueRow = view.get('.due-panel[data-list="due-soon"] .due-row')
    expect(overdueRow.get('.due-date').classes()).toContain('is-overdue')
    expect(overdueRow.get('.due-date').attributes('title')).toBe('Overdue')
    expect(overdueRow.get('.due-title').attributes('href')).toBe('/tasks/a')
    expect(overdueRow.get('.due-assignee').text()).toBe('Ada Lovelace')

    const unassignedRow = view.get('.due-panel[data-list="unassigned"] .due-row')
    expect(unassignedRow.get('.due-date').classes()).not.toContain('is-overdue')
    expect(unassignedRow.get('.due-assignee').text()).toBe('Unassigned')
  })
})
