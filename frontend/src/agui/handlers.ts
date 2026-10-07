import { useRouter } from 'vue-router'

import { isApiError } from '@/api/errors'
import { taskApi } from '@/api/tasks'
import { useTaskDraft } from '@/composables/useTaskDraft'
import { isTaskPriority, isTaskStatus, TASK_STATUSES } from '@/domain/task'
import type { TaskStatus } from '@/domain/task'
import { isTransitionAllowed, labelFor } from '@/domain/statusFlow'
import { useCoworkStore } from '@/stores/cowork'
import { useTaskStore } from '@/stores/tasks'
import { useTeamStore } from '@/stores/team'

/**
 * Client tool handlers (spec §6.2, FR-AI-06, FR-AI-07).
 *
 * Every handler returns a stable, model-readable string, and **every** failure path
 * returns `ok: false` with an `error` — a rejection, a dismissal and a timeout are all
 * failures, because the model's next move depends on knowing the call did not take
 * effect. A silent success would have it continue from a premise that is false.
 *
 * None of these handlers writes a task. `prefill_task_form` fills a form the user must
 * still submit and `update_task_status` opens a confirmation; the writes belong to the
 * user and to FE-12 (FR-AI-03, FR-AI-19, AC-2.1).
 */

export type ToolHandlerResult =
  { ok: true; content: string } | { ok: false; content: string; error: string }

export type ToolHandlerCall = { id: string; messageId: string | null }

export type ToolHandler = (args: unknown, call: ToolHandlerCall) => Promise<ToolHandlerResult>

/** One row of the status-change proposal; `reason` explains a blocked row. */
export type StatusPlanEntry = {
  taskId: string
  title: string
  from: TaskStatus
  to: TaskStatus
  allowed: boolean
  /** Already at the requested status — counted as unchanged, not as an error. */
  unchanged: boolean
  reason?: string
}

const MAX_TITLE = 160
const MAX_TASK_IDS = 100
const MAX_OPTIONS = 6
const MAX_OPTION_LENGTH = 120
/** FR-AI-29's clarification window; after this the card clears and the call fails. */
export const ASK_USER_TIMEOUT_MS = 10 * 60 * 1000

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// --- shared validation ------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function failed(content: string, error: string): ToolHandlerResult {
  return { ok: false, content, error }
}

function success(content: string): ToolHandlerResult {
  return { ok: true, content }
}

/** `title="Fix login", tags=[bug,auth]` — the stable shape the model reads back. */
function renderFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([key, value]) => {
      const rendered = Array.isArray(value)
        ? `[${value.join(',')}]`
        : key === 'title' || key === 'description'
          ? `"${String(value)}"`
          : String(value)
      return `${key}=${rendered}`
    })
    .join(', ')
}

// --- prefill_task_form ------------------------------------------------------

/**
 * Validates one field, reporting the *name* of what could not be used.
 *
 * An unusable value is omitted and named in `missing` rather than coerced: silently
 * turning `"done"` into `TODO` would put a status in the user's form that they never
 * asked for — and they would save it (FR-AI-12).
 */
function take<T>(
  args: Record<string, unknown>,
  key: string,
  missing: string[],
  read: (value: unknown) => T | null,
): T | undefined {
  if (args[key] === undefined) return undefined
  const value = read(args[key])
  if (value === null) {
    missing.push(key)
    return undefined
  }
  return value
}

