import type { Interrupt, ResumeEntry } from '@ag-ui/client'
import { buildResumeArray } from '@ag-ui/client'

import type { PendingAction } from '@/agui/state'
import { commonTargets, isTransitionAllowed, labelFor } from '@/domain/statusFlow'
import { isTaskStatus } from '@/domain/task'
import type { TaskStatus } from '@/domain/task'
import { useTeamStore } from '@/stores/team'

/**
 * The approval half of the AG-UI interrupt contract (spec §6.5, C6).
 *
 * BE-09 froze the wire shape and shipped `ResumePayloadValidator` as its Java mirror; the
 * four legal payloads below are the same sentences in TypeScript. Nothing below the
 * resume envelope enforces them — the SDK derives `responseSchema` from the *tool*
 * schema, not from the payload — so they are validated here, before they go out
 * (FR-AI-15).
 */

/** The four mutation intents `propose_task_mutation` may ask for (C6). */
export const MUTATION_INTENTS = [
  'create_task',
  'update_task_status',
  'update_task_fields',
  'delete_task',
] as const

export type MutationIntent = (typeof MUTATION_INTENTS)[number]

export function isMutationIntent(value: unknown): value is MutationIntent {
  return typeof value === 'string' && (MUTATION_INTENTS as readonly string[]).includes(value)
}

/**
 * Card lifecycle. `approving`/`rejecting` are the in-flight guards (FR-AI-14: a resume is
 * idempotent, so a double click must not produce two).
 *
 * A failed approve returns to `pending` carrying `error` rather than settling, which is
 * what keeps the card open with its Retry choice (FR-AI-18).
 */
export type PendingApprovalStatus = 'pending' | 'approving' | 'rejecting' | 'settled'

export type PendingApproval = {
  interruptId: string
  toolCallId: string | null
  messageId: string | null
  /**
   * `''` when the interrupt proposed nothing this build recognises. Such a card still
   * exists so the interrupt can be answered — approving it fails locally with a precise
   * message rather than the conversation deadlocking on an unanswered interrupt.
   */
  tool: MutationIntent | ''
  args: Record<string, unknown>
  summary: string
  reason: string
  createdAt: number
  status: PendingApprovalStatus
  /** The REST failure of the last approve, shown on the card (FR-AI-18). */
  error: string | null
  /** Restored from a previous session, so the card can say so (FR-AI-20, AC-2.8). */
  restored: boolean
  /** Resolved rows for an `update_task_status` proposal; `null` for the other intents. */
  tasks: { id: string; title: string; status: TaskStatus }[] | null
}

/** The one-line note a restored card carries (AC-2.8). */
export const RESTORED_NOTICE = 'Restored from a previous session — approve or dismiss'

/** Rejecting without typing still has to give the model something to work with. */
export const DEFAULT_REJECTION_REASON = 'The user did not want this change.'

/** FE-04's wording, reused verbatim so the AI card and the bulk bar read identically. */
export const NO_COMMON_STATUS_NOTE =
  'These tasks have no common legal status, so they cannot all be changed together.'

// --- resume payloads (C6) ----------------------------------------------------

/**
 * What `buildResumeArray` takes per interrupt id (the client's `ResumeResponse`).
 * Kept as a local type because `@ag-ui/client` does not export it by name.
 */
export type ResumeResponse =
  { status: 'resolved'; payload: Record<string, unknown> } | { status: 'cancelled' }

/**
 * Builds the `resolved` resume body.
 *
 * Exactly one of `result`/`error` is ever produced: a failed mutation travels as
 * `error`, because a payload carrying both is not a documented case and the model would
 * be told the change happened (FR-AI-18).
 */
export function buildApprovalPayload(
  approved: boolean,
  extra: { result?: unknown; error?: string; reason?: string } = {},
): ResumeResponse {
  if (!approved) {
    const reason = extra.reason?.trim()
    return {
      status: 'resolved',
      payload: {
        approved: false,
        reason: reason === undefined || reason === '' ? DEFAULT_REJECTION_REASON : reason,
      },
    }
  }
  return extra.error !== undefined
    ? { status: 'resolved', payload: { approved: true, error: extra.error } }
    : { status: 'resolved', payload: { approved: true, result: plainJson(extra.result ?? {}) } }
}

