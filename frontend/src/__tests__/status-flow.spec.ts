import { describe, expect, it } from 'vitest'

import { STATUS_FLOW, allowedTargets, isTransitionAllowed, labelFor } from '../domain/statusFlow'
import { STATUS_LABEL, TASK_STATUSES, type TaskStatus } from '../domain/task'

// The expected table is pasted literally so a drift on either side fails here. It must
// stay identical to C4 / the backend `TaskStatusMachine`.
const EXPECTED_FLOW: Record<TaskStatus, readonly TaskStatus[]> = {
  BACKLOG: ['TODO', 'CANCELLED'],
  TODO: ['BACKLOG', 'IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['TODO', 'IN_REVIEW', 'BLOCKED', 'CANCELLED'],
  IN_REVIEW: ['IN_PROGRESS', 'DONE', 'TODO', 'CANCELLED'],
  BLOCKED: ['TODO', 'IN_PROGRESS', 'CANCELLED'],
  DONE: ['IN_REVIEW', 'CANCELLED'],
  CANCELLED: [],
}

describe('STATUS_FLOW (C4 mirror)', () => {
  it('equals the C4 transition table exactly', () => {
    expect(STATUS_FLOW).toEqual(EXPECTED_FLOW)
  })

  it('covers all seven statuses', () => {
    expect(Object.keys(STATUS_FLOW).sort()).toEqual([...TASK_STATUSES].sort())
  })

  it('forbids DONE → BACKLOG (INV-1)', () => {
    expect(allowedTargets('DONE')).not.toContain('BACKLOG')
    expect(isTransitionAllowed('DONE', 'BACKLOG')).toBe(false)
  })

  it('requires an explicit reopen to leave CANCELLED (INV-2)', () => {
    expect(allowedTargets('CANCELLED', false)).toEqual([])
    expect(allowedTargets('CANCELLED', true)).toEqual(['TODO'])
    expect(isTransitionAllowed('CANCELLED', 'TODO')).toBe(false)
    expect(isTransitionAllowed('CANCELLED', 'TODO', true)).toBe(true)
  })

  it('treats a same-status move as a no-op success', () => {
    expect(TASK_STATUSES.map((status) => isTransitionAllowed(status, status))).toEqual(
      TASK_STATUSES.map(() => true),
    )
  })

  it('returns a copy so callers cannot mutate the table', () => {
    const targets = allowedTargets('BACKLOG')
    targets.push('DONE')
    expect(allowedTargets('BACKLOG')).toEqual(['TODO', 'CANCELLED'])
  })
})

describe('labelFor', () => {
  it('delegates to STATUS_LABEL', () => {
    for (const status of TASK_STATUSES) {
      expect(labelFor(status)).toBe(STATUS_LABEL[status])
    }
  })
})
