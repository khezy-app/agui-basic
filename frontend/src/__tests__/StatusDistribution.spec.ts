import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterLink } from 'vue-router'

import StatusDistribution from '../components/dashboard/StatusDistribution.vue'
import type { TaskStatus } from '../domain/task'
import { routes } from '../router'
import { EMPTY_STATS } from './fixtures'

const WORKFLOW_ORDER: TaskStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'BLOCKED',
  'CANCELLED',
]

async function mountDistribution(byStatus: Record<TaskStatus, number>) {
  const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.isReady()

  const wrapper = mount(StatusDistribution, {
    props: { byStatus, total },
    global: { plugins: [router] },
  })
  return { wrapper, router }
}

function widthOf(element: Element): number {
  return Number.parseFloat((element as HTMLElement).style.width)
}

describe('StatusDistribution (FR-F-14)', () => {
  it('sizes segments as percentages of the total that sum to 100', async () => {
    const { wrapper } = await mountDistribution({
      BACKLOG: 1,
      TODO: 2,
      IN_PROGRESS: 3,
      IN_REVIEW: 1,
      DONE: 2,
      BLOCKED: 1,
      CANCELLED: 2,
    })

    const widths = wrapper.findAll('.dist-segment').map((segment) => widthOf(segment.element))
    expect(widths).toHaveLength(7)
    const sum = widths.reduce((acc, width) => acc + width, 0)
    expect(Math.abs(sum - 100)).toBeLessThan(0.01)
  })

  it('renders an empty track and a message when there are no tasks', async () => {
    const { wrapper } = await mountDistribution({ ...EMPTY_STATS.byStatus })

    expect(wrapper.find('.dist-segment').exists()).toBe(false)
    expect(wrapper.get('.dist-empty').text()).toContain('No tasks yet')
  })

  it('lists all seven statuses with counts, in workflow order', async () => {
    const { wrapper } = await mountDistribution({
      BACKLOG: 1,
      TODO: 2,
      IN_PROGRESS: 3,
      IN_REVIEW: 4,
      DONE: 5,
      BLOCKED: 6,
      CANCELLED: 7,
    })

    const rows = wrapper.findAll('.legend-row')
    expect(rows.map((row) => row.attributes('data-status'))).toEqual(WORKFLOW_ORDER)
    expect(rows.map((row) => row.get('.legend-count').text())).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
    ])
  })

  it('deep-links each legend row to /tasks?status=X', async () => {
    const { wrapper, router } = await mountDistribution({ ...EMPTY_STATS.byStatus, TODO: 1 })

    for (const row of wrapper.findAllComponents(RouterLink)) {
      const status = row.attributes('data-status')
      expect(router.resolve(row.props('to')).query).toEqual({ status })
    }
  })

  it('navigates to the filtered list when a legend row is clicked', async () => {
    const { wrapper, router } = await mountDistribution({ ...EMPTY_STATS.byStatus, BLOCKED: 1 })

    await wrapper.get('.legend-row[data-status="BLOCKED"]').trigger('click')
    // The target route is lazy-loaded, so the navigation resolves a tick after the click.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('tasks'))

    expect(router.currentRoute.value.query.status).toBe('BLOCKED')
  })
})