/** Dismiss: `cancelled`, and no payload at all (C6). */
export function dismissedResume(): ResumeResponse {
  return { status: 'cancelled' }
}

/**
 * Answers the client-tool interrupts a run paused on (`ask_user`, `prefill_task_form`,
 * `update_task_status`, `open_task`).
 *
 * The backend requires a `resume` for every paused interrupt, so a client tool's result
 * travels through the same channel as an approval — but its payload is the tool-result
 * text, not the C6 `{approved}` shape, which is why it does not go through
 * {@link buildResume}'s mutation validation. A client tool's interrupt id **is** its
 * tool-call id (the SDK builds the interrupt that way).
 */
export function buildClientToolResume(
  results: { interruptId: string; content: string }[],
): ResumeEntry[] {
  return results.map((result) => ({
    interruptId: result.interruptId,
    status: 'resolved',
    payload: result.content,
  }))
}

/**
 * Client-side mirror of the backend's `ResumePayloadValidator` (BE-09 §4.4): returns the
 * validated `approved` flag, or `null` when the payload is not one of the four cases.
 * Nothing on the wire checks this, which is exactly why it is checked here.
 */
export function validateResumePayload(raw: unknown): { approved: boolean } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const payload = raw as Record<string, unknown>
  if (typeof payload.approved !== 'boolean') return null

  const hasResult = typeof payload.result === 'object' && payload.result !== null
  const hasError = typeof payload.error === 'string'
  const hasReason = typeof payload.reason === 'string'

  if (payload.approved) {
    // Exactly one of the two; both-or-neither is not a documented case.
    return hasResult !== hasError ? { approved: true } : null
  }
  return hasReason ? { approved: false } : null
}

/**
 * Deep-copies through JSON so the payload never carries a Vue reactive proxy.
 *
 * `JSON.stringify` on a proxy succeeds, but the object handed to the SDK would then be a
 * live view of store state; a plain copy is what actually goes on the wire.
 */
export function plainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value === undefined ? null : value)) as T
}

/**
 * Assembles the resume array for the open interrupts.
 *
 * Every `resolved` payload is validated against the C6 shapes first: the docs ask clients
 * to validate before submitting, and the SDK gives nothing below the envelope any
 * enforcement to lean on. `buildResumeArray` then throws when a response is missing or
 * names an unknown interrupt — deliberate, since the protocol requires *every* open
 * interrupt answered, so the error is surfaced by the caller rather than swallowed.
 */
export function buildResume(
  interrupts: Interrupt[],
  responses: Record<string, ResumeResponse>,
): ResumeEntry[] {
  for (const [id, response] of Object.entries(responses)) {
    if (response.status !== 'resolved') continue
    if (validateResumePayload(response.payload) === null) {
      throw new Error(`resume payload for ${id} is not one of the documented C6 shapes`)
    }
  }
  return buildResumeArray(interrupts, responses)
}

// --- card description -------------------------------------------------------

export type DescriptionLine = { label: string; value: string }

export type MutationDescription = { title: string; lines: DescriptionLine[] }

/**
 * Looks `assigneeName` up through the caller's team store. Resolving to `null` renders
 * as "unknown person" rather than as the raw name the model guessed (FR-AI-12).
 */
export type NameResolver = (name: string) => string | null

export type DescribeContext = {
  resolveName?: NameResolver
}

const UNKNOWN_PERSON = 'unknown person'

/**
 * Lazily resolves a display name through the team store. The import is deferred to the
 * call because a card with no assignee — and every pure describe test — should not need
 * an active Pinia instance.
 */
function resolveNameFromTeamStore(name: string): string | null {
  return useTeamStore().byName(name)?.displayName ?? null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function quoted(value: unknown): string {
  const trimmed = text(value)
  return trimmed === '' ? '—' : trimmed
}

/** Never emits a raw JSON blob: arrays render as a readable list, objects are dropped. */
function renderTags(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '—'
  const tags = value.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '')
  return tags.length === 0 ? '—' : tags.join(', ')
}

function describeAssignee(args: Record<string, unknown>, resolveName?: NameResolver): string {
  const name = text(args.assigneeName)
  if (name === '') return '—'
  return resolveName?.(name) ?? UNKNOWN_PERSON
}

