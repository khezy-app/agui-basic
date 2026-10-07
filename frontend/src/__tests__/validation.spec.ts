import { describe, expect, it } from 'vitest'

import {
  normaliseForm,
  toCreateInput,
  toPatchInput,
  validateTask,
  type TaskFormValue,
} from '../domain/validation'

const baseForm: TaskFormValue = {
  title: 'Ship it',
  description: '',
  status: 'TODO',
  priority: 'MEDIUM',
  assigneeId: null,
  reporterId: null,
  dueDate: '',
  estimateHours: '',
  tags: [],
}

function form(overrides: Partial<TaskFormValue> = {}): TaskFormValue {
  return { ...baseForm, ...overrides }
}

describe('validateTask — happy path', () => {
  it('accepts a minimal valid form in both modes', () => {
    expect(validateTask(form(), 'create')).toEqual({ valid: true, errors: {} })
    expect(validateTask(form(), 'patch')).toEqual({ valid: true, errors: {} })
  })

  it('accepts boundary values', () => {
    const result = validateTask(
      form({
        title: 'x'.repeat(160),
        description: 'y'.repeat(4000),
        estimateHours: '999',
        dueDate: '2026-12-31',
        tags: ['a'.repeat(24)],
      }),
      'create',
    )

    expect(result).toEqual({ valid: true, errors: {} })
  })
})

describe('validateTask — title', () => {
  it('rejects a blank title after trimming', () => {
    expect(validateTask(form({ title: '   ' }), 'create').errors.title).toBe('must not be blank')
  })

  it('rejects a title over 160 characters', () => {
    expect(validateTask(form({ title: 'x'.repeat(161) }), 'create').errors.title).toBe(
      'must be at most 160 characters',
    )
  })
})

describe('validateTask — description', () => {
  it('rejects a description over 4000 characters', () => {
    expect(validateTask(form({ description: 'y'.repeat(4001) }), 'create').errors.description).toBe(
      'must be at most 4000 characters',
    )
  })

  it('requires a description when creating a BLOCKED task (INV-3)', () => {
    expect(validateTask(form({ status: 'BLOCKED' }), 'create').errors.description).toBe(
      'a blocked task must describe the blocker',
    )
    expect(
      validateTask(form({ status: 'BLOCKED', description: 'waiting on infra' }), 'create'),
    ).toStrictEqual({ valid: true, errors: {} })
  })

  it('only applies the BLOCKED rule on create — status is not patchable', () => {
    expect(validateTask(form({ status: 'BLOCKED' }), 'patch').valid).toBe(true)
  })
})

describe('validateTask — estimateHours', () => {
  it.each(['-1', '1000', 'abc', '1e3'])('rejects %s with the range message', (value) => {
    expect(validateTask(form({ estimateHours: value }), 'create').errors.estimateHours).toBe(
      'must be between 0 and 999',
    )
  })

  it('rejects more than one decimal place', () => {
    expect(validateTask(form({ estimateHours: '1.25' }), 'create').errors.estimateHours).toBe(
      'must have at most 1 decimal place',
    )
  })

  it('accepts one decimal place and the 0 / 999 bounds', () => {
    for (const value of ['0', '3.5', '999', '999.0']) {
      expect(validateTask(form({ estimateHours: value }), 'create').valid).toBe(true)
    }
  })
})

