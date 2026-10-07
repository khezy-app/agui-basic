import { applyPatch, deepClone } from 'fast-json-patch'
import type { Operation } from 'fast-json-patch'

import { TASK_PRIORITIES, TASK_STATUSES } from '@/domain/task'
import type { TaskPriority, TaskStatus } from '@/domain/task'
import type { TaskFormValue } from '@/domain/validation'
import { todayIso } from '@/utils/dates'

/**
 * The single state document exchanged with the agent (spec §5.1). It is a contract
 * with BE-07's system prompt, so the shape below mirrors that prompt field by field.
 *
 * Everything here is pure: no Vue, no Pinia, no storage, no network. The store owns
 * the document's lifetime and this module owns its meaning.
 */

/** FR-S-05: `visibleTaskIds` is a convenience, never the dataset the agent reasons over. */
export const VISIBLE_TASK_IDS_CAP = 200

const VIEWS = ['dashboard', 'task-list', 'task-detail', 'task-form'] as const
const ASSISTANT_PHASES = ['idle', 'thinking', 'awaiting_confirmation', 'done', 'error'] as const

export type CoworkView = (typeof VIEWS)[number]
export type AssistantPhase = (typeof ASSISTANT_PHASES)[number]

/** The form fields an agent-written draft may prefill (FE-06's `TaskFormValue`, optional). */
export type TaskDraftFields = {
  title?: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  assigneeId?: string | null
  dueDate?: string | null
  estimateHours?: number | null
  tags?: string[]
}

export type CoworkDraft = {
  task: Partial<TaskDraftFields> | null
  taskId: string | null
  source: 'ai' | 'user'
  missing: string[]
}

export type PendingAction = {
  id: string
  tool: string
  summary: string
  args: Record<string, unknown>
  origin: string | null
}

export type CoworkState = {
  context: {
    view: CoworkView
    today: string
    taskId: string | null
    filters: {
      status: TaskStatus[]
      priority: TaskPriority[]
      assigneeId: string | null
      q: string | null
      overdue: boolean
    }
    selectedIds: string[]
    visibleTaskIds: string[]
  }
  draft: CoworkDraft | null
  assistant: {
    phase: AssistantPhase
    pendingAction: PendingAction | null
  }
  /** FR-S-06: unknown keys are preserved so both sides can evolve independently. */
  [key: string]: unknown
}

/** The subset of the task store `buildState` reads — structural, so it stays Pinia-free. */
export type TaskStateSource = {
  view: CoworkView
  activeTaskId: string | null
  selectedIds: string[]
  visibleTaskIds: string[]
  query: {
    statuses: TaskStatus[]
    priorities: TaskPriority[]
    assigneeId: string | null
    q: string | null
    overdue: boolean
  }
}

/** The `assistant` half as the store knows it. */
export type AssistantSlice = {
  phase: AssistantPhase
  pendingAction: PendingAction | null
}

/** The FE-06 AI draft, projected onto the document's `draft`. */
export type AiDraftSource = {
  taskId: string | null
  fields: Partial<TaskFormValue>
  missing: string[]
} | null

/**
 * The document and the form disagree on two fields, by design: the wire/document
 * carries `null` and a real `number` (spec §5.1, matching the REST body), while the
 * form carries `''` and a decimal string (so a half-typed value can exist at all).
 * These two functions are the only place that conversion happens, so neither FE-06's
 * form nor BE-07's prompt has to know about the other's shape.
 */
export function draftFieldsToState(fields: Partial<TaskFormValue>): Partial<TaskDraftFields> {
  const task: Partial<TaskDraftFields> = {}
  if (fields.title !== undefined) task.title = fields.title
  if (fields.description !== undefined) {
    task.description = fields.description.trim() === '' ? null : fields.description
  }
  if (fields.status !== undefined) task.status = fields.status
  if (fields.priority !== undefined) task.priority = fields.priority
  if (fields.assigneeId !== undefined) {
    task.assigneeId =
      fields.assigneeId === null || fields.assigneeId.trim() === '' ? null : fields.assigneeId
  }
  if (fields.dueDate !== undefined)
    task.dueDate = fields.dueDate.trim() === '' ? null : fields.dueDate
  if (fields.estimateHours !== undefined) {
    const trimmed = fields.estimateHours.trim()
    const parsed = Number(trimmed)
    task.estimateHours = trimmed === '' || !Number.isFinite(parsed) ? null : parsed
  }
  if (fields.tags !== undefined) task.tags = [...fields.tags]
  return task
}

