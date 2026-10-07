import { STATUS_LABEL, type TaskStatus } from './task'

/**
 * Mirror of the backend `TaskStatusMachine` / C4. Any change here must be made there
 * too — `src/__tests__/status-flow.spec.ts` pins the table on both sides.
 */
export const STATUS_FLOW: Record<TaskStatus, readonly TaskStatus[]> = {
  BACKLOG: ['TODO', 'CANCELLED'],
  TODO: ['BACKLOG', 'IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['TODO', 'IN_REVIEW', 'BLOCKED', 'CANCELLED'],
  IN_REVIEW: ['IN_PROGRESS', 'DONE', 'TODO', 'CANCELLED'],
  BLOCKED: ['TODO', 'IN_PROGRESS', 'CANCELLED'],
  DONE: ['IN_REVIEW', 'CANCELLED'],
  CANCELLED: [],
}

/** Legal targets from `from`; `CANCELLED` needs an explicit reopen (INV-2). */
export function allowedTargets(from: TaskStatus, reopen = false): TaskStatus[] {
  if (from === 'CANCELLED') return reopen ? ['TODO'] : []
  return [...STATUS_FLOW[from]]
}

export function isTransitionAllowed(from: TaskStatus, to: TaskStatus, reopen = false): boolean {
  return to === from || allowedTargets(from, reopen).includes(to)
}

/**
 * Intersection of every task's legal targets — an empty result means "no common legal
 * status". FE-04's bulk bar and FE-12's approval card both render this, so it lives here
 * rather than in either component: two copies of the rule would drift and the AI card
 * would start disagreeing with the manual one.
 */
export function commonTargets(from: TaskStatus[], reopen = false): TaskStatus[] {
  const [first, ...rest] = from
  if (first === undefined) return []
  return rest.reduce<TaskStatus[]>(
    (acc, status) => {
      const allowed = new Set(allowedTargets(status, reopen))
      return acc.filter((target) => allowed.has(target))
    },
    allowedTargets(first, reopen),
  )
}

export function labelFor(status: TaskStatus): string {
  return STATUS_LABEL[status]
}
