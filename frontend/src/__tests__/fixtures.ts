import type { PageResponse, Task, TaskStats, TeamMember } from '@/domain/task'

/** Shared wire fixtures for the FE-04 component tests. */
export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Task 1',
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    assigneeId: null,
    reporterId: null,
    dueDate: null,
    estimateHours: null,
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 1,
    isOverdue: false,
    isUnassigned: true,
    ...overrides,
  }
}

export function makePage(
  content: Task[],
  overrides: Partial<PageResponse<Task>> = {},
): PageResponse<Task> {
  return { content, page: 0, size: 20, totalElements: content.length, totalPages: 1, ...overrides }
}

export const TEAM_MEMBERS: TeamMember[] = [
  { id: 'm1', displayName: 'Ada Lovelace', email: 'ada@example.com', role: 'ENGINEER' },
  { id: 'm2', displayName: 'Grace Hopper', email: 'grace@example.com', role: 'QA' },
]

export const EMPTY_STATS: TaskStats = {
  total: 0,
  byStatus: {
    BACKLOG: 0,
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    BLOCKED: 0,
    DONE: 0,
    CANCELLED: 0,
  },
  byPriority: { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 },
  assignees: [],
  overdueTotal: 0,
  dueThisWeek: 0,
  unassignedTotal: 0,
  createdLast7Days: 0,
}
