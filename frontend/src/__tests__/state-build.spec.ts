import { describe, expect, it } from 'vitest'

import {
  VISIBLE_TASK_IDS_CAP,
  assistantPhaseFor,
  buildState,
  coerceState,
  draftFieldsToForm,
  draftFieldsToState,
  emptyState,
} from '@/agui/state'
import type { AssistantSlice, TaskStateSource } from '@/agui/state'

function taskSource(overrides: Partial<TaskStateSource> = {}): TaskStateSource {
  return {
    view: 'task-list',
    activeTaskId: 't1',
    selectedIds: ['t1', 't2'],
    visibleTaskIds: ['t1', 't2', 't3'],
    query: {
      statuses: ['TODO', 'IN_PROGRESS'],
      priorities: ['HIGH'],
      assigneeId: 'u1',
      q: 'login',
      overdue: true,
    },
    ...overrides,
  }
}

const IDLE: AssistantSlice = { phase: 'idle', pendingAction: null }

describe('buildState', () => {
  it('mirrors the task store into context', () => {
    const state = buildState(taskSource({ view: 'task-detail' }), null, IDLE)

    expect(state.context.view).toBe('task-detail')
    expect(state.context.taskId).toBe('t1')
    expect(state.context.selectedIds).toEqual(['t1', 't2'])
    expect(state.context.filters).toEqual({
      status: ['TODO', 'IN_PROGRESS'],
      priority: ['HIGH'],
      assigneeId: 'u1',
      q: 'login',
      overdue: true,
    })
  })

  it('formats today as the client local yyyy-MM-dd', () => {
    const state = buildState(taskSource(), null, IDLE)

    expect(state.context.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Local, not UTC: the same day the user's due dates are interpreted in.
    expect(state.context.today).toBe(todayLocal())
  })

  it('caps visibleTaskIds at 200 (FR-S-05)', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `t${i}`)
    const state = buildState(taskSource({ visibleTaskIds: ids }), null, IDLE)

    expect(state.context.visibleTaskIds).toHaveLength(VISIBLE_TASK_IDS_CAP)
    expect(state.context.visibleTaskIds[0]).toBe('t0')
    expect(state.context.visibleTaskIds[VISIBLE_TASK_IDS_CAP - 1]).toBe('t199')
  })

  it('carries no draft when there is none', () => {
    expect(buildState(taskSource(), null, IDLE).draft).toBeNull()
  })

  it('projects an AI draft with source ai and the unresolved fields', () => {
    const state = buildState(
      taskSource(),
      {
        taskId: 't9',
        fields: {
          title: 'Fix login redirect',
          status: 'TODO',
          estimateHours: '3.5',
          dueDate: '',
          description: '',
        },
        missing: ['assigneeId'],
      },
      IDLE,
    )

    expect(state.draft).toEqual({
      task: {
        title: 'Fix login redirect',
        status: 'TODO',
        estimateHours: 3.5,
        dueDate: null,
        description: null,
      },
      taskId: 't9',
      source: 'ai',
      missing: ['assigneeId'],
    })
  })

  it('copies the assistant slice through unchanged', () => {
    const pendingAction = {
      id: 'pa1',
      tool: 'update_task_status',
      summary: 'Mark 3 tasks DONE',
      args: { taskIds: ['a'] },
      origin: 'm1',
    }
    const state = buildState(taskSource(), null, { phase: 'awaiting_confirmation', pendingAction })

    expect(state.assistant).toEqual({ phase: 'awaiting_confirmation', pendingAction })
  })

  it('does not alias the store arrays it copied', () => {
    const source = taskSource()
    const state = buildState(source, null, IDLE)

    source.selectedIds.push('t4')
    source.query.statuses.push('DONE')

    expect(state.context.selectedIds).toEqual(['t1', 't2'])
    expect(state.context.filters.status).toEqual(['TODO', 'IN_PROGRESS'])
  })
})

