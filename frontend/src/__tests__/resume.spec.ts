import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import type { Interrupt } from '@ag-ui/client'

import {
  approvalFromInterrupt,
  buildApprovalPayload,
  buildResume,
  DEFAULT_REJECTION_REASON,
  describeMutation,
  dismissedResume,
  isMutationIntent,
  NO_COMMON_STATUS_NOTE,
  proposalFromInterrupt,
  validateResumePayload,
} from '@/agui/resume'
import { makeTask } from './fixtures'
import { useTeamStore } from '@/stores/team'

/** BE-09's shipped interrupt shape: the proposal rides in `metadata.arguments` as JSON. */
function interrupt(overrides: Partial<Interrupt> = {}): Interrupt {
  return {
    id: 'i1',
    reason: 'input_required',
    message: 'propose_task_mutation',
    toolCallId: 'c1',
    metadata: {
      toolName: 'propose_task_mutation',
      arguments: JSON.stringify({
        tool: 'update_task_status',
        args: { taskIds: ['t1', 't2'], status: 'DONE' },
        summary: 'Mark 2 tasks Done',
        reason: 'The user asked for it.',
      }),
    },
    ...overrides,
  }
}

describe('buildApprovalPayload', () => {
  it('approve + success carries the REST result verbatim', () => {
    const response = buildApprovalPayload(true, { result: { id: 't1', version: 2 } })

    expect(response).toEqual({
      status: 'resolved',
      payload: { approved: true, result: { id: 't1', version: 2 } },
    })
  })

  it('approve + failure carries an error string, never a result', () => {
    const response = buildApprovalPayload(true, { error: 'The task is blocked' })

    expect(response).toEqual({
      status: 'resolved',
      payload: { approved: true, error: 'The task is blocked' },
    })
  })

  it('reject carries the reason', () => {
    const response = buildApprovalPayload(false, { reason: 'Not this one' })

    expect(response).toEqual({
      status: 'resolved',
      payload: { approved: false, reason: 'Not this one' },
    })
  })

  it('reject falls back to a default reason when none was typed', () => {
    const response = buildApprovalPayload(false, {})

    expect(response).toEqual({
      status: 'resolved',
      payload: { approved: false, reason: DEFAULT_REJECTION_REASON },
    })
  })

  it('dismiss is cancelled and carries no payload', () => {
    expect(dismissedResume()).toEqual({ status: 'cancelled' })
  })

  it('plain round-trips through JSON, so no reactive proxy reaches the payload', () => {
    const response = buildApprovalPayload(true, { result: { nested: { a: 1 } } })

    expect(JSON.parse(JSON.stringify(response))).toEqual(response)
  })
})

describe('validateResumePayload (mirrors the backend ResumePayloadValidator)', () => {
  it('accepts { approved: true, result: {…} }', () => {
    expect(validateResumePayload({ approved: true, result: { id: 't1' } })).toEqual({
      approved: true,
    })
  })

  it('accepts { approved: true, error: "…" }', () => {
    expect(validateResumePayload({ approved: true, error: 'nope' })).toEqual({ approved: true })
  })

  it('accepts { approved: false, reason: "…" }', () => {
    expect(validateResumePayload({ approved: false, reason: 'no' })).toEqual({ approved: false })
  })

  it('rejects { approved: "yes" }, {}, null and both result+error', () => {
    expect(validateResumePayload({ approved: 'yes' })).toBeNull()
    expect(validateResumePayload({})).toBeNull()
    expect(validateResumePayload(null)).toBeNull()
    expect(validateResumePayload({ approved: true, result: {}, error: 'x' })).toBeNull()
    expect(validateResumePayload({ approved: true })).toBeNull()
    expect(validateResumePayload({ approved: false })).toBeNull()
  })
})

describe('buildResume', () => {
  it('answers every open interrupt and throws when one is left out', () => {
    const open = [interrupt({ id: 'a' }), interrupt({ id: 'b' })]

    expect(buildResume(open, { a: dismissedResume(), b: dismissedResume() })).toHaveLength(2)
    expect(() => buildResume(open, { a: dismissedResume() })).toThrow(/missing responses/)
  })

  it('refuses to send a resolved payload that is not a documented C6 shape', () => {
    const open = [interrupt({ id: 'a' })]

    expect(() =>
      buildResume(open, {
        a: { status: 'resolved', payload: { approved: 'yes' } },
      }),
    ).toThrow(/not one of the documented C6 shapes/)
  })

  it('accepts every payload the builders produce', () => {
    const open = [interrupt({ id: 'a' })]

    for (const response of [
      buildApprovalPayload(true, { result: { id: 't1' } }),
      buildApprovalPayload(true, { error: 'nope' }),
      buildApprovalPayload(false, { reason: 'no' }),
      dismissedResume(),
    ]) {
      expect(buildResume(open, { a: response })).toHaveLength(1)
    }
  })
})

