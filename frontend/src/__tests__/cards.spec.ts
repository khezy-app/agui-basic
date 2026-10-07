import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import type { Component } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import CardBoundary from '@/components/cowork/CardBoundary.vue'
import ApprovalCard from '@/components/cowork/cards/ApprovalCard.vue'
import QuestionCard from '@/components/cowork/cards/QuestionCard.vue'
import StatsCard from '@/components/cowork/cards/StatsCard.vue'
import StatusChangeCard from '@/components/cowork/cards/StatusChangeCard.vue'
import TaskListCard from '@/components/cowork/cards/TaskListCard.vue'
import TaskSummaryCard from '@/components/cowork/cards/TaskSummaryCard.vue'
import { classify } from '@/components/cowork/cardRegistry'
import { routes } from '@/router'
import type { MutationDescription, PendingApproval } from '@/agui/resume'
import type { PendingStatusChange } from '@/stores/cowork'

let wrapper: VueWrapper | undefined

async function mountCard(component: Component, props: Record<string, unknown>) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.isReady()
  wrapper = mount(component, { props, global: { plugins: [router] } })
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

function makeApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    interruptId: 'i1',
    toolCallId: 'c1',
    messageId: 'm1',
    tool: 'update_task_status',
    args: { taskIds: ['t1'], status: 'IN_REVIEW' },
    summary: 'Move 1 task to In Review',
    reason: '',
    createdAt: 1,
    status: 'pending',
    error: null,
    restored: false,
    tasks: null,
    ...overrides,
  }
}

const DESCRIPTION: MutationDescription = {
  title: 'Move 1 task to In Review',
  lines: [
    { label: 'Task', value: 'Fix login redirect' },
    { label: 'Status', value: 'To Do → In Review' },
  ],
}

describe('TaskListCard (FR-AI-22)', () => {
  it('renders rows with links, flags overdue and shows "N of M"', async () => {
    const view = await mountCard(TaskListCard, {
      content: {
        tasks: [
          {
            id: 't1',
            title: 'Fix login',
            status: 'TODO',
            priority: 'HIGH',
            assignee: 'Ada',
            dueDate: '2026-01-01',
            overdue: true,
            tags: ['bug'],
          },
        ],
        total: 3,
        limit: 20,
      },
      args: { status: ['TODO'] },
    })

    expect(view.text()).toContain('1 of 3')
    expect(view.get('a.title').text()).toBe('Fix login')
    expect(view.get('a.title').attributes('href')).toBe('/tasks/t1')
    expect(view.get('.due').classes()).toContain('overdue')
    expect(view.get('.due').text()).toContain('overdue')
    expect(view.get('a.card-link').text()).toContain('Open in task list')
  })
})

describe('TaskSummaryCard', () => {
  it('renders the brief and links to the task', async () => {
    const view = await mountCard(TaskSummaryCard, {
      content: {
        brief: {
          id: 't9',
          title: 'Ship it',
          status: 'IN_REVIEW',
          priority: 'URGENT',
          assignee: null,
          dueDate: null,
          overdue: false,
          tags: [],
        },
        description: 'Long text',
      },
    })

    expect(view.text()).toContain('Ship it')
    expect(view.text()).toContain('Unassigned')
    expect(view.get('a.card-link').attributes('href')).toBe('/tasks/t9')
  })
})

describe('StatsCard', () => {
  it('renders the documented numbers and links to the dashboard', async () => {
    const view = await mountCard(StatsCard, {
      content: {
        total: 5,
        byStatus: { BLOCKED: 2 },
        byPriority: { HIGH: 1 },
        overdue: 1,
        dueThisWeek: 3,
        unassigned: 4,
      },
    })

    const text = view.text()
    expect(text).toContain('5 tasks')
    expect(text).toContain('Blocked')
    expect(text).toContain('Overdue')
    expect(text).toContain('Due this week')
    expect(text).toContain('Unassigned')
    expect(view.get('a.card-link').attributes('href')).toBe('/')
  })
})