describe('assistantPhaseFor', () => {
  it.each([
    ['idle', 'none', 'idle'],
    ['idle', 'success', 'done'],
    ['starting', 'none', 'thinking'],
    ['streaming', 'none', 'thinking'],
    ['awaiting_approval', 'interrupt', 'awaiting_confirmation'],
    ['interrupted', 'none', 'awaiting_confirmation'],
    ['error', 'error', 'error'],
    ['stopped', 'none', 'error'],
  ] as const)('maps %s + %s to %s', (phase, outcome, expected) => {
    expect(assistantPhaseFor(phase, outcome)).toBe(expected)
  })
})

describe('draft field conversion', () => {
  it('round-trips form values through the document shape', () => {
    const form = {
      title: 'Fix login',
      description: 'redirect loop',
      status: 'TODO' as const,
      priority: 'HIGH' as const,
      assigneeId: 'u1',
      dueDate: '2026-10-10',
      estimateHours: '3.5',
      tags: ['bug'],
    }

    expect(draftFieldsToForm(draftFieldsToState(form))).toEqual(form)
  })

  it('turns empty form text into null, as the REST body expects', () => {
    const task = draftFieldsToState({
      description: '',
      assigneeId: '',
      dueDate: '',
      estimateHours: '',
    })

    expect(task).toEqual({
      description: null,
      assigneeId: null,
      dueDate: null,
      estimateHours: null,
    })
  })

  it('leaves absent fields absent rather than blanking them', () => {
    expect(draftFieldsToState({ title: 'only a title' })).toEqual({ title: 'only a title' })
    expect(draftFieldsToForm({ status: 'DONE' })).toEqual({ status: 'DONE' })
  })
})

describe('coerceState', () => {
  it('repairs an unknown view and keeps unknown top-level keys (FR-S-06)', () => {
    const state = coerceState({
      context: { view: 'not-a-view', futureField: 'kept' },
      backendOnly: { nested: true },
    })

    expect(state.context.view).toBe('task-list')
    expect(state.backendOnly).toEqual({ nested: true })
    expect(state.assistant).toEqual({ phase: 'idle', pendingAction: null })
  })

  it('repairs non-array and unknown enum values without throwing', () => {
    const state = coerceState({
      context: {
        view: 'dashboard',
        selectedIds: 'nope',
        visibleTaskIds: [1, 't1', null],
        filters: { status: ['TODO', 'BOGUS'], priority: 'HIGH', overdue: 'yes' },
      },
    })

    expect(state.context.selectedIds).toEqual([])
    expect(state.context.visibleTaskIds).toEqual(['t1'])
    expect(state.context.filters.status).toEqual(['TODO'])
    expect(state.context.filters.priority).toEqual([])
    expect(state.context.filters.overdue).toBe(false)
  })

  it('drops malformed draft fields but keeps the rest of the draft', () => {
    const draft = coerceState({
      draft: {
        task: { title: 'ok', status: 'NOPE', estimateHours: 'five', tags: ['a', 2] },
        missing: ['x', 1],
      },
    }).draft

    expect(draft).toEqual({
      task: { title: 'ok', tags: ['a'] },
      taskId: null,
      source: 'ai',
      missing: ['x'],
    })
  })

  it('reads a well-formed pendingAction and rejects a malformed one', () => {
    expect(
      coerceState({
        assistant: { phase: 'thinking', pendingAction: { id: 'a', tool: 't', args: { x: 1 } } },
      }).assistant.pendingAction,
    ).toEqual({ id: 'a', tool: 't', summary: '', args: { x: 1 }, origin: null })

    expect(coerceState({ assistant: { pendingAction: 'nope' } }).assistant.pendingAction).toBeNull()
    expect(coerceState({ assistant: { phase: 'nope' } }).assistant.phase).toBe('idle')
  })

  it('returns a usable document for null, a string, an array or an empty object', () => {
    for (const malformed of [null, undefined, 'x', 42, [], {}]) {
      expect(() => coerceState(malformed)).not.toThrow()
      expect(coerceState(malformed)).toEqual(emptyState())
    }
  })

  it('repairs a missing today from the client clock', () => {
    expect(coerceState({ context: { today: '' } }).context.today).toBe(todayLocal())
  })
})

function todayLocal(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}