export const prefillTaskForm: ToolHandler = async (args) => {
  if (!isRecord(args)) {
    return failed('prefill_task_form needs an object of arguments', 'invalid arguments')
  }

  const taskId = trimmedString(args.taskId)
  const title = trimmedString(args.title)
  if (title === null && taskId === null) {
    const message = 'prefill_task_form needs a title (max 160 chars) or a taskId'
    return failed(message, message)
  }
  if (title !== null && title.length > MAX_TITLE) {
    const message = 'prefill_task_form title is too long (max 160 chars)'
    return failed(message, message)
  }

  const missing: string[] = []
  const fields: Record<string, unknown> = {}
  if (title !== null) fields.title = title

  if (args.description !== undefined) {
    if (typeof args.description === 'string') fields.description = args.description.trim()
    else missing.push('description')
  }

  const status = take(args, 'status', missing, (value) => (isTaskStatus(value) ? value : null))
  if (status !== undefined) fields.status = status

  const priority = take(args, 'priority', missing, (value) =>
    isTaskPriority(value) ? value : null,
  )
  if (priority !== undefined) fields.priority = priority

  const dueDate = take(args, 'dueDate', missing, (value) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return ISO_DATE.test(trimmed) ? trimmed : null
  })
  if (dueDate !== undefined) fields.dueDate = dueDate

  const estimateHours = take(args, 'estimateHours', missing, (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    if (value < 0 || value > 999) return null
    return Math.round(value * 10) / 10
  })
  if (estimateHours !== undefined) fields.estimateHours = estimateHours

  if (args.tags !== undefined) {
    if (Array.isArray(args.tags) && args.tags.every((tag) => typeof tag === 'string')) {
      fields.tags = [...(args.tags as string[])]
    } else {
      missing.push('tags')
    }
  }

  // `assigneeName` is a name the model picked; only an exact team match becomes an id.
  // Anything else is omitted and reported, never guessed (FR-AI-12).
  if (args.assigneeName !== undefined) {
    const name = trimmedString(args.assigneeName)
    const member = name === null ? undefined : useTeamStore().byName(name)
    if (member) fields.assigneeId = member.id
    else missing.push('assigneeId')
  }

  const draft = { taskId, fields, missing }
  useTaskDraft().applyAiDraft({ ...draft, fields: fields as never, appliedAt: Date.now() })
  useCoworkStore().setDraft({ task: fields as never, taskId, source: 'ai', missing })

  await navigateToForm(taskId)

  const content =
    `prefilled ${renderFields(fields) === '' ? 'nothing' : renderFields(fields)}` +
    (missing.length > 0 ? `; missing=[${missing.join(',')}]` : '')
  return success(content)
}

/**
 * Sends the user to the form the draft belongs to (OPEN-11).
 *
 * No dirty-form guard is needed here: `TaskFormView` installs an
 * `onBeforeRouteLeave` that asks, and routing through `router.push` trips it. Staying
 * put when we are already on the target route keeps the form from remounting and
 * discarding what the user has typed.
 */
async function navigateToForm(taskId: string | null): Promise<void> {
  const router = useRouter()
  const target = taskId === null ? '/tasks/new' : `/tasks/${taskId}/edit`
  if (router.currentRoute.value.path === target) return
  await router.push(target)
}

// --- open_task --------------------------------------------------------------

export const openTask: ToolHandler = async (args) => {
  if (!isRecord(args)) return failed('open_task needs an object of arguments', 'invalid arguments')

  const taskId = trimmedString(args.taskId)
  if (taskId === null) return failed('open_task needs a taskId', 'open_task needs a taskId')

  try {
    await taskApi.get(taskId)
  } catch (error) {
    // Never navigate to something that could not be loaded — the detail view would show
    // an error page for a task the model merely guessed at.
    const reason =
      isApiError(error) && error.kind === 'not-found' ? 'not_found' : 'could not load the task'
    return failed(`not_found ${taskId}`, reason)
  }

  await useRouter().push(`/tasks/${taskId}`)
  return success(`opened ${taskId}`)
}

// --- update_task_status -----------------------------------------------------

/** Pure: turns resolved tasks into the rows the confirmation card renders. */
export function buildStatusPlan(
  tasks: { id: string; title: string; status: TaskStatus }[],
  to: TaskStatus,
  reopen: boolean,
): StatusPlanEntry[] {
  return tasks.map((task) => {
    const unchanged = task.status === to
    const allowed = unchanged || isTransitionAllowed(task.status, to, reopen)
    return {
      taskId: task.id,
      title: task.title,
      from: task.status,
      to,
      allowed,
      unchanged,
      ...(allowed ? {} : { reason: `${labelFor(task.status)} cannot become ${labelFor(to)}` }),
    }
  })
}

/** Resolves ids against the loaded page first, fetching only what is missing. */
async function resolveTasks(ids: string[]): Promise<{
  resolved: { id: string; title: string; status: TaskStatus }[]
  missing: string[]
}> {
  const store = useTaskStore()
  const loaded = new Map(store.tasks.map((task) => [task.id, task]))
  const resolved: { id: string; title: string; status: TaskStatus }[] = []
  const missing: string[] = []

  for (const id of ids) {
    const cached = loaded.get(id)
    if (cached) {
      resolved.push({ id: cached.id, title: cached.title, status: cached.status })
      continue
    }
    try {
      const task = await taskApi.get(id)
      resolved.push({ id: task.id, title: task.title, status: task.status })
    } catch {
      // One unresolvable id must not sink the whole batch: the user can still confirm
      // the tasks that did resolve.
      missing.push(id)
    }
  }
  return { resolved, missing }
}

