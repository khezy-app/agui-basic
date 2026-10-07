import { taskApi } from '@/api/tasks'
import type { PendingAction } from '@/agui/state'
import type { MutationIntent } from '@/agui/resume'
import { plainJson } from '@/agui/resume'
import { isTaskStatus, type Task, type TaskStatus } from '@/domain/task'
import type { TaskFormValue } from '@/domain/validation'
import { useTaskStore } from '@/stores/tasks'
import { useTeamStore } from '@/stores/team'

/**
 * The mutation executors (spec §4.3): the four `propose_task_mutation` intents mapped
 * onto the normal REST endpoints, **through the task store** so that validation, the C1
 * error mapping and the post-write refetch stay in one place (FR-AI-17).
 *
 * Nothing here reads the current user's decision: `executeMutation` is only ever reached
 * from `approve()` in the cowork store, and that is the only caller (FR-AI-11). The
 * reject and dismiss paths never import or call it (FR-AI-16).
 *
 * Arguments are validated *before* any request, so a malformed patch from a small model
 * becomes a precise sentence in the resume payload rather than a 422 the user never
 * asked for (FR-AI-12).
 */

/** FR-AI-14: one proposal, one batch, one request. Mirrors the backend bulk limit. */
export const MAX_TASK_IDS = 100

/** Server-owned keys a model may not write (FR-B-19 / INV-5). */
export const SERVER_OWNED_KEYS = [
  'status',
  'id',
  'version',
  'createdAt',
  'updatedAt',
  'isOverdue',
  'isUnassigned',
] as const

export type MutationOutcome =
  | { ok: true; result: Record<string, unknown>; ignored: string[] }
  | { ok: false; error: string; ignored: string[] }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(error: string, ignored: string[] = []): MutationOutcome {
  return { ok: false, error, ignored }
}

/** Splits the model's args from the keys it must not set, reporting the latter (FR-B-19). */
export function stripServerOwned(args: Record<string, unknown>): {
  patch: Record<string, unknown>
  ignored: string[]
} {
  const patch: Record<string, unknown> = {}
  const ignored: string[] = []
  for (const [key, value] of Object.entries(args)) {
    if ((SERVER_OWNED_KEYS as readonly string[]).includes(key)) ignored.push(key)
    else patch[key] = value
  }
  return { patch, ignored }
}

export function ignoredNotice(ignored: string[]): string {
  return `ignored non-editable field(s): ${ignored.join(', ')}`
}

type Resolved = { value: string; error?: string }

/**
 * `assigneeName` → `assigneeId`. Only an exact team match becomes an id; anything else
 * fails here, before a request, rather than being guessed or silently dropped (FR-AI-12).
 */
function resolveAssignee(args: Record<string, unknown>): Resolved | null {
  if (args.assigneeName === undefined) return null
  if (typeof args.assigneeName !== 'string' || args.assigneeName.trim() === '') {
    return { value: '', error: 'assigneeName must be a full name' }
  }
  const name = args.assigneeName.trim()
  const member = useTeamStore().byName(name)
  if (!member) return { value: '', error: `unknown team member '${name}'` }
  return { value: member.id }
}

/** The three field shapes the tool description documents, checked before any request. */
function validateFields(args: Record<string, unknown>): string | null {
  if (args.dueDate !== undefined) {
    if (typeof args.dueDate !== 'string' || !ISO_DATE.test(args.dueDate.trim())) {
      return 'dueDate must be a date as yyyy-MM-dd'
    }
  }
  if (args.estimateHours !== undefined) {
    if (typeof args.estimateHours !== 'number' || !Number.isFinite(args.estimateHours)) {
      return 'estimateHours must be a number of hours'
    }
  }
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags) || args.tags.some((tag) => typeof tag !== 'string')) {
      return 'tags must be an array of strings'
    }
  }
  return null
}