/** The inverse of {@link draftFieldsToState}, for an agent-written draft reaching the form. */
export function draftFieldsToForm(task: Partial<TaskDraftFields>): Partial<TaskFormValue> {
  const fields: Partial<TaskFormValue> = {}
  if (task.title !== undefined) fields.title = task.title
  if (task.description !== undefined) fields.description = task.description ?? ''
  if (task.status !== undefined) fields.status = task.status
  if (task.priority !== undefined) fields.priority = task.priority
  if (task.assigneeId !== undefined) fields.assigneeId = task.assigneeId ?? ''
  if (task.dueDate !== undefined) fields.dueDate = task.dueDate ?? ''
  if (task.estimateHours !== undefined) {
    fields.estimateHours = task.estimateHours === null ? '' : String(task.estimateHours)
  }
  if (task.tags !== undefined) fields.tags = [...task.tags]
  return fields
}

export function emptyState(): CoworkState {
  return {
    context: {
      view: 'task-list',
      today: todayIso(),
      taskId: null,
      filters: {
        status: [],
        priority: [],
        assigneeId: null,
        q: null,
        overdue: false,
      },
      selectedIds: [],
      visibleTaskIds: [],
    },
    draft: null,
    assistant: { phase: 'idle', pendingAction: null },
  }
}

// --- coercion ---------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/** Keeps only entries that are strings *and* members of `allowed`, narrowing the type. */
function enumArray<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  return stringArray(value).filter((entry): entry is T =>
    (allowed as readonly string[]).includes(entry),
  )
}

function coerceView(value: unknown): CoworkView {
  return typeof value === 'string' && (VIEWS as readonly string[]).includes(value)
    ? (value as CoworkView)
    : 'task-list'
}

function coerceAssistantPhase(value: unknown): AssistantPhase {
  return typeof value === 'string' && (ASSISTANT_PHASES as readonly string[]).includes(value)
    ? (value as AssistantPhase)
    : 'idle'
}

function coercePendingAction(value: unknown): PendingAction | null {
  if (!isRecord(value)) return null
  return {
    id: stringOr(value.id, ''),
    tool: stringOr(value.tool, ''),
    summary: stringOr(value.summary, ''),
    args: isRecord(value.args) ? value.args : {},
    origin: stringOrNull(value.origin),
  }
}

function coerceContext(raw: unknown): CoworkState['context'] {
  const base = emptyState().context
  if (!isRecord(raw)) return base

  const filters = isRecord(raw.filters) ? raw.filters : {}
  return {
    view: coerceView(raw.view),
    // A missing `today` is repaired from the client clock rather than left stale.
    today: typeof raw.today === 'string' && raw.today !== '' ? raw.today : base.today,
    taskId: stringOrNull(raw.taskId),
    filters: {
      status: enumArray(filters.status, TASK_STATUSES),
      priority: enumArray(filters.priority, TASK_PRIORITIES),
      assigneeId: stringOrNull(filters.assigneeId),
      q: stringOrNull(filters.q),
      overdue: filters.overdue === true,
    },
    selectedIds: stringArray(raw.selectedIds),
    visibleTaskIds: stringArray(raw.visibleTaskIds),
  }
}

