import { describe, expect, it } from 'vitest'

import { applySnapshot, coerceState, emptyState, hasNewDraft, mergeOwned } from '@/agui/state'
import type { CoworkState } from '@/agui/state'

const BASE: CoworkState = {
  ...emptyState(),
  context: {
    ...emptyState().context,
    view: 'task-detail',
    taskId: 't7',
    selectedIds: ['t7'],
    filters: { status: ['TODO'], priority: [], assigneeId: null, q: 'mine', overdue: true },
  },
  draft: {
    task: { title: 'user is typing this' },
    taskId: null,
    source: 'ai',
    missing: [],
  },
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    context: { view: 'task-list', taskId: null, selectedIds: [], filters: {} },
    draft: null,
    assistant: { phase: 'thinking', pendingAction: null },
    ...overrides,
  }
}

describe('applySnapshot — ownership split (FR-S-01)', () => {
  it('adopts the incoming assistant phase', () => {
    const next = applySnapshot(
      BASE,
      snapshot({ assistant: { phase: 'thinking', pendingAction: null } }),
    )

    expect(next.assistant.phase).toBe('thinking')
  })

  it('adopts an incoming pendingAction', () => {
    const pendingAction = {
      id: 'pa1',
      tool: 'update_task_status',
      summary: 'Mark 3 tasks DONE',
      args: { taskIds: ['a', 'b'] },
      origin: 'm1',
    }

    const next = applySnapshot(
      BASE,
      snapshot({ assistant: { phase: 'awaiting_confirmation', pendingAction } }),
    )

    expect(next.assistant.pendingAction).toEqual(pendingAction)
  })

  it('ignores an incoming context that disagrees with ours', () => {
    const next = applySnapshot(BASE, snapshot())

    expect(next.context).toEqual(BASE.context)
    expect(next.context.view).toBe('task-detail')
    expect(next.context.taskId).toBe('t7')
  })

  it('accepts an agent-written draft — that is the prefill channel (FR-S-03)', () => {
    const draft = {
      task: { title: 'Fix login redirect' },
      taskId: 't9',
      source: 'ai',
      missing: ['assigneeId'],
    }

    const next = applySnapshot(BASE, snapshot({ draft }))

    expect(next.draft).toEqual(draft)
    expect(hasNewDraft(BASE, next)).toBe(true)
  })

  it('does not clear a local draft when the agent sends draft: null (FR-S-03)', () => {
    const next = applySnapshot(BASE, snapshot({ draft: null }))

    expect(next.draft).toEqual(BASE.draft)
    expect(hasNewDraft(BASE, next)).toBe(false)
  })

  it('preserves unknown top-level keys in both directions (FR-S-06)', () => {
    const localOnly = { ...BASE, localOnly: { kept: true } }
    const next = applySnapshot(localOnly, { ...snapshot(), backendOnly: { fresh: true } })

    expect(next.backendOnly).toEqual({ fresh: true })
    expect(next.localOnly).toEqual({ kept: true })
  })

  it('returns a new object every time', () => {
    const next = applySnapshot(BASE, snapshot())

    expect(next).not.toBe(BASE)
    expect(next.context).toBe(BASE.context)
  })
})

describe('applySnapshot — malformed input never throws', () => {
  it.each([null, undefined, 'x', 42, [], {}])('repairs %p into a usable document', (malformed) => {
    let next: CoworkState | undefined
    expect(() => {
      next = applySnapshot(BASE, malformed)
    }).not.toThrow()

    // Our owned half survives; the assistant half falls back to a safe default.
    expect(next?.context).toEqual(BASE.context)
    expect(next?.assistant).toEqual({ phase: 'idle', pendingAction: null })
  })

  it('repairs a partly broken document field by field', () => {
    const next = applySnapshot(BASE, {
      context: 'not-an-object',
      assistant: { phase: 'nonsense', pendingAction: { id: 5, args: 'x' } },
    })

    expect(next.context).toEqual(BASE.context)
    expect(next.assistant.phase).toBe('idle')
    expect(next.assistant.pendingAction).toEqual({
      id: '',
      tool: '',
      summary: '',
      args: {},
      origin: null,
    })
  })
})

describe('mergeOwned', () => {
  it('takes assistant unconditionally, even when it is empty', () => {
    const incoming = coerceState({ assistant: { phase: 'idle', pendingAction: null } })

    expect(mergeOwned(BASE, incoming).assistant).toEqual({ phase: 'idle', pendingAction: null })
  })

  it('is a no-op on context regardless of the incoming value', () => {
    const incoming = coerceState({ context: { view: 'dashboard', taskId: 'zzz' } })

    expect(mergeOwned(BASE, incoming).context).toBe(BASE.context)
  })
})