/** The ids a status proposal targets, de-duplicated and capped (FR-AI-14). */
export function collectTaskIds(
  args: Record<string, unknown>,
): { ids: string[] } | { error: string } {
  const single = typeof args.taskId === 'string' ? args.taskId.trim() : ''
  const many = Array.isArray(args.taskIds)
    ? args.taskIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
    : []

  const ids = [...new Set(single === '' ? many : [single, ...many])]
  if (ids.length === 0) return { error: 'no task id was given' }
  if (ids.length > MAX_TASK_IDS) {
    return { error: `at most ${MAX_TASK_IDS} tasks can be changed at once` }
  }
  return { ids }
}

/**
 * The current values of a task, read the same way FE-11 reads ids: the loaded page
 * first, a single `GET` only for what is missing.
 */
async function loadCurrent(id: string): Promise<Task | null> {
  const store = useTaskStore()
  const loaded = store.tasks.find((task) => task.id === id)
  if (loaded) return loaded
  if (store.activeTask?.id === id) return store.activeTask
  try {
    return await taskApi.get(id)
  } catch {
    return null
  }
}

/**
 * Builds the form value `saveTask('patch', …)` expects.
 *
 * `toPatchInput` sends the **whole** editable set, so a partial patch has to be merged
 * onto the task's current values first — otherwise every field the model stayed silent
 * about would be overwritten with a default.
 */
function formFromTask(task: Task, patch: Record<string, unknown>): TaskFormValue {
  return {
    title: (patch.title as string) ?? task.title,
    description:
      patch.description === undefined ? (task.description ?? '') : (patch.description as string),
    status: task.status,
    priority: (patch.priority as TaskFormValue['priority']) ?? task.priority,
    assigneeId:
      patch.assigneeId === undefined ? task.assigneeId : (patch.assigneeId as string | null),
    reporterId: task.reporterId,
    dueDate: patch.dueDate === undefined ? (task.dueDate ?? '') : (patch.dueDate as string),
    estimateHours:
      patch.estimateHours === undefined
        ? task.estimateHours === null
          ? ''
          : String(task.estimateHours)
        : String(patch.estimateHours),
    tags: (patch.tags as string[] | undefined) ?? task.tags,
  }
}

async function executeCreate(args: Record<string, unknown>): Promise<MutationOutcome> {
  const invalid = validateFields(args)
  if (invalid !== null) return fail(invalid)

  const assignee = resolveAssignee(args)
  if (assignee?.error !== undefined) return fail(assignee.error)

  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (title === '') return fail('create_task needs a title')

  const store = useTaskStore()
  const task = await store.createTask({
    title,
    description: typeof args.description === 'string' ? args.description : '',
    status: isTaskStatus(args.status) ? args.status : 'TODO',
    priority: (args.priority as TaskFormValue['priority']) ?? 'MEDIUM',
    assigneeId: assignee?.value === undefined ? null : assignee.value,
    reporterId: null,
    dueDate: typeof args.dueDate === 'string' ? args.dueDate.trim() : '',
    estimateHours: typeof args.estimateHours === 'number' ? String(args.estimateHours) : '',
    tags: (args.tags as string[] | undefined) ?? [],
  })

  if (task === null) {
    const errors = Object.values(store.formErrors)
    return fail(errors[0] ?? 'the task could not be created')
  }
  // `createTask` hands back the REST response verbatim (FE-06's additive helper).
  return { ok: true, result: restResult(task), ignored: [] }
}

async function executeStatus(args: Record<string, unknown>): Promise<MutationOutcome> {
  const collected = collectTaskIds(args)
  if ('error' in collected) return fail(collected.error)

  const status = args.status
  if (!isTaskStatus(status)) {
    return fail(`invalid status '${String(status)}'`)
  }
  const reopen = args.reopen === true
  const [first, ...rest] = collected.ids
  const store = useTaskStore()

  // One id goes through the single-task endpoint; a batch through the bulk endpoint, in
  // one request — the executor never fans out (FR-AI-14).
  if (first !== undefined && rest.length === 0) {
    const ok = await store.changeStatus(first, status, reopen)
    if (!ok) return fail(readFailure(store.formErrors, 'the status change was rejected'))
    return { ok: true, result: restResult(store.lastWrite.result), ignored: [] }
  }

  const ok = await store.bulkChangeStatus(collected.ids, status, reopen)
  if (!ok) return fail(readFailure(store.formErrors, 'the status change was rejected'))
  return { ok: true, result: restResult(store.lastWrite.result), ignored: [] }
}

