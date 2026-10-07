import { getActivePinia } from 'pinia'
import {
  useRoute,
  type LocationQuery,
  type LocationQueryValue,
  type RouteLocationNormalizedLoaded,
  type RouteLocationRaw,
} from 'vue-router'

import {
  DEFAULT_TASK_QUERY,
  isTaskPriority,
  isTaskSortField,
  isTaskStatus,
  type TaskPriority,
  type TaskQuery,
  type TaskSortField,
  type TaskStatus,
} from '@/domain/task'
import { useTeamStore } from '@/stores/team'

/**
 * The URL ⇄ `TaskQuery` mapper (FE-05, FR-F-05). The URL query string is the source of
 * truth for a filtered list, so this module is the single place that knows the wire
 * spelling of every filter. The store is only a cache of it.
 *
 * Both directions are **total**: a hand-edited or truncated URL falls back to the
 * default for the offending field (and is dropped) instead of throwing — a bad link must
 * never white-screen the app.
 */

/** Page sizes the backend accepts and the pagination control offers. */
export const PAGE_SIZES = [10, 20, 50, 100] as const

/** Every URL param this module owns; `tasksRouteWith` clears them before applying a link. */
const MANAGED_QUERY_KEYS = [
  'status',
  'priority',
  'assignee',
  'assigneeName',
  'unassigned',
  'tag',
  'q',
  'overdue',
  'due',
  'from',
  'to',
  'sort',
  'page',
  'size',
] as const

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function firstValue(value: LocationQueryValue | LocationQueryValue[] | undefined): string | null {
  const raw = Array.isArray(value) ? (value.find((entry) => entry !== null) ?? null) : value
  return raw === null || raw === undefined || raw === '' ? null : raw
}

