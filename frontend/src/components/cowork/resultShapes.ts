/**
 * The wire shapes of the backend read-tool results (BE-08 `ToolResults`), reduced to
 * what the cards render. The model context and our rendering share these fields, but the
 * parser is deliberately tolerant: a card must degrade to plain text, never crash, when
 * the agent's result is anything other than the documented shape (FR-AI-21).
 */

/** One task, as `query_tasks` / `get_task` return it. `assignee` is a display name. */
export type TaskBrief = {
  id: string
  title: string
  status: string
  priority: string
  assignee: string | null
  dueDate: string | null
  overdue: boolean
  tags: string[]
}

export type TaskListResult = {
  tasks: TaskBrief[]
  total: number
  limit: number
}

export type TaskSummaryResult = {
  brief: TaskBrief
  description: string | null
}

export type StatsResult = {
  total: number
  byStatus: Record<string, number>
  byPriority: Record<string, number>
  overdue: number
  dueThisWeek: number
  unassigned: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The result content as parsed JSON, or `undefined` when it is not JSON at all. */
export function parseContent(content: unknown): unknown {
  if (typeof content !== 'string') return content
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function parseBrief(value: unknown): TaskBrief | null {
  if (!isRecord(value)) return null
  const id = optionalString(value.id)
  const title = optionalString(value.title)
  if (id === null || title === null) return null
  return {
    id,
    title,
    status: optionalString(value.status) ?? 'TODO',
    priority: optionalString(value.priority) ?? 'MEDIUM',
    assignee: optionalString(value.assignee),
    dueDate: optionalString(value.dueDate),
    overdue: value.overdue === true,
    tags: asStringArray(value.tags),
  }
}

function countRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {}
  const counts: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) counts[key] = numberOf(entry)
  return counts
}

export function parseTaskList(content: unknown): TaskListResult | null {
  const parsed = parseContent(content)
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) return null
  const tasks = parsed.tasks.map(parseBrief).filter((brief): brief is TaskBrief => brief !== null)
  return { tasks, total: numberOf(parsed.total), limit: numberOf(parsed.limit) }
}

export function parseTaskSummary(content: unknown): TaskSummaryResult | null {
  const parsed = parseContent(content)
  if (!isRecord(parsed)) return null
  const brief = parseBrief(parsed.brief)
  if (brief === null) return null
  return { brief, description: optionalString(parsed.description) }
}

export function parseStats(content: unknown): StatsResult | null {
  const parsed = parseContent(content)
  if (!isRecord(parsed)) return null
  return {
    total: numberOf(parsed.total),
    byStatus: countRecord(parsed.byStatus),
    byPriority: countRecord(parsed.byPriority),
    overdue: numberOf(parsed.overdue),
    dueThisWeek: numberOf(parsed.dueThisWeek),
    unassigned: numberOf(parsed.unassigned),
  }
}

/**
 * The filters a `query_tasks` call carried, mapped onto the task-list URL query
 * (`/tasks`), so "Open in task list" shows the same rows the card is showing.
 */
export function taskListQueryFromArgs(args: unknown): Record<string, string> {
  if (!isRecord(args)) return {}
  const query: Record<string, string> = {}
  const statuses = asStringArray(args.status)
  const priorities = asStringArray(args.priority)
  if (statuses.length > 0) query.status = statuses.join(',')
  if (priorities.length > 0) query.priority = priorities.join(',')
  if (typeof args.q === 'string' && args.q.trim() !== '') query.q = args.q.trim()
  if (args.overdue === true) query.overdue = 'true'
  if (args.unassigned === true) query.unassigned = 'true'
  if (typeof args.dueWithinDays === 'number') query.due = String(args.dueWithinDays)
  return query
}