describe('proposalFromInterrupt', () => {
  it('parses the proposal out of metadata.arguments', () => {
    expect(proposalFromInterrupt(interrupt())).toEqual({
      tool: 'update_task_status',
      args: { taskIds: ['t1', 't2'], status: 'DONE' },
      summary: 'Mark 2 tasks Done',
      reason: 'The user asked for it.',
    })
  })

  it('falls back to the shared-state pendingAction when the metadata is unusable', () => {
    const bare = interrupt({ metadata: undefined })

    expect(
      proposalFromInterrupt(bare, {
        id: 'pa',
        tool: 'delete_task',
        summary: 'Delete one task',
        args: { taskId: 't9' },
        origin: 'm1',
      }),
    ).toMatchObject({ tool: 'delete_task', args: { taskId: 't9' }, summary: 'Delete one task' })
  })

  it('returns null for a proposal that is not one of the four intents', () => {
    const unknown = interrupt({
      metadata: { arguments: JSON.stringify({ tool: 'drop_database', args: {} }) },
    })

    expect(proposalFromInterrupt(unknown)).toBeNull()
  })

  it('returns null when arguments are not JSON', () => {
    expect(proposalFromInterrupt(interrupt({ metadata: { arguments: '{not json' } }))).toBeNull()
  })

  it('never throws on a malformed metadata record', () => {
    expect(proposalFromInterrupt(interrupt({ metadata: { arguments: 42 } }))).toBeNull()
    expect(proposalFromInterrupt(interrupt({ metadata: { arguments: '[]' } }))).toBeNull()
  })
})

describe('approvalFromInterrupt', () => {
  it('builds a card record from the shipped interrupt', () => {
    const card = approvalFromInterrupt(interrupt())

    expect(card).toMatchObject({
      interruptId: 'i1',
      toolCallId: 'c1',
      tool: 'update_task_status',
      summary: 'Mark 2 tasks Done',
      status: 'pending',
      error: null,
      restored: false,
    })
  })

  it('still produces an answerable card for an unrecognised proposal', () => {
    const unknown = interrupt({
      metadata: { arguments: JSON.stringify({ tool: 'nonsense', args: {} }) },
      reason: 'input_required',
    })

    expect(approvalFromInterrupt(unknown)).toMatchObject({ tool: '', status: 'pending' })
  })
})

describe('isMutationIntent', () => {
  it('accepts exactly the four documented intents', () => {
    expect(
      ['create_task', 'update_task_status', 'update_task_fields', 'delete_task'].every(
        isMutationIntent,
      ),
    ).toBe(true)
    expect(isMutationIntent('read_task')).toBe(false)
    expect(isMutationIntent(1)).toBe(false)
  })
})