/** Flattens repeated keys and comma-separated values into a trimmed, de-duplicated list. */
function splitList(value: LocationQueryValue | LocationQueryValue[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : [value]
  const result: string[] = []
  for (const entry of raw) {
    if (entry === null || entry === undefined) continue
    for (const piece of entry.split(',')) {
      const trimmed = piece.trim().toUpperCase()
      if (trimmed !== '' && !result.includes(trimmed)) result.push(trimmed)
    }
  }
  return result
}

function parseStatuses(value: LocationQueryValue | LocationQueryValue[] | undefined): TaskStatus[] {
  return splitList(value).filter(isTaskStatus)
}

function parsePriorities(
  value: LocationQueryValue | LocationQueryValue[] | undefined,
): TaskPriority[] {
  return splitList(value).filter(isTaskPriority)
}

function parseBoolean(value: LocationQueryValue | LocationQueryValue[] | undefined): boolean {
  return firstValue(value)?.toLowerCase() === 'true'
}

function parseNonNegativeInt(
  value: LocationQueryValue | LocationQueryValue[] | undefined,
): number | null {
  const raw = firstValue(value)
  if (raw === null || !/^\d+$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function isIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function parseDate(value: LocationQueryValue | LocationQueryValue[] | undefined): string | null {
  const raw = firstValue(value)
  return raw !== null && isIsoDate(raw) ? raw : null
}

function parseSort(value: LocationQueryValue | LocationQueryValue[] | undefined): {
  sort: TaskSortField
  descending: boolean
} {
  const raw = firstValue(value)
  const fallback = { sort: DEFAULT_TASK_QUERY.sort, descending: DEFAULT_TASK_QUERY.descending }
  if (raw === null) return fallback

  const descending = raw.startsWith('-')
  const field = descending ? raw.slice(1) : raw
  return isTaskSortField(field) ? { sort: field, descending } : fallback
}

/**
 * `assigneeName` is a deep-link convenience: it resolves through the team store when
 * members have loaded, and is ignored (→ `null`) otherwise, so a name link never breaks
 * the parse.
 */
function resolveAssigneeId(query: LocationQuery): string | null {
  const explicit = firstValue(query.assignee)
  if (explicit !== null) return explicit

  const name = firstValue(query.assigneeName)
  if (name === null || getActivePinia() === undefined) return null
  return useTeamStore().byName(name)?.id ?? null
}

/**
 * URL → a **complete** `TaskQuery`: absent params take the default, so replacing the URL
 * clears the filters it no longer names. Declared `TaskQuery` (not the plan's
 * `Partial<TaskQuery>`) so it composes directly with `taskQueryToRouteQuery` in the
 * documented round-trip and so the URL stays the source of truth.
 */
export function parseTaskQuery(query: LocationQuery): TaskQuery {
  const page = parseNonNegativeInt(query.page)
  const size = parseNonNegativeInt(query.size)
  const due = parseNonNegativeInt(query.due)
  const sort = parseSort(query.sort)

  return {
    statuses: parseStatuses(query.status),
    priorities: parsePriorities(query.priority),
    assigneeId: resolveAssigneeId(query),
    unassigned: parseBoolean(query.unassigned),
    tag: firstValue(query.tag)?.toLowerCase() ?? null,
    q: firstValue(query.q),
    overdue: parseBoolean(query.overdue),
    dueWithinDays: due,
    createdFrom: parseDate(query.from),
    createdTo: parseDate(query.to),
    sort: sort.sort,
    descending: sort.descending,
    page: page ?? DEFAULT_TASK_QUERY.page,
    size:
      size !== null && (PAGE_SIZES as readonly number[]).includes(size)
        ? size
        : DEFAULT_TASK_QUERY.size,
  }
}

/**
 * `TaskQuery` → URL params. Defaults are omitted so `/tasks` stays clean and the
 * dashboard's deep links produce short URLs. Multi-valued filters are comma-joined
 * (the backend accepts both comma-joined and repeated keys; the parser handles both).
 */
export function taskQueryToRouteQuery(query: TaskQuery): Record<string, string> {
  const result: Record<string, string> = {}

  if (query.statuses.length > 0) result.status = query.statuses.join(',')
  if (query.priorities.length > 0) result.priority = query.priorities.join(',')
  if (query.assigneeId !== null) result.assignee = query.assigneeId
  if (query.unassigned) result.unassigned = 'true'
  if (query.tag !== null) result.tag = query.tag
  if (query.q !== null) result.q = query.q
  if (query.overdue) result.overdue = 'true'
  if (query.dueWithinDays !== null) result.due = String(query.dueWithinDays)
  if (query.createdFrom !== null) result.from = query.createdFrom
  if (query.createdTo !== null) result.to = query.createdTo

  if (
    query.sort !== DEFAULT_TASK_QUERY.sort ||
    query.descending !== DEFAULT_TASK_QUERY.descending
  ) {
    result.sort = `${query.descending ? '-' : ''}${query.sort}`
  }

  if (query.page !== DEFAULT_TASK_QUERY.page) result.page = String(query.page)
  if (query.size !== DEFAULT_TASK_QUERY.size) result.size = String(query.size)

  return result
}

/**
 * Structural comparison used to break the URL ⇄ store watch loop: values are compared
 * deeply and arrays order-insensitively (so `status=TODO,BLOCKED` and
 * `status=BLOCKED,TODO` are the same filter).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    const remaining = [...b]
    for (const item of a) {
      const index = remaining.findIndex((candidate) => deepEqual(item, candidate))
      if (index === -1) return false
      remaining.splice(index, 1)
    }
    return true
  }

  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const aRecord = a as Record<string, unknown>
    const bRecord = b as Record<string, unknown>
    const aKeys = Object.keys(aRecord)
    if (aKeys.length !== Object.keys(bRecord).length) return false
    return aKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(bRecord, key) && deepEqual(aRecord[key], bRecord[key]),
    )
  }

  return false
}

/**
 * The dashboard deep-link contract (FE-07): `/tasks` with only the filters named in
 * `partial`. Because a dashboard link means "show me overdue", **not** "overdue ∩
 * whatever I had", every managed param already in the current URL is cleared first;
 * unrelated params are preserved.
 */
export function tasksRouteWith(
  partial: Partial<TaskQuery>,
  route: RouteLocationNormalizedLoaded = useRoute(),
): RouteLocationRaw {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(route.query)) {
    if (value === null || (MANAGED_QUERY_KEYS as readonly string[]).includes(key)) continue
    query[key] = Array.isArray(value)
      ? value.filter((entry): entry is string => entry !== null).join(',')
      : value
  }

  Object.assign(query, taskQueryToRouteQuery({ ...DEFAULT_TASK_QUERY, ...partial }))
  return { name: 'tasks', query }
}
