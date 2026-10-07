import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TASK_QUERY,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  TASK_SORT_FIELDS,
  TASK_STATUSES,
  isTaskPriority,
  isTaskSortField,
  isTaskStatus,
} from '../domain/task'

describe('task domain labels', () => {
  it('STATUS_LABEL covers every status exactly once', () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([...TASK_STATUSES].sort())
    for (const status of TASK_STATUSES) {
      expect(STATUS_LABEL[status], `missing label for ${status}`).toBeTruthy()
    }
  })

  it('PRIORITY_LABEL covers every priority exactly once', () => {
    expect(Object.keys(PRIORITY_LABEL).sort()).toEqual([...TASK_PRIORITIES].sort())
    for (const priority of TASK_PRIORITIES) {
      expect(PRIORITY_LABEL[priority], `missing label for ${priority}`).toBeTruthy()
    }
  })

  it('keeps the pinned IN_REVIEW label the spec quotes', () => {
    expect(STATUS_LABEL.IN_REVIEW).toBe('In Review')
  })
})

describe('isTaskStatus', () => {
  it('accepts every wire value', () => {
    for (const status of TASK_STATUSES) {
      expect(isTaskStatus(status)).toBe(true)
    }
  })

  it('rejects anything else coming off the wire or the URL', () => {
    for (const value of ['in_review', 'DONE ', ' done', 'UNKNOWN', null, undefined, 7, {}]) {
      expect(isTaskStatus(value), `should reject ${String(value)}`).toBe(false)
    }
  })
})

describe('isTaskPriority / isTaskSortField', () => {
  it('accepts every wire value', () => {
    for (const priority of TASK_PRIORITIES) expect(isTaskPriority(priority)).toBe(true)
    for (const field of TASK_SORT_FIELDS) expect(isTaskSortField(field)).toBe(true)
  })

  it('rejects unknown values', () => {
    expect(isTaskPriority('urgent')).toBe(false)
    expect(isTaskPriority('')).toBe(false)
    expect(isTaskSortField('priorityRank')).toBe(false)
    expect(isTaskSortField(null)).toBe(false)
  })
})

describe('DEFAULT_TASK_QUERY', () => {
  it('starts unfiltered, newest first, 20 per page', () => {
    expect(DEFAULT_TASK_QUERY.statuses).toEqual([])
    expect(DEFAULT_TASK_QUERY.priorities).toEqual([])
    expect(DEFAULT_TASK_QUERY.assigneeId).toBeNull()
    expect(DEFAULT_TASK_QUERY.unassigned).toBe(false)
    expect(DEFAULT_TASK_QUERY.tag).toBeNull()
    expect(DEFAULT_TASK_QUERY.q).toBeNull()
    expect(DEFAULT_TASK_QUERY.overdue).toBe(false)
    expect(DEFAULT_TASK_QUERY.dueWithinDays).toBeNull()
    expect(DEFAULT_TASK_QUERY.createdFrom).toBeNull()
    expect(DEFAULT_TASK_QUERY.createdTo).toBeNull()
    expect(DEFAULT_TASK_QUERY.sort).toBe('createdAt')
    expect(DEFAULT_TASK_QUERY.descending).toBe(true)
    expect(DEFAULT_TASK_QUERY.page).toBe(0)
    expect(DEFAULT_TASK_QUERY.size).toBe(20)
  })
})