/** Keeps only recognised, well-typed draft fields; a malformed field is dropped, not fatal. */
function coerceDraftTask(value: unknown): Partial<TaskDraftFields> | null {
  if (!isRecord(value)) return null

  const task: Partial<TaskDraftFields> = {}
  if (typeof value.title === 'string') task.title = value.title
  if (typeof value.description === 'string' || value.description === null) {
    task.description = value.description
  }
  if (typeof value.status === 'string' && TASK_STATUSES.includes(value.status as TaskStatus)) {
    task.status = value.status as TaskStatus
  }
  if (
    typeof value.priority === 'string' &&
    TASK_PRIORITIES.includes(value.priority as TaskPriority)
  ) {
    task.priority = value.priority as TaskPriority
  }
  if (typeof value.assigneeId === 'string' || value.assigneeId === null) {
    task.assigneeId = value.assigneeId as string | null
  }
  if (typeof value.dueDate === 'string' || value.dueDate === null) {
    task.dueDate = value.dueDate as string | null
  }
  if (typeof value.estimateHours === 'number' || value.estimateHours === null) {
    task.estimateHours = value.estimateHours as number | null
  }
  if (Array.isArray(value.tags)) task.tags = stringArray(value.tags)
  return task
}

function coerceDraft(value: unknown): CoworkDraft | null {
  if (!isRecord(value)) return null
  return {
    task: coerceDraftTask(value.task),
    taskId: stringOrNull(value.taskId),
    source: value.source === 'user' ? 'user' : 'ai',
    missing: stringArray(value.missing),
  }
}

/**
 * Repairs a document that came off the wire into a `CoworkState`, keeping every key it
 * does not recognise (FR-S-06).
 *
 * Never throws: a malformed document must not be able to break the app, so every
 * field is read through a guard and anything unrecognisable falls back to the default.
 */
export function coerceState(raw: unknown): CoworkState {
  if (!isRecord(raw)) return emptyState()

  const preserved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key !== 'context' && key !== 'draft' && key !== 'assistant') preserved[key] = value
  }

  const assistant = isRecord(raw.assistant) ? raw.assistant : {}
  return {
    ...preserved,
    context: coerceContext(raw.context),
    draft: coerceDraft(raw.draft),
    assistant: {
      phase: coerceAssistantPhase(assistant.phase),
      pendingAction: coercePendingAction(assistant.pendingAction),
    },
  }
}

// --- building ---------------------------------------------------------------

/** Maps the local run phase onto `assistant.phase` (spec §5.1 / FE-10 §4.6). */
export function assistantPhaseFor(
  phase:
    'idle' | 'starting' | 'streaming' | 'awaiting_approval' | 'interrupted' | 'error' | 'stopped',
  lastOutcome: 'none' | 'success' | 'interrupt' | 'cancelled' | 'error',
): AssistantPhase {
  switch (phase) {
    case 'starting':
    case 'streaming':
      return 'thinking'
    case 'awaiting_approval':
    case 'interrupted':
      return 'awaiting_confirmation'
    case 'error':
    case 'stopped':
      return 'error'
    case 'idle':
      return lastOutcome === 'success' ? 'done' : 'idle'
  }
}

/** Just the `context` half, for refreshing it in place when the agent changes something else. */
export function buildContext(tasks: TaskStateSource): CoworkState['context'] {
  return {
    view: tasks.view,
    today: todayIso(),
    taskId: tasks.activeTaskId,
    filters: {
      status: [...tasks.query.statuses],
      priority: [...tasks.query.priorities],
      assigneeId: tasks.query.assigneeId,
      q: tasks.query.q,
      overdue: tasks.query.overdue,
    },
    selectedIds: [...tasks.selectedIds],
    visibleTaskIds: tasks.visibleTaskIds.slice(0, VISIBLE_TASK_IDS_CAP),
  }
}

/**
 * The document sent on every run.
 *
 * `context.today` is the client's **local** day, not the UTC one the task sketch
 * suggested. The reason is consistency with the rest of the app: `utils/dates.ts` parses
 * a `yyyy-MM-dd` due date into local midnight precisely so a date never shifts a day
 * for the user, so a UTC `today` would disagree with every due date it is compared
 * against for up to 14 hours a day. The agent resolves "friday" from this value
 * (FR-AI-30), so it must be the same day the user's calendar shows.
 */