function taskLine(args: Record<string, unknown>, tasks: PendingApproval['tasks']): DescriptionLine {
  const id = text(args.taskId)
  const known = id === '' ? undefined : tasks?.find((task) => task.id === id)
  return { label: 'Task', value: known ? `${known.title} (${id})` : id === '' ? '—' : id }
}

function describeCreate(
  args: Record<string, unknown>,
  resolveName?: NameResolver,
): DescriptionLine[] {
  const lines: DescriptionLine[] = [{ label: 'Title', value: quoted(args.title) }]
  if (text(args.description) !== '')
    lines.push({ label: 'Description', value: text(args.description) })
  if (isTaskStatus(args.status)) lines.push({ label: 'Status', value: labelFor(args.status) })
  if (typeof args.priority === 'string') lines.push({ label: 'Priority', value: args.priority })
  if (text(args.assigneeName) !== '') {
    lines.push({ label: 'Assignee', value: describeAssignee(args, resolveName) })
  }
  if (text(args.dueDate) !== '') lines.push({ label: 'Due', value: text(args.dueDate) })
  if (typeof args.estimateHours === 'number') {
    lines.push({ label: 'Estimate', value: `${args.estimateHours} h` })
  }
  if (args.tags !== undefined) lines.push({ label: 'Tags', value: renderTags(args.tags) })
  return lines
}

/**
 * Renders a status change as per-task `current → target` rows with their legality.
 *
 * The wording is the same one FE-11's plan builder emits (`labelFor(from) cannot become
 * labelFor(to)`) and the empty-intersection note is FE-04's bulk bar sentence verbatim, so
 * the AI card and the manual bulk flow are indistinguishable to the user.
 */
export function describeStatusChange(
  args: Record<string, unknown>,
  tasks: PendingApproval['tasks'],
  reopen: boolean,
): DescriptionLine[] {
  const to = args.status
  const target = isTaskStatus(to) ? labelFor(to) : '—'
  const rows = tasks ?? []

  const lines: DescriptionLine[] = [{ label: 'New status', value: target }]
  for (const task of rows) {
    const unchanged = task.status === to
    const allowed = unchanged || isTransitionAllowed(task.status, to as TaskStatus, reopen)
    const suffix = unchanged
      ? ' (already there)'
      : allowed
        ? ''
        : ` — ${labelFor(task.status)} cannot become ${target}`
    lines.push({ label: task.title, value: `${labelFor(task.status)} → ${target}${suffix}` })
  }

  // FE-04's rule, evaluated by the same helper the bulk bar uses: an empty intersection
  // across the selection means nothing in it can move to the requested status. Rows
  // already at the target are excluded first, because `allowedTargets` deliberately does
  // not list a status as a target of itself.
  const movable = rows.filter((task) => task.status !== to)
  const reachable =
    movable.length === 0 ||
    commonTargets(
      movable.map((task) => task.status),
      reopen,
    ).includes(to as TaskStatus)
  if (rows.length > 0 && !reachable) {
    lines.push({ label: '', value: NO_COMMON_STATUS_NOTE })
  }
  return lines
}

/**
 * The card's headline. Falls back to the tool name for an intent we cannot title.
 *
 * Name resolution goes through the team store unless the caller injects its own
 * resolver — the store is reached lazily, so a caller that renders no assignee (and
 * every pure unit test) never needs Pinia active.
 */
export function describeMutation(
  tool: string,
  args: Record<string, unknown>,
  context: DescribeContext = {},
  tasks: PendingApproval['tasks'] = null,
  reopen = false,
): MutationDescription {
  const resolveName = context.resolveName ?? resolveNameFromTeamStore
  switch (tool) {
    case 'create_task':
      return { title: 'Create a task', lines: describeCreate(args, resolveName) }
    case 'update_task_status':
      return { title: 'Change status', lines: describeStatusChange(args, tasks, reopen) }
    case 'update_task_fields':
      return {
        title: 'Change task details',
        lines: [taskLine(args, tasks), ...describePatchFields(args, resolveName)],
      }
    case 'delete_task':
      return { title: 'Delete a task', lines: [taskLine(args, tasks)] }
    default:
      return {
        title: tool === '' ? 'Unsupported request' : tool,
        lines: [{ label: '', value: 'The agent asked for a change this app does not support.' }],
      }
  }
}

