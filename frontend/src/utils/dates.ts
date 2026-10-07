import type { Task } from '@/domain/task'

const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const RELATIVE_LIMIT_DAYS = 30

/**
 * Parses a `yyyy-MM-dd` date or an ISO instant. Date-only values are built in **local**
 * time so a `2026-10-07` due date never shifts a day for users behind UTC.
 */
function parseDate(value: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    return Number.isNaN(date.getTime()) ? null : date
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Local-time `yyyy-MM-dd` for "today" — the AI context's `context.today` (spec §5.1). */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** `7 Oct 2026`; `null`/`undefined`/malformed → `—`. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = parseDate(value)
  if (date === null) return '—'
  return `${date.getDate()} ${MONTH_ABBREVIATIONS[date.getMonth()]} ${date.getFullYear()}`
}

/** `just now` / `3h ago` / `2d ago`; older than 30 days falls back to {@link formatDate}. */
export function formatRelativeTime(value: string, now: Date = new Date()): string {
  const date = parseDate(value)
  if (date === null) return '—'

  const diff = now.getTime() - date.getTime()
  if (diff < MINUTE_MS) return 'just now'
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`
  if (diff < RELATIVE_LIMIT_DAYS * DAY_MS) return `${Math.floor(diff / DAY_MS)}d ago`
  return formatDate(value)
}

/** Whether a task's due date is flagged overdue — server-derived (INV-4), never recomputed. */
export function isOverdueDisplay(task: Pick<Task, 'isOverdue'>): boolean {
  return task.isOverdue
}
