import type { TaskCreateInput, TaskPatchInput } from '@/api/tasks'

import type { TaskPriority, TaskStatus } from './task'

/**
 * Raw form state: every value is the string an `<input>`/`<select>` produces. The form
 * component (FE-06) owns this shape; `normaliseForm` converts it to wire-ready values.
 */
export type TaskFormValue = {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assigneeId: string | null
  reporterId: string | null
  /** `''` or `yyyy-MM-dd`. */
  dueDate: string
  /** `''` or a decimal string. */
  estimateHours: string
  tags: string[]
}

export type NormalisedTaskForm = {
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assigneeId: string | null
  reporterId: string | null
  dueDate: string | null
  estimateHours: number | null
  tags: string[]
}

export type ValidationResult = {
  valid: boolean
  errors: Record<string, string>
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ESTIMATE_PATTERN = /^\d+(\.\d+)?$/
const TOO_MANY_DECIMALS_PATTERN = /\.\d{2,}$/

function normaliseNullableText(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Trim → lowercase → de-duplicate, preserving first-seen order (mirrors BE-03 §4.2). */
function normaliseTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const tag of tags) {
    const normalised = tag.trim().toLowerCase()
    if (seen.has(normalised)) continue
    seen.add(normalised)
    result.push(normalised)
  }
  return result
}

function normaliseEstimateHours(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function validateEstimateHours(raw: string, errors: Record<string, string>) {
  const trimmed = raw.trim()
  if (trimmed === '') return

  if (!ESTIMATE_PATTERN.test(trimmed)) {
    errors.estimateHours = 'must be between 0 and 999'
    return
  }

  const parsed = Number(trimmed)
  if (parsed < 0 || parsed > 999) {
    errors.estimateHours = 'must be between 0 and 999'
    return
  }

  if (TOO_MANY_DECIMALS_PATTERN.test(trimmed)) {
    errors.estimateHours = 'must have at most 1 decimal place'
  }
}

/**
 * Trim strings, lowercase + de-duplicate tags, and turn `''` into `null` for nullable
 * text, so FE-06 submits exactly what the backend validates (BE-03 §4.2).
 */
export function normaliseForm(input: TaskFormValue): NormalisedTaskForm {
  return {
    title: input.title.trim(),
    description: normaliseNullableText(input.description),
    status: input.status,
    priority: input.priority,
    assigneeId: normaliseNullableText(input.assigneeId),
    reporterId: normaliseNullableText(input.reporterId),
    dueDate: normaliseNullableText(input.dueDate),
    estimateHours: normaliseEstimateHours(input.estimateHours),
    tags: normaliseTags(input.tags),
  }
}

/**
 * Client-side mirror of the backend `TaskValidator` rules (BE-03 §4.2), collected into the
 * same `Record<field, message>` shape as `toFieldErrors`. Messages and field paths are
 * reproduced verbatim so a server rejection reads identically to a local one.
 */
export function validateTask(input: TaskFormValue, mode: 'create' | 'patch'): ValidationResult {
  const errors: Record<string, string> = {}
  const normalised = normaliseForm(input)

  if (normalised.title === '') {
    errors.title = 'must not be blank'
  } else if (normalised.title.length > 160) {
    errors.title = 'must be at most 160 characters'
  }

  if (normalised.description !== null && normalised.description.length > 4000) {
    errors.description = 'must be at most 4000 characters'
  }

  // INV-3 is an *entering*-BLOCKED rule; status is not patchable (FR-B-04), so it can
  // only be triggered when creating.
  if (mode === 'create' && input.status === 'BLOCKED' && normalised.description === null) {
    errors.description = 'a blocked task must describe the blocker'
  }

  validateEstimateHours(input.estimateHours, errors)

  if (normalised.tags.length > 5) {
    errors.tags = 'must contain at most 5 entries'
  }
  normalised.tags.forEach((tag, index) => {
    if (tag.length < 1 || tag.length > 24) {
      errors[`tags[${index}]`] = 'must be 1–24 characters'
    }
  })

  if (normalised.dueDate !== null && !isValidIsoDate(normalised.dueDate)) {
    errors.dueDate = 'must be a valid date (yyyy-MM-dd)'
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

export function toCreateInput(input: TaskFormValue): TaskCreateInput {
  const normalised = normaliseForm(input)
  return {
    title: normalised.title,
    description: normalised.description,
    status: normalised.status,
    priority: normalised.priority,
    assigneeId: normalised.assigneeId,
    reporterId: normalised.reporterId,
    dueDate: normalised.dueDate,
    estimateHours: normalised.estimateHours,
    tags: normalised.tags,
  }
}

/**
 * PATCH body builder. BE-03 §4.3 (provisional — BE-03 is not implemented yet) makes an
 * explicit `null` mean "leave unchanged", so *clearing* a nullable text field must send
 * `''` instead of `null`. This is the only place that distinction is encoded; every other
 * field is passed through as normalised.
 */
export function toPatchInput(input: TaskFormValue): TaskPatchInput {
  const normalised = normaliseForm(input)
  return {
    title: normalised.title,
    description: input.description.trim() === '' ? '' : normalised.description,
    priority: normalised.priority,
    assigneeId: normalised.assigneeId,
    reporterId: normalised.reporterId,
    dueDate: normalised.dueDate,
    estimateHours: normalised.estimateHours,
    tags: normalised.tags,
  }
}
