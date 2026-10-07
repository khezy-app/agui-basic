import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterLink, type Router } from 'vue-router'

import StatCards from '../components/dashboard/StatCards.vue'
import type { TaskStats } from '../domain/task'
import { routes } from '../router'
import { EMPTY_STATS } from './fixtures'

function makeStats(overrides: Partial<TaskStats> = {}): TaskStats {
  return { ...EMPTY_STATS, ...overrides }
}

async function mountCards(stats: TaskStats) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.isReady()

  const wrapper = mount(StatCards, { props: { stats }, global: { plugins: [router] } })
  return { wrapper, router }
}

function card(wrapper: VueWrapper, key: string) {
  return wrapper.get(`.stat-card[data-card="${key}"]`)
}

function linkTo(wrapper: VueWrapper, key: string) {
  return wrapper.findAllComponents(RouterLink).find((link) => link.attributes('data-card') === key)
}

function queryOf(router: Router, key: string, wrapper: VueWrapper) {
  const link = linkTo(wrapper, key)
  if (link === undefined) throw new Error(`no card link "${key}"`)
  return router.resolve(link.props('to')).query
}

describe('StatCards (FR-F-13)', () => {
  it('computes open tasks as total − DONE − CANCELLED', async () => {
    const { wrapper } = await mountCards(
      makeStats({
        total: 20,
        byStatus: { ...EMPTY_STATS.byStatus, DONE: 4, CANCELLED: 3 },
      }),
    )

    expect(card(wrapper, 'open').get('.stat-value').text()).toBe('13')
  })

  it('deep-links each card into the matching /tasks filter', async () => {
    const { wrapper, router } = await mountCards(makeStats({ overdueTotal: 2, dueThisWeek: 5 }))

    expect(queryOf(router, 'open', wrapper)).toEqual({
      status: 'BACKLOG,TODO,IN_PROGRESS,IN_REVIEW,BLOCKED',
    })
    expect(queryOf(router, 'overdue', wrapper)).toEqual({ overdue: 'true' })
    expect(queryOf(router, 'due-this-week', wrapper)).toEqual({ due: '7' })
    expect(queryOf(router, 'unassigned', wrapper)).toEqual({ unassigned: 'true' })
  })

  it('notes that the due-this-week card includes overdue items', async () => {
    const { wrapper } = await mountCards(makeStats({ dueThisWeek: 5 }))

    expect(card(wrapper, 'due-this-week').attributes('title')).toContain('already overdue')
  })

  it('keeps zero values visible but muted, and reddens only a positive overdue count', async () => {
    const { wrapper } = await mountCards(makeStats())
    expect(wrapper.findAll('.stat-card')).toHaveLength(4)
    expect(card(wrapper, 'overdue').get('.stat-value').text()).toBe('0')
    expect(card(wrapper, 'overdue').classes()).toContain('is-muted')
    expect(card(wrapper, 'overdue').classes()).not.toContain('is-danger')

    const { wrapper: withOverdue } = await mountCards(makeStats({ overdueTotal: 3 }))
    expect(card(withOverdue, 'overdue').classes()).toContain('is-danger')
    expect(card(withOverdue, 'overdue').classes()).not.toContain('is-muted')
  })
})