export const updateTaskStatus: ToolHandler = async (args) => {
  if (!isRecord(args)) {
    return failed('update_task_status needs an object of arguments', 'invalid arguments')
  }

  const single = trimmedString(args.taskId)
  const many = Array.isArray(args.taskIds)
    ? args.taskIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
    : []
  const status = args.status

  if (!isTaskStatus(status)) {
    return failed(
      `invalid status ${JSON.stringify(args.status)}; expected one of ${TASK_STATUSES.join(', ')}`,
      'invalid status',
    )
  }
  if (single === null && many.length === 0) {
    const message = 'update_task_status needs either taskId or taskIds'
    return failed(message, message)
  }
  if (many.length > MAX_TASK_IDS) {
    return failed(`update_task_status accepts at most ${MAX_TASK_IDS} tasks`, 'too many tasks')
  }

  // De-duplicate: the model may list the same id in both arguments.
  const ids = [...new Set(single === null ? many : [single, ...many])]
  const { resolved, missing } = await resolveTasks(ids)
  if (resolved.length === 0) {
    return failed(
      `no task could be resolved out of ${ids.length} id(s)`,
      'no task could be resolved',
    )
  }

  const reopen = args.reopen === true
  const plan = buildStatusPlan(resolved, status, reopen)
  const proposal = useCoworkStore().proposeStatusChange(plan, { status, reopen })

  // The call is not finished until the user answers: the model must not read it as
  // "the status changed" while the card is still open.
  const outcome = await proposal
  if (outcome.kind === 'dismissed') {
    return failed('dismissed by user', 'user dismissed the confirmation')
  }
  if (outcome.kind === 'rejected') {
    return failed('rejected by user', 'user rejected the status change')
  }
  if (outcome.kind === 'failed') {
    // The user approved, but the backend refused the write. Reporting that as a
    // rejection would tell the model the human said no when they did not (FR-AI-19).
    return failed(`status change rejected: ${outcome.error}`, outcome.error)
  }

  const counts = [`${outcome.updated} updated`]
  if (outcome.unchanged > 0) counts.push(`${outcome.unchanged} unchanged`)
  const notFound = missing.length > 0 ? `; not_found=[${missing.join(',')}]` : ''
  return success(`approved: ${counts.join(', ')}${notFound}`)
}

// --- ask_user ---------------------------------------------------------------

export const askUser: ToolHandler = async (args) => {
  if (!isRecord(args)) return failed('ask_user needs an object of arguments', 'invalid arguments')

  const question = trimmedString(args.question)
  if (question === null) return failed('ask_user needs a question', 'ask_user needs a question')

  const options = (Array.isArray(args.options) ? args.options : [])
    .filter((option): option is string => typeof option === 'string')
    .map((option) => option.trim())
    .filter((option) => option !== '' && option.length <= MAX_OPTION_LENGTH)
    .slice(0, MAX_OPTIONS)

  const ask = useCoworkStore().askQuestion({
    question,
    options,
    allowFreeText: args.allowFreeText !== false,
  })

  const answer = await withTimeout(ask.promise, ASK_USER_TIMEOUT_MS)
  if (answer === TIMED_OUT) {
    ask.cancel()
    return failed('no answer within 10 minutes', 'no answer within 10 minutes')
  }
  return success(`answer: ${answer}`)
}

const TIMED_OUT = Symbol('timed-out')

/**
 * Races a resolver against a deadline. The card is cleared by the caller on timeout, so
 * a stale question cannot be answered long after the model stopped waiting for it.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise<T | typeof TIMED_OUT>((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(TIMED_OUT)
      },
    )
  })
}

// --- registry ---------------------------------------------------------------

export const handlers: Record<string, ToolHandler> = {
  prefill_task_form: prefillTaskForm,
  update_task_status: updateTaskStatus,
  open_task: openTask,
  ask_user: askUser,
}