function describePatchFields(
  args: Record<string, unknown>,
  resolveName?: NameResolver,
): DescriptionLine[] {
  const lines: DescriptionLine[] = []
  if (text(args.title) !== '') lines.push({ label: 'Title', value: quoted(args.title) })
  if (text(args.description) !== '')
    lines.push({ label: 'Description', value: text(args.description) })
  if (typeof args.priority === 'string') lines.push({ label: 'Priority', value: args.priority })
  if (text(args.assigneeName) !== '') {
    lines.push({ label: 'Assignee', value: describeAssignee(args, resolveName) })
  }
  if (text(args.dueDate) !== '') lines.push({ label: 'Due', value: text(args.dueDate) })
  if (typeof args.estimateHours === 'number') {
    lines.push({ label: 'Estimate', value: `${args.estimateHours} h` })
  }
  if (args.tags !== undefined) lines.push({ label: 'Tags', value: renderTags(args.tags) })
  return lines
}

// --- intake -----------------------------------------------------------------

/** What the shipped SDK puts in the interrupt metadata (C6, rewritten by BE-09). */
export type InterruptProposal = {
  tool: MutationIntent
  args: Record<string, unknown>
  summary: string
  reason: string
}

/**
 * Reads the proposal out of an interrupt.
 *
 * BE-09's handoff is explicit: the shipped `SpringAiAgent` puts `arguments` into the
 * metadata as a **JSON string**, and `message` is only the tool name — so the summary the
 * card shows has to be parsed out of `metadata.arguments`. The shared-state
 * `assistant.pendingAction` is the fallback for a backend that also writes it.
 *
 * Returns `null` when no intent can be identified: an interrupt that proposes nothing the
 * frontend knows how to ask about must not produce a card that could execute anything.
 */
export function proposalFromInterrupt(
  interrupt: Interrupt,
  pendingAction: PendingAction | null = null,
): InterruptProposal | null {
  const fromMetadata = parseArguments(interrupt)
  if (fromMetadata !== null) return fromMetadata
  if (pendingAction !== null && isMutationIntent(pendingAction.tool)) {
    return {
      tool: pendingAction.tool,
      args: pendingAction.args,
      summary: pendingAction.summary,
      reason: interrupt.reason,
    }
  }
  return null
}

function parseArguments(interrupt: Interrupt): InterruptProposal | null {
  const metadata = interrupt.metadata as Record<string, unknown> | undefined
  const raw = metadata?.arguments
  if (typeof raw !== 'string' || raw === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const record = parsed as Record<string, unknown>
  if (!isMutationIntent(record.tool)) return null
  const args =
    typeof record.args === 'object' && record.args !== null && !Array.isArray(record.args)
      ? (record.args as Record<string, unknown>)
      : {}

  return {
    tool: record.tool,
    args,
    summary: typeof record.summary === 'string' ? record.summary : '',
    reason: typeof record.reason === 'string' ? record.reason : '',
  }
}

/**
 * Builds the card record from an interrupt.
 *
 * Always returns a record, even when no intent could be identified: the interrupt still
 * has to be answered, or the next run would go out without the resume the protocol
 * requires. An unreadable proposal becomes a card whose *approval* fails locally, which
 * keeps the decision with the user instead of dropping it (FR-AI-15).
 */
export function approvalFromInterrupt(
  interrupt: Interrupt,
  pendingAction: PendingAction | null = null,
  tasks: PendingApproval['tasks'] = null,
): PendingApproval {
  const proposal = proposalFromInterrupt(interrupt, pendingAction)
  const reason = proposal === null ? '' : proposal.reason

  return {
    interruptId: interrupt.id,
    toolCallId: interrupt.toolCallId ?? null,
    messageId: null,
    tool: proposal?.tool ?? '',
    args: proposal?.args ?? {},
    summary: proposal?.summary ?? '',
    reason: reason !== '' ? reason : interrupt.reason,
    createdAt: Date.now(),
    status: 'pending',
    error: null,
    restored: false,
    tasks,
  }
}