describe('describeMutation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders a create task as friendly lines, never raw JSON', () => {
    const description = describeMutation('create_task', {
      title: 'Fix login',
      description: 'The form 500s',
      status: 'BLOCKED',
      priority: 'HIGH',
      dueDate: '2026-02-01',
      estimateHours: 3.5,
      tags: ['bug', 'auth'],
    })

    expect(description.title).toBe('Create a task')
    // No value is ever a JSON blob: every field is prose, a label or a list.
    const values = description.lines.map((line) => line.value).join(' | ')
    expect(values).not.toContain('{')
    expect(values).not.toContain('[')
    expect(description.lines).toContainEqual({ label: 'Title', value: 'Fix login' })
    expect(description.lines).toContainEqual({ label: 'Status', value: 'Blocked' })
    expect(description.lines).toContainEqual({ label: 'Tags', value: 'bug, auth' })
    expect(description.lines).toContainEqual({ label: 'Estimate', value: '3.5 h' })
  })

  it('resolves assigneeName to a display name through the team store', () => {
    useTeamStore().members = [
      { id: 'm1', displayName: 'Ada Lovelace', email: 'ada@example.com', role: 'ENGINEER' },
    ]

    const description = describeMutation('create_task', {
      title: 'Fix login',
      assigneeName: 'ada lovelace',
    })

    expect(description.lines).toContainEqual({ label: 'Assignee', value: 'Ada Lovelace' })
  })

  it('renders an unresolvable assignee as "unknown person" rather than the guessed name', () => {
    const description = describeMutation('create_task', {
      title: 'Fix login',
      assigneeName: 'Nobody At All',
    })

    expect(description.lines).toContainEqual({ label: 'Assignee', value: 'unknown person' })
    expect(JSON.stringify(description)).not.toContain('Nobody At All')
  })

  it('describes a delete with the task id when the title is unknown', () => {
    const description = describeMutation('delete_task', { taskId: 't9' })

    expect(description.title).toBe('Delete a task')
    expect(description.lines).toEqual([{ label: 'Task', value: 't9' }])
  })

  it('lists every task with current → target for a bulk status change', () => {
    const description = describeMutation(
      'update_task_status',
      { taskIds: ['t1', 't2'], status: 'BLOCKED' },
      {},
      [
        { id: 't1', title: 'A', status: 'TODO' },
        { id: 't2', title: 'B', status: 'IN_PROGRESS' },
      ],
    )

    expect(description.lines).toContainEqual({ label: 'A', value: 'To Do → Blocked' })
    expect(description.lines).toContainEqual({ label: 'B', value: 'In Progress → Blocked' })
    expect(description.lines.some((line) => line.value === NO_COMMON_STATUS_NOTE)).toBe(false)
  })

  it('flags the row that cannot make the move while the others can', () => {
    const description = describeMutation(
      'update_task_status',
      { taskIds: ['t1', 't2'], status: 'DONE' },
      {},
      [
        { id: 't1', title: 'A', status: 'IN_REVIEW' },
        { id: 't2', title: 'B', status: 'TODO' },
      ],
    )

    expect(description.lines).toContainEqual({ label: 'A', value: 'In Review → Done' })
    expect(description.lines).toContainEqual({
      label: 'B',
      value: 'To Do → Done — To Do cannot become Done',
    })
    // One blocked row means the batch cannot all move, which is the note's whole point.
    expect(description.lines).toContainEqual({ label: '', value: NO_COMMON_STATUS_NOTE })
  })

  it('marks an already-at-target row as unchanged, not as an error', () => {
    const description = describeMutation('update_task_status', { status: 'DONE' }, {}, [
      { id: 't1', title: 'A', status: 'DONE' },
    ])

    expect(description.lines).toContainEqual({ label: 'A', value: 'Done → Done (already there)' })
  })

  it('uses FE-04 intersection wording when no task can reach the target', () => {
    const description = describeMutation('update_task_status', { status: 'DONE' }, {}, [
      { id: 't1', title: 'A', status: 'BACKLOG' },
      { id: 't2', title: 'B', status: 'CANCELLED' },
    ])

    expect(description.lines).toContainEqual({ label: '', value: NO_COMMON_STATUS_NOTE })
  })

  it('does not claim an empty intersection when every movable task can reach the target', () => {
    const description = describeMutation('update_task_status', { status: 'DONE' }, {}, [
      { id: 't1', title: 'A', status: 'DONE' },
      { id: 't2', title: 'B', status: 'IN_REVIEW' },
    ])

    expect(description.lines.some((line) => line.value === NO_COMMON_STATUS_NOTE)).toBe(false)
  })

  it('describes an update_task_fields patch as labelled lines', () => {
    const description = describeMutation(
      'update_task_fields',
      { taskId: 't1', priority: 'URGENT', dueDate: '2026-03-01' },
      {},
      null,
    )

    expect(description.title).toBe('Change task details')
    expect(description.lines).toContainEqual({ label: 'Priority', value: 'URGENT' })
    expect(description.lines).toContainEqual({ label: 'Due', value: '2026-03-01' })
  })

  it('resolves a known task title into the task line', () => {
    const description = describeMutation(
      'update_task_fields',
      { taskId: 't1', priority: 'LOW' },
      {},
      [{ id: 't1', title: 'Fix login', status: 'TODO' }],
    )

    expect(description.lines[0]).toEqual({ label: 'Task', value: 'Fix login (t1)' })
  })

  it('never renders an object-valued field as JSON', () => {
    const description = describeMutation('create_task', {
      title: makeTask().title,
      tags: [{ not: 'a string' }, 'bug'],
    })

    expect(JSON.stringify(description)).not.toContain('not')
    expect(description.lines).toContainEqual({ label: 'Tags', value: 'bug' })
  })
})