export function buildState(
  tasks: TaskStateSource,
  draft: AiDraftSource,
  assistant: AssistantSlice,
): CoworkState {
  return {
    ...emptyState(),
    context: buildContext(tasks),
    draft:
      draft === null
        ? null
        : {
            task: draftFieldsToState(draft.fields),
            taskId: draft.taskId,
            source: 'ai',
            missing: [...draft.missing],
          },
    assistant: { phase: assistant.phase, pendingAction: assistant.pendingAction },
  }
}

// --- merging ----------------------------------------------------------------

function draftsEqual(a: CoworkDraft | null, b: CoworkDraft | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The ownership split (FR-S-01): the frontend owns `context` and `draft`, the backend
 * may only change `assistant.*`.
 *
 * `context` therefore always comes from `current` — the backend's echo of the state we
 * just sent it must never roll the UI back to a stale view of the app.
 *
 * `draft` is the one exception, because the agent's `update_state` draft **is** the
 * prefill channel (FR-S-03): a non-null incoming draft that differs from ours is the
 * agent writing. A `null` incoming draft is ignored — the agent must not clear a draft
 * the user is in the middle of editing.
 *
 * Unknown top-level keys are taken from `incoming` (FR-S-06).
 */
export function mergeOwned(current: CoworkState, incoming: CoworkState): CoworkState {
  const owned = new Set(['context', 'draft', 'assistant'])
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(current)) {
    if (!owned.has(key)) extras[key] = value
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (!owned.has(key)) extras[key] = value
  }

  return {
    ...extras,
    context: current.context,
    draft:
      incoming.draft !== null && !draftsEqual(incoming.draft, current.draft)
        ? incoming.draft
        : current.draft,
    assistant: incoming.assistant,
  }
}

/** Whether applying `incoming` would newly hand the agent a draft (FR-S-04's echo guard). */
export function hasNewDraft(current: CoworkState, next: CoworkState): boolean {
  return next.draft !== null && !draftsEqual(next.draft, current.draft)
}

/**
 * Applies a `STATE_SNAPSHOT` (FR-S-01, FR-S-06).
 *
 * The document is authoritative for `assistant` only — see {@link mergeOwned}. The
 * returned state is always a new object so the store can react to it.
 */
export function applySnapshot(current: CoworkState, raw: unknown): CoworkState {
  return mergeOwned(current, coerceState(raw))
}

// --- deltas -----------------------------------------------------------------

/**
 * Applies a `STATE_DELTA` (RFC 6902, FR-S-02).
 *
 * **Why the rebase.** The backend computes the patch against the state this run
 * *started* with, which may already be older than what we hold locally — the user may
 * have changed the filter or selected a task since. Applying such a patch straight onto
 * `current` would resolve its paths against the wrong document and silently corrupt it.
 * So the patch is applied to `lastSent` (the exact document the run was started with) to
 * reconstruct *the agent's view*, and only the agent-owned half of that view is then
 * merged back over `current`.
 *
 * Atomic: the patch runs against a deep clone with validation on, so a bad operation
 * leaves nothing half-applied. Returns `null` on failure, which the caller turns into a
 * re-sync rather than an exception.
 */
export function applyDelta(
  current: CoworkState,
  delta: Operation[],
  lastSent: CoworkState = current,
): CoworkState | null {
  if (!Array.isArray(delta)) return null

  try {
    const rebased = applyPatch(deepClone(lastSent), delta, true, false).newDocument
    return mergeOwned(current, coerceState(rebased))
  } catch {
    return null
  }
}

/** Whether `raw` parses as an RFC 6902 operation list, for guarding the event payload. */
export function isDelta(value: unknown): value is Operation[] {
  return (
    Array.isArray(value) &&
    value.every(
      (op) =>
        isRecord(op) &&
        typeof op.op === 'string' &&
        typeof op.path === 'string' &&
        (op.op === 'remove' || 'value' in op),
    )
  )
}
