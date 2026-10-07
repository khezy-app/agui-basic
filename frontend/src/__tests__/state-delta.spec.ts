import { describe, expect, it, vi } from 'vitest'
import type { Operation } from 'fast-json-patch'

import { applyDelta, emptyState, isDelta } from '@/agui/state'
import type { CoworkState } from '@/agui/state'

function doc(overrides: Partial<CoworkState['assistant']> = {}): CoworkState {
  return {
    ...emptyState(),
    assistant: { phase: 'idle', pendingAction: null, ...overrides },
  }
}

describe('applyDelta — the straightforward case', () => {
  it('updates only the field the patch names', () => {
    const before = doc()
    const next = applyDelta(before, [
      { op: 'replace', path: '/assistant/phase', value: 'thinking' },
    ])

    expect(next?.assistant.phase).toBe('thinking')
    expect(next?.context).toEqual(before.context)
  })

  it('appends to an array through the `-` segment', () => {
    // `draft` is agent-owned, so this exercises the append mechanics end to end:
    // the patch lands in the agent's view and survives the ownership merge.
    const next = applyDelta(doc(), [
      {
        op: 'replace',
        path: '/draft',
        value: { task: { title: 'Fix login redirect' }, taskId: null, source: 'ai', missing: [] },
      },
      { op: 'add', path: '/draft/missing/-', value: 'assigneeId' },
    ])

    expect(next?.draft?.missing).toEqual(['assigneeId'])
  })

  it('drops a patch to a frontend-owned array — ownership, not mechanics (FR-S-01)', () => {
    // The `-` segment is handled correctly (proved above), but `context` belongs to
    // the frontend, so an agent-side append never reaches the UI.
    const next = applyDelta(doc(), [{ op: 'add', path: '/context/selectedIds/-', value: 't9' }])

    expect(next?.context.selectedIds).toEqual([])
  })

  it('writes a pendingAction through the patch', () => {
    const pendingAction = {
      id: 'pa1',
      tool: 'update_task_status',
      summary: 'Mark 2 tasks DONE',
      args: { taskIds: ['a'] },
      origin: 'm1',
    }

    const next = applyDelta(doc(), [
      { op: 'replace', path: '/assistant/pendingAction', value: pendingAction },
    ])

    expect(next?.assistant.pendingAction).toEqual(pendingAction)
  })

  it('does not mutate the input document', () => {
    const before = doc()
    applyDelta(before, [{ op: 'replace', path: '/assistant/phase', value: 'thinking' }])

    expect(before.assistant.phase).toBe('idle')
  })
})

describe('applyDelta — atomicity (FR-S-02)', () => {
  it('leaves the document untouched and returns null when one operation fails', () => {
    const before = doc({ phase: 'thinking' })
    const broken: Operation[] = [
      { op: 'replace', path: '/assistant/phase', value: 'done' },
      { op: 'replace', path: '/does/not/exist', value: 1 },
    ]

    const next = applyDelta(before, broken)

    expect(next).toBeNull()
    expect(before.assistant.phase).toBe('thinking')
  })

  it('returns null rather than throwing on a malformed delta', () => {
    expect(
      applyDelta(doc(), [{ op: 'bogus', path: '/assistant/phase' } as unknown as Operation]),
    ).toBeNull()
    expect(applyDelta(doc(), 'not-a-patch' as unknown as Operation[])).toBeNull()
    expect(applyDelta(doc(), [null as unknown as Operation])).toBeNull()
  })
})

describe('applyDelta — rebasing onto the sent document', () => {
  /** What the run started with, before the user changed anything locally. */
  const lastSent = doc({ phase: 'thinking' })

  /** What we hold now: the user has filtered and selected since the run began. */
  const current: CoworkState = {
    ...lastSent,
    context: {
      ...lastSent.context,
      view: 'task-detail',
      selectedIds: ['local-1', 'local-2'],
      filters: { ...lastSent.context.filters, q: 'typed by the user' },
    },
  }

  it('produces the agent-owned fields the patch describes', () => {
    const next = applyDelta(
      current,
      [{ op: 'replace', path: '/assistant/phase', value: 'done' }],
      lastSent,
    )

    expect(next?.assistant.phase).toBe('done')
  })

  it('keeps our local context even when the patch targets it', () => {
    // The agent's `update_state` produced a whole state and the backend diffed it.
    // That diff was computed against `lastSent`, so its context entries describe the
    // *run's* view of the app — which is already stale by the time we receive it.
    const next = applyDelta(
      current,
      [
        { op: 'replace', path: '/context/filters/q', value: 'agent thought this' },
        { op: 'add', path: '/context/selectedIds/-', value: 'agent-picked' },
      ],
      lastSent,
    )

    expect(next?.context).toBe(current.context)
    expect(next?.context.filters.q).toBe('typed by the user')
    expect(next?.context.selectedIds).toEqual(['local-1', 'local-2'])
  })

  it('defaults the baseline to the current document when none is given', () => {
    const next = applyDelta(current, [{ op: 'replace', path: '/assistant/phase', value: 'done' }])

    expect(next?.assistant.phase).toBe('done')
    expect(next?.context).toBe(current.context)
  })

  it('still accepts an agent-written draft through the rebase', () => {
    const draft = { task: { title: 'Fix login redirect' }, taskId: 't9', source: 'ai', missing: [] }

    const next = applyDelta(current, [{ op: 'replace', path: '/draft', value: draft }], lastSent)

    expect(next?.draft).toEqual(draft)
  })
})

describe('isDelta', () => {
  it('accepts a well-formed operation list', () => {
    expect(isDelta([{ op: 'remove', path: '/draft' }])).toBe(true)
    expect(isDelta([{ op: 'replace', path: '/assistant/phase', value: 'done' }])).toBe(true)
  })

  it.each([
    [null],
    ['nope'],
    [[{ op: 'replace' }]],
    [[{ path: '/x' }]],
    [[{ op: 'replace', path: '/x' }]],
    [[null]],
  ])('rejects %p', (value) => {
    expect(isDelta(value)).toBe(false)
  })
})

describe('applyDelta — no console noise on success', () => {
  it('stays silent for a well-formed patch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    applyDelta(doc(), [{ op: 'replace', path: '/assistant/phase', value: 'thinking' }])

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
