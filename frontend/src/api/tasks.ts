import type {
  PageResponse,
  Task,
  TaskPriority,
  TaskQuery,
  TaskStats,
  TaskStatus,
} from '@/domain/task'

import { apiFetch, type QueryValue } from './client'

/**
 * Request bodies deliberately omit every server-owned field (`id`, `version`,
 * `createdAt`, `updatedAt`, `isOverdue`, `isUnassigned`) — FR-B-19 / INV-5. Do not loosen
 * these types to add them back.
 */
export type TaskCreateInput = {
  title: string
  description: string | null
  status?: TaskStatus
  priority?: TaskPriority
  assigneeId: string | null
  reporterId: string | null
  dueDate: string | null
  estimateHours: number | null
  tags: string[]
}

/** `status` is not patchable — it moves through `POST /tasks/{id}/status` (FR-B-04). */
export type TaskPatchInput = Omit<TaskCreateInput, 'status'>

export type StatusChangeInput = {
  status: TaskStatus
  reopen: boolean
  expectedVersion?: number
}

export type BulkStatusInput = {
  ids: string[]
  status: TaskStatus
  reopen: boolean
  expectedVersions?: Record<string, number>
}

export type BulkStatusResult = {
  updated: number
  tasks: Task[]
}

/**
 * The single `TaskQuery` → query-string mapper (FE-05 reuses it for the URL round-trip).
 * Empty arrays and the `false` defaults of the optional booleans are collapsed to `null`
 * so `apiFetch` omits them — the backend treats absent and `false` identically, and an
 * empty `status=` value would be a 422.
 */
export function toQueryParams(query: TaskQuery): Record<string, QueryValue> {
  return {
    status: query.statuses,
    priority: query.priorities,
    assigneeId: query.assigneeId,
    unassigned: query.unassigned || null,
    tag: query.tag,
    q: query.q,
    overdue: query.overdue || null,
    dueWithinDays: query.dueWithinDays,
    createdFrom: query.createdFrom,
    createdTo: query.createdTo,
    sort: `${query.descending ? '-' : ''}${query.sort}`,
    page: query.page,
    size: query.size,
  }
}

export const taskApi = {
  list: (query: TaskQuery, signal?: AbortSignal) =>
    apiFetch<PageResponse<Task>>('/tasks', { query: toQueryParams(query), signal }),

  stats: (signal?: AbortSignal) => apiFetch<TaskStats>('/tasks/stats', { signal }),

  get: (id: string, signal?: AbortSignal) => apiFetch<Task>(`/tasks/${id}`, { signal }),

  create: (input: TaskCreateInput) => apiFetch<Task>('/tasks', { method: 'POST', body: input }),

  patch: (id: string, input: TaskPatchInput, expectedVersion?: number) =>
    apiFetch<Task>(`/tasks/${id}`, {
      method: 'PATCH',
      body: input,
      query: expectedVersion === undefined ? {} : { expectedVersion },
    }),

  remove: (id: string, force = false) =>
    apiFetch<void>(`/tasks/${id}`, { method: 'DELETE', query: { force } }),

  changeStatus: (id: string, input: StatusChangeInput) =>
    apiFetch<Task>(`/tasks/${id}/status`, { method: 'POST', body: input }),

  bulkStatus: (input: BulkStatusInput) =>
    apiFetch<BulkStatusResult>('/tasks/bulk-status', { method: 'POST', body: input }),
}