async function executeFields(args: Record<string, unknown>): Promise<MutationOutcome> {
  const { patch, ignored } = stripServerOwned(args)
  const invalid = validateFields(patch)
  if (invalid !== null) return fail(invalid, ignored)

  const taskId = typeof patch.taskId === 'string' ? patch.taskId.trim() : ''
  if (taskId === '') return fail('update_task_fields needs a taskId', ignored)

  const assignee = resolveAssignee(patch)
  if (assignee?.error !== undefined) return fail(assignee.error, ignored)
  if (assignee !== null) patch.assigneeId = assignee.value
  else delete patch.assigneeName

  const current = await loadCurrent(taskId)
  if (current === null) return fail(`could not load task '${taskId}'`, ignored)

  const store = useTaskStore()
  const saved = await store.saveTask('patch', taskId, formFromTask(current, patch))
  if (!saved) return fail(readFailure(store.formErrors, 'the task could not be saved'), ignored)

  return { ok: true, result: restResult(store.lastWrite.result), ignored }
}

async function executeDelete(args: Record<string, unknown>): Promise<MutationOutcome> {
  const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
  if (taskId === '') return fail('delete_task needs a taskId')

  const store = useTaskStore()
  const ok = await store.deleteTask(taskId, args.force === true)
  if (!ok) return fail(readFailure(store.formErrors, 'the task could not be deleted'))
  // The delete endpoint returns no body, so C6 fixes this shape.
  return { ok: true, result: { deleted: taskId }, ignored: [] }
}

function readFailure(formErrors: Record<string, string>, fallback: string): string {
  const values = Object.values(formErrors)
  return values[0] ?? fallback
}

/**
 * The REST response as a plain JSON object for the resume payload (C6).
 *
 * Deep-copied so what goes on the wire is a plain object rather than a live view of the
 * store, and coerced to an object because the payload contract is `result: { … }` — a
 * `null` body (a bare 204) would fail the backend's validator.
 */
function restResult(value: unknown): Record<string, unknown> {
  const plain = plainJson(value)
  return typeof plain === 'object' && plain !== null && !Array.isArray(plain)
    ? (plain as Record<string, unknown>)
    : {}
}

/**
 * Performs one approved mutation. Never called on the reject or dismiss paths.
 *
 * The result is a plain JSON object — deep-copied so no Vue proxy reaches the wire — and
 * the caller puts it into the resume payload verbatim (C6).
 */
export async function executeMutation(
  tool: MutationIntent | string,
  args: unknown,
): Promise<MutationOutcome> {
  if (!isRecord(args)) return fail(`${tool} needs an object of arguments`)

  switch (tool) {
    case 'create_task':
      return executeCreate(args)
    case 'update_task_status':
      return executeStatus(args)
    case 'update_task_fields':
      return executeFields(args)
    case 'delete_task':
      return executeDelete(args)
    default:
      return fail(`unknown mutation '${String(tool)}'`)
  }
}

/** Resolves the ids of a status proposal for the card's per-task rows. */
export async function resolveProposalTasks(
  args: PendingAction['args'],
): Promise<{ id: string; title: string; status: TaskStatus }[]> {
  const collected = collectTaskIds(args)
  if ('error' in collected) return []

  const store = useTaskStore()
  const resolved: { id: string; title: string; status: TaskStatus }[] = []
  for (const id of collected.ids) {
    const loaded = store.tasks.find((task) => task.id === id)
    if (loaded) {
      resolved.push({ id: loaded.id, title: loaded.title, status: loaded.status })
      continue
    }
    try {
      const task = await taskApi.get(id)
      resolved.push({ id: task.id, title: task.title, status: task.status })
    } catch {
      // An unresolvable id is not fatal here: the card lists what it knows and the
      // mutation itself fails if the id turns out not to exist.
    }
  }
  return resolved
}