describe('validateTask — tags', () => {
  it('rejects more than five entries', () => {
    expect(validateTask(form({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), 'create').errors.tags).toBe(
      'must contain at most 5 entries',
    )
  })

  it('rejects a tag outside 1–24 characters, using the tags[i] path', () => {
    const result = validateTask(form({ tags: ['ok', 'x'.repeat(25)] }), 'create')

    expect(result.errors['tags[1]']).toBe('must be 1–24 characters')
    expect(result.errors.tags).toBeUndefined()
  })

  it('rejects an empty tag', () => {
    expect(validateTask(form({ tags: [''] }), 'create').errors['tags[0]']).toBe(
      'must be 1–24 characters',
    )
  })

  it('validates the de-duplicated list, so duplicates are not counted as extra entries', () => {
    const result = validateTask(form({ tags: ['Bug', 'bug', 'BUG', 'Feat', 'X', 'Y'] }), 'create')

    expect(result.errors.tags).toBeUndefined()
    expect(result.valid).toBe(true)
  })
})

describe('validateTask — dueDate', () => {
  it.each(['2026-1-3', '2026-02-30', '31-01-2026', 'tomorrow'])('rejects %s', (value) => {
    expect(validateTask(form({ dueDate: value }), 'create').errors.dueDate).toBe(
      'must be a valid date (yyyy-MM-dd)',
    )
  })

  it('accepts a real ISO date and an empty value', () => {
    expect(validateTask(form({ dueDate: '2026-01-31' }), 'create').valid).toBe(true)
    expect(validateTask(form({ dueDate: '' }), 'create').valid).toBe(true)
  })
})

describe('validateTask — multiple errors', () => {
  it('collects every violation in one pass', () => {
    const result = validateTask(
      form({
        title: '',
        description: 'y'.repeat(4001),
        estimateHours: '1.25',
        tags: ['a', 'b', 'c', 'd', 'e', 'f'],
        dueDate: 'nope',
      }),
      'create',
    )

    expect(result.valid).toBe(false)
    expect(Object.keys(result.errors).sort()).toEqual([
      'description',
      'dueDate',
      'estimateHours',
      'tags',
      'title',
    ])
  })
})

describe('normaliseForm', () => {
  it('trims text and turns empty nullable text into null', () => {
    const normalised = normaliseForm(
      form({
        title: '  Ship it  ',
        description: '  ',
        dueDate: '  ',
        assigneeId: '',
        reporterId: '',
      }),
    )

    expect(normalised.title).toBe('Ship it')
    expect(normalised.description).toBeNull()
    expect(normalised.dueDate).toBeNull()
    expect(normalised.assigneeId).toBeNull()
    expect(normalised.reporterId).toBeNull()
  })

  it('lowercases and de-duplicates tags, preserving first-seen order', () => {
    expect(normaliseForm(form({ tags: ['Bug', 'bug', 'FEATURE', 'Bug'] })).tags).toEqual([
      'bug',
      'feature',
    ])
  })

  it('converts the estimate string to a number, empty to null', () => {
    expect(normaliseForm(form({ estimateHours: ' 3.5 ' })).estimateHours).toBe(3.5)
    expect(normaliseForm(form({ estimateHours: '' })).estimateHours).toBeNull()
    expect(normaliseForm(form({ estimateHours: 'oops' })).estimateHours).toBeNull()
  })
})

describe('submit builders', () => {
  it('toCreateInput carries the chosen status and every normalised field', () => {
    const input = toCreateInput(
      form({
        title: '  Ship it ',
        description: '  details  ',
        status: 'IN_REVIEW',
        estimateHours: '2.5',
        tags: ['Bug'],
        dueDate: '2026-01-31',
      }),
    )

    expect(input).toEqual({
      title: 'Ship it',
      description: 'details',
      status: 'IN_REVIEW',
      priority: 'MEDIUM',
      assigneeId: null,
      reporterId: null,
      dueDate: '2026-01-31',
      estimateHours: 2.5,
      tags: ['bug'],
    })
  })

  it('toPatchInput omits status (FR-B-04)', () => {
    const input = toPatchInput(form({ status: 'DONE' }))

    expect('status' in input).toBe(false)
  })

  it('toPatchInput sends "" to clear a description, because null means "unchanged"', () => {
    expect(toPatchInput(form({ description: '   ' })).description).toBe('')
    expect(toPatchInput(form({ description: 'keep me' })).description).toBe('keep me')
  })
})
