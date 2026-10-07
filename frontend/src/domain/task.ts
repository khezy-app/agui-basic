// Wire types mirroring C3 (`TaskResponse`) and the spec §2.1 domain model.
// Enum wire values are the uppercase names — never renamed anywhere.

export const TASK_STATUSES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'BLOCKED',
  'DONE',
  'CANCELLED',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const TASK_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'dueDate',
  'title',
  'priority',
  'status',
] as const
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number]

export const TEAM_MEMBER_ROLES = ['ENGINEER', 'DESIGNER', 'PRODUCT_OWNER', 'QA'] as const
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number]

export type Task = {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assigneeId: string | null
  reporterId: string | null
  /** ISO `yyyy-MM-dd`, or `null`. */
  dueDate: string | null
  estimateHours: number | null
  tags: string[]
  /** ISO-8601 instant. */
  createdAt: string
  updatedAt: string
  /** Optimistic-lock counter; server-owned. */
  version: number
  /** Derived by the server; never sent back. */
  isOverdue: boolean
  isUnassigned: boolean
}

export type PageResponse<T> = {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type TaskQuery = {
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  assigneeId: string | null
  unassigned: boolean
  tag: string | null
  q: string | null
  overdue: boolean
  dueWithinDays: number | null
  /** ISO `yyyy-MM-dd`. */
  createdFrom: string | null
  createdTo: string | null
  sort: TaskSortField
  descending: boolean
  page: number
  size: number
}

export type AssigneeRollup = {
  memberId: string
  displayName: string
  openCount: number
  overdueCount: number
}

export type TaskStats = {
  total: number
  // `Record` (not `Partial`) is deliberate: a new status becomes a compile error here,
  // forcing the dashboard to handle it rather than silently rendering an empty card.
  byStatus: Record<TaskStatus, number>
  byPriority: Record<TaskPriority, number>
  assignees: AssigneeRollup[]
  overdueTotal: number
  dueThisWeek: number
  unassignedTotal: number
  createdLast7Days: number
}

export type TeamMember = {
  id: string
  displayName: string
  email: string
  role: TeamMemberRole
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  BLOCKED: 'Blocked',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
}

export const DEFAULT_TASK_QUERY: TaskQuery = {
  statuses: [],
  priorities: [],
  assigneeId: null,
  unassigned: false,
  tag: null,
  q: null,
  overdue: false,
  dueWithinDays: null,
  createdFrom: null,
  createdTo: null,
  sort: 'createdAt',
  descending: true,
  page: 0,
  size: 20,
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.some((status) => status === value)
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return TASK_PRIORITIES.some((priority) => priority === value)
}

export function isTaskSortField(value: unknown): value is TaskSortField {
  return TASK_SORT_FIELDS.some((field) => field === value)
}