describe('ApprovalCard', () => {
  it('renders the summary and argument lines, never raw JSON', async () => {
    const view = await mountCard(ApprovalCard, {
      approval: makeApproval(),
      description: DESCRIPTION,
    })

    expect(view.text()).toContain('Move 1 task to In Review')
    expect(view.text()).toContain('Fix login redirect')
    expect(view.text()).toContain('To Do → In Review')
    expect(view.text()).not.toContain('{')
  })

  it('emits approve/reject/dismiss and disables buttons while a resume is in flight', async () => {
    const view = await mountCard(ApprovalCard, {
      approval: makeApproval(),
      description: DESCRIPTION,
      inFlight: true,
    })

    view.findAll('button').forEach((button) => expect(button.attributes('disabled')).toBeDefined())

    await view.setProps({ inFlight: false })
    const buttons = view.findAll('button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    await buttons[2]!.trigger('click')

    expect(view.emitted('approve')).toEqual([['i1']])
    expect(view.emitted('reject')).toEqual([['i1']])
    expect(view.emitted('dismiss')).toEqual([['i1']])
  })
})

describe('QuestionCard (FR-AI-29)', () => {
  it('renders options and emits the chosen answer', async () => {
    const view = await mountCard(QuestionCard, {
      question: {
        id: 'q1',
        question: 'Which task?',
        options: ['Fix login', 'Ship it'],
        allowFreeText: false,
        createdAt: 1,
      },
    })

    expect(view.text()).toContain('Which task?')
    await view.findAll('.option')[0]!.trigger('click')
    expect(view.emitted('answer')).toEqual([['Fix login']])
  })

  it('supports free text when allowed and via "Ask something else"', async () => {
    const view = await mountCard(QuestionCard, {
      question: { id: 'q2', question: 'Any?', options: [], allowFreeText: true, createdAt: 1 },
    })

    const input = view.get('input')
    await input.setValue('  my answer ')
    await view.get('form').trigger('submit')
    expect(view.emitted('answer')).toEqual([['my answer']])
  })

  it('reveals the free-text field from "Ask something else" when it is not allowed', async () => {
    const view = await mountCard(QuestionCard, {
      question: {
        id: 'q3',
        question: 'Pick one',
        options: ['A'],
        allowFreeText: false,
        createdAt: 1,
      },
    })

    expect(view.find('input').exists()).toBe(false)
    await view.get('.btn.ghost').trigger('click')
    expect(view.find('input').exists()).toBe(true)
  })
})

describe('StatusChangeCard (FR-AI-19)', () => {
  it('lists per-task legality with reasons and emits approve/cancel', async () => {
    const change: PendingStatusChange = {
      id: 's1',
      status: 'IN_REVIEW',
      reopen: false,
      createdAt: 1,
      busy: false,
      plan: [
        {
          taskId: 't1',
          title: 'Fix login',
          from: 'TODO',
          to: 'IN_REVIEW',
          allowed: true,
          unchanged: false,
        },
        {
          taskId: 't2',
          title: 'Ship it',
          from: 'DONE',
          to: 'IN_REVIEW',
          allowed: false,
          unchanged: false,
          reason: 'Done cannot become In Review',
        },
      ],
    }
    const view = await mountCard(StatusChangeCard, { change })

    expect(view.text()).toContain('Done cannot become In Review')
    expect(view.get('.row.blocked')).toBeTruthy()

    await view.get('.btn.primary').trigger('click')
    await view.get('.btn.ghost').trigger('click')

    expect(view.emitted('approve')).toHaveLength(1)
    expect(view.emitted('cancel')).toHaveLength(1)
  })

  it('disables Approve all when no row can move', async () => {
    const view = await mountCard(StatusChangeCard, {
      change: {
        id: 's2',
        status: 'IN_REVIEW',
        reopen: false,
        createdAt: 1,
        busy: false,
        plan: [
          {
            taskId: 't1',
            title: 'Done task',
            from: 'DONE',
            to: 'IN_REVIEW',
            allowed: false,
            unchanged: false,
            reason: 'illegal',
          },
        ],
      },
    })

    expect(view.get('.btn.primary').attributes('disabled')).toBeDefined()
  })
})

describe('classify (FR-AI-21)', () => {
  it('maps backend read tools and errors onto cards', () => {
    expect(classify('query_tasks', { tasks: [], total: 0, limit: 20 })).toBe('task-list')
    expect(classify('get_task', { brief: { id: 't1' } })).toBe('task-summary')
    expect(classify('get_task_stats', { total: 1, byStatus: {} })).toBe('stats')
    expect(classify('query_tasks', { error: 'unknown assignee' })).toBe('error')
    expect(classify('query_tasks', '{"tasks":[],"total":0,"limit":20}')).toBe('task-list')
  })

  it('returns null for unknown tools and content so plain text renders', () => {
    expect(classify('open_task', { taskId: 't1' })).toBeNull()
    expect(classify('ask_user', undefined)).toBeNull()
    expect(classify('query_tasks', 'not json')).toBeNull()
    expect(classify('query_tasks', { tasks: 'nope' })).toBeNull()
  })
})

describe('CardBoundary', () => {
  it('renders a fallback instead of blanking the panel when a card throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Throwing = defineComponent({
      setup() {
        throw new Error('boom')
      },
      render: () => h('div'),
    })

    wrapper = mount(CardBoundary, { slots: { default: () => h(Throwing) } })
    await nextTick()

    expect(wrapper.text()).toContain('This result could not be displayed')
    consoleError.mockRestore()
  })
})

beforeEach(() => {
  localStorage.clear()
})
