import { computed, getCurrentInstance, ref } from 'vue'
import type { App } from 'vue'
import { defineStore } from 'pinia'
import { EventType } from '@ag-ui/client'
import type { HttpAgent } from '@ag-ui/client'
import type { AgentSubscriber, Interrupt, Message, ResumeEntry } from '@ag-ui/client'

import { getAgent } from '@/agui/agent'
import { handlers } from '@/agui/handlers'
import type { StatusPlanEntry, ToolHandlerResult } from '@/agui/handlers'
import { executeMutation, ignoredNotice, resolveProposalTasks } from '@/agui/mutation'
import type { ResumeResponse } from '@/agui/resume'
import {
  approvalFromInterrupt,
  buildApprovalPayload,
  buildClientToolResume,
  buildResume,
  describeMutation,
  dismissedResume,
  isMutationIntent,
  plainJson,
} from '@/agui/resume'
import type { MutationDescription, PendingApproval } from '@/agui/resume'
import { clientTools } from '@/agui/tools'
import {
  cancelPersistedState,
  clearPendingApproval,
  loadPendingApproval,
  loadPersistedState,
  savePendingApproval,
  schedulePersistedState,
} from '@/agui/persistence'
import type { PersistedApproval } from '@/agui/persistence'
import { reduceEvent } from '@/agui/reducer'
import {
  applyDelta,
  applySnapshot,
  assistantPhaseFor,
  buildContext,
  buildState,
  draftFieldsToForm,
  emptyState,
  hasNewDraft,
  isDelta,
} from '@/agui/state'
import type { AssistantSlice, CoworkState, TaskStateSource } from '@/agui/state'
import {
  emptyTranscript,
  hasOpenToolCalls as selectHasOpenToolCalls,
  isStreaming as selectIsStreaming,
  lastAssistantText as selectLastAssistantText,
  openInterrupts,
  openToolCalls,
  settleStreaming,
  toolCallsByName as selectToolCallsByName,
  toolCallById,
  settleToolCall,
  transcriptToMessages,
  visibleItems,
  visibleTurns,
  withNotice,
} from '@/agui/transcript'
import type { TranscriptState } from '@/agui/transcript'
import { useTaskDraft } from '@/composables/useTaskDraft'
import type { TaskStatus } from '@/domain/task'
import { useTaskStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import { config } from '@/config'

/**
 * Runaway-loop backstop: the tool loop re-runs the agent after each batch of results,
 * and an agent that keeps calling a client tool forever would never let the user back
 * in. Three rounds without a human message covers the useful case (ask, act, summarise)
 * and stops the pathological one.
 */
const MAX_TOOL_ROUNDS = 3

export type RunPhase =
  'idle' | 'starting' | 'streaming' | 'awaiting_approval' | 'interrupted' | 'error' | 'stopped'

/**
 * What the user decided about a proposed status change.
 *
 * `failed` is FE-12's addition to FE-11's union: the REST write behind an approval can
 * be rejected (AC-1.3/AC-1.5), and reporting that to the model as "the user rejected it"
 * would be a lie it then reasons from (BE-07's honesty rule).
 */
export type StatusChangeOutcome =
  | { kind: 'approved'; updated: number; unchanged: number }
  | { kind: 'rejected' }
  | { kind: 'dismissed' }
  | { kind: 'failed'; error: string }

export type PendingStatusChange = {
  id: string
  plan: StatusPlanEntry[]
  status: TaskStatus
  reopen: boolean
  createdAt: number
  /** Set while the approved writes are in flight, so the card cannot be double-confirmed. */
  busy: boolean
}

export type PendingQuestion = {
  id: string
  question: string
  options: string[]
  allowFreeText: boolean
  createdAt: number
}

/** A question awaiting an answer, plus the handle the UI uses to settle it. */
export type QuestionHandle = {
  id: string
  promise: Promise<string>
  cancel: () => void
}

/** The first event that proves the agent is producing, rather than just accepted. */
const STREAMING_EVENT_TYPES = new Set<string>([
  EventType.TEXT_MESSAGE_START,
  EventType.TEXT_MESSAGE_CONTENT,
  EventType.TEXT_MESSAGE_CHUNK,
  EventType.REASONING_MESSAGE_CONTENT,
  EventType.REASONING_MESSAGE_CHUNK,
  EventType.TOOL_CALL_START,
  EventType.TOOL_CALL_ARGS,
  EventType.TOOL_CALL_CHUNK,
  EventType.TOOL_CALL_RESULT,
  EventType.STATE_SNAPSHOT,
  EventType.STATE_DELTA,
])

export const useCoworkStore = defineStore('cowork', () => {
  const enabled = config.aguiEnabled
  const ui = useUiStore()

  const phase = ref<RunPhase>('idle')
  const lastError = ref<string | null>(null)
  const queuedMessage = ref<string | null>(null)
  const runStartedAt = ref<number | null>(null)
  const turnCount = ref(0)
  const transcript = ref<TranscriptState>(emptyTranscript())

  /** The shared-state document (spec §5.1): built fresh per run, merged on every snapshot. */
  const state = ref<CoworkState>(emptyState())
  /** The exact document the current run started with — the baseline a delta rebases onto. */
  const lastSentState = ref<CoworkState>(emptyState())
  /** Set when a delta could not be applied; the next run's snapshot clears it (FR-S-02). */
  const needsResync = ref(false)
  /**
   * The mutations waiting for approval, oldest first (FE-12). The card renders
   * `pendingApproval` — the head — and the composer stays disabled while any is open,
   * because a run started before the decision could not carry the resume (spec §2.1).
   */
  const approvalQueue = ref<PendingApproval[]>([])
  /** The status change waiting on the user (spec §6.6). FE-12 settles and performs it. */
  const pendingStatusChange = ref<PendingStatusChange | null>(null)
  /** The clarifying question waiting on the user (FR-AI-29). FE-13 renders and settles it. */
  const pendingQuestion = ref<PendingQuestion | null>(null)

  const isRunning = computed(() => phase.value === 'starting' || phase.value === 'streaming')
  const interrupts = computed(() => openInterrupts(transcript.value))
  /** The card FE-13 binds to: the head of the queue, or nothing when it is empty. */
  const pendingApproval = computed(() => approvalQueue.value[0] ?? null)
  const hasOpenInterrupt = computed(() => interrupts.value.length > 0)
  /** True while a resume is in flight, which is also what disables the buttons (FR-AI-14). */
  const approvalInFlight = ref(false)
  const canSend = computed(
    () =>
      enabled && !isRunning.value && !hasOpenInterrupt.value && approvalQueue.value.length === 0,
  )

  const lastAssistantText = computed(() => selectLastAssistantText(transcript.value))
  const isStreaming = computed(() => selectIsStreaming(transcript.value))
  const hasOpenToolCalls = computed(() => selectHasOpenToolCalls(transcript.value))
  const turns = computed(() => visibleTurns(transcript.value))
  const items = computed(() => visibleItems(transcript.value))

  /**
   * The app the store was created in, when it was created inside a component (the panel).
   *
   * Client-tool handlers run long after setup — from this store's actions — and some of
   * them call `useRouter()`, which needs Vue's injection context. Running the handler
   * inside `app.runWithContext` restores it; without this, `prefill_task_form` throws
   * "Cannot read properties of undefined (reading 'currentRoute')" (FE-14 live run).
   */
  const appContext: App | null = getCurrentInstance()?.appContext.app ?? null

  let lastUserText: string | null = null
  let activeAgent: ReturnType<typeof getAgent> | null = null
  /** Consecutive tool-loop rounds since the last human message; reset by `pushUserMessage`. */
  let toolRounds = 0
  let settleStatusChange: ((outcome: StatusChangeOutcome) => void) | null = null
  let settleQuestion: ((answer: string) => void) | null = null

  // Restore the session once, at store construction. An empty document is the
  // normal case: the next run builds and sends a fresh one anyway.
  const restored = loadPersistedState()
  if (restored !== null) state.value = restored

  // FR-AI-20 / AC-2.8: a mutation that was waiting for a decision when the tab went away
  // is re-offered rather than silently dropped. Nothing is in flight after a reload, so
  // the record comes back as a plain `pending` card.
  const restoredApproval = loadPendingApproval()
  if (restoredApproval !== null && restoredApproval.status !== 'settled') {
    approvalQueue.value = [approvalFromPersisted(restoredApproval)]
    phase.value = 'awaiting_approval'
  }

  /** The `assistant` half of the outgoing document, derived from the local run phase. */
  function assistantSlice(): AssistantSlice {
    return {
      phase: assistantPhaseFor(phase.value, transcript.value.runOutcome),
      pendingAction: state.value.assistant.pendingAction,
    }
  }

  function taskStateSource(): TaskStateSource {
    const tasks = useTaskStore()
    return {
      view: tasks.view,
      activeTaskId: tasks.activeTaskId,
      selectedIds: tasks.selectedIds,
      visibleTaskIds: tasks.visibleTaskIds,
      query: {
        statuses: tasks.query.statuses,
        priorities: tasks.query.priorities,
        assigneeId: tasks.query.assigneeId,
        q: tasks.query.q,
        overdue: tasks.query.overdue,
      },
    }
  }

  /**
   * Hands the agent a freshly built document. Never a stale one: the backend computes
   * its delta against whatever it was given, so a document that predates the user's
   * last click would make every patch of that run land on the wrong baseline.
   */
  function syncState(agent: { setState(state: unknown): void }): void {
    const draft = useTaskDraft().draft.value
    const document = buildState(taskStateSource(), draft, assistantSlice())
    state.value = document
    lastSentState.value = document
    // Persisted as well as applied: a run that dies before its first snapshot would
    // otherwise leave nothing behind to restore.
    schedulePersistedState(document)
    agent.setState(document)
  }

  function commitState(next: CoworkState): void {
    // `mergeOwned` re-reads `current.context`, which was built when the run started, so
    // without this the document's context would go stale the moment the user changes a
    // filter mid-run. Only the context is refreshed: assistant and draft are the agent's.
    const document = { ...next, context: buildContext(taskStateSource()) }
    state.value = document
    schedulePersistedState(document)
  }

  /**
   * Hands an agent-written draft to FE-06's form. Guarded by a diff so the echo of our
   * own document on the next run cannot re-apply the draft the user is editing (FR-S-04).
   */
  function applyAgentDraft(previous: CoworkState, next: CoworkState): void {
    if (!hasNewDraft(previous, next)) return
    const draft = next.draft
    if (draft === null || draft.task === null) return
    useTaskDraft().applyAiDraft({
      taskId: draft.taskId,
      fields: draftFieldsToForm(draft.task),
      missing: draft.missing,
      appliedAt: Date.now(),
    })
  }

  /** Widens the persisted record back into a card, marking it as restored (AC-2.8). */
  function approvalFromPersisted(record: PersistedApproval): PendingApproval {
    return {
      interruptId: record.interruptId,
      toolCallId: record.toolCallId,
      messageId: record.messageId,
      // The record whose intent no longer parses still needs an answer, or the next run
      // would be sent without the resume the protocol requires.
      tool: isMutationIntent(record.tool) ? record.tool : '',
      args: record.args,
      summary: record.summary,
      reason: record.reason,
      createdAt: record.createdAt,
      status: 'pending',
      error: null,
      restored: true,
      tasks: null,
    }
  }

  /** The on-disk projection of the head of the queue (FR-AI-20). */
  function persistPendingApproval(): void {
    const head = approvalQueue.value[0]
    if (head === undefined) {
      clearPendingApproval()
      return
    }
    savePendingApproval({
      interruptId: head.interruptId,
      toolCallId: head.toolCallId,
      tool: head.tool,
      args: plainJson(head.args),
      summary: head.summary,
      reason: head.reason,
      messageId: head.messageId,
      createdAt: head.createdAt,
      status: head.status === 'settled' ? 'settled' : 'pending',
    })
  }

  /**
   * Takes in the interrupts a run finished on and opens a card for each.
   *
   * Driven by the interrupt rather than by the state event: the agent writes
   * `assistant.pendingAction` during the run, and it is the interrupt at `RUN_FINISHED`
   * that actually pauses the run and makes the answer necessary. BE-09's `metadata` is
   * the primary source (that is where the shipped SDK puts the proposal); the
   * pendingAction is the fallback.
   *
   * A second interrupt queues behind the first rather than replacing it — FE-13 renders
   * one card at a time, and the resume array has to answer all of them anyway.
   */
  async function intake(interrupts: Interrupt[]): Promise<void> {
    for (const interrupt of interrupts) {
      if (approvalQueue.value.some((entry) => entry.interruptId === interrupt.id)) continue
      const pendingAction = state.value.assistant.pendingAction
      const probe = approvalFromInterrupt(interrupt, pendingAction)
      const tasks =
        probe.tool === 'update_task_status' ? await resolveProposalTasks(probe.args) : null
      approvalQueue.value = [
        ...approvalQueue.value,
        approvalFromInterrupt(interrupt, pendingAction, tasks),
      ]
    }
    if (approvalQueue.value.length > 0) {
      phase.value = 'awaiting_approval'
      persistPendingApproval()
    }
  }

  function handleStateSnapshot(snapshot: unknown): void {
    const previous = state.value
    const next = applySnapshot(previous, snapshot)
    // A snapshot is the run's authoritative baseline: it re-establishes the document
    // a failed delta lost track of, so the resync hint can come down (FR-S-02).
    needsResync.value = false
    applyAgentDraft(previous, next)
    commitState(next)
  }

  function handleStateDelta(delta: unknown): void {
    if (!isDelta(delta)) {
      needsResync.value = true
      return
    }
    const next = applyDelta(state.value, delta, lastSentState.value)
    if (next === null) {
      // The patch was computed against a baseline we can no longer reconstruct, so the
      // document is left exactly as it was and the next run re-syncs from its snapshot.
      console.warn('[agui] STATE_DELTA could not be applied; requesting a re-sync', delta)
      needsResync.value = true
      return
    }
    const previous = state.value
    applyAgentDraft(previous, next)
    commitState(next)
  }

  /**
   * The store owns the conversation, so the history sent to the backend is always
   * rebuilt from the transcript rather than appended to by hand (FR-AI-04).
   */
  function pushUserMessage(text: string): void {
    transcript.value = {
      ...transcript.value,
      items: [
        ...transcript.value.items,
        { kind: 'user', id: crypto.randomUUID(), content: text, createdAt: Date.now() },
      ],
    }
    toolRounds = 0
  }

  /** Writes a draft straight into the document so FE-13 renders it before the next run. */
  function setDraft(draft: CoworkState['draft']): void {
    commitState({ ...state.value, draft })
  }

  // --- client tool cards (spec 6.6 / FR-AI-29) ------------------------------

  /**
   * Opens the status confirmation and resolves when the user answers.
   *
   * A second proposal while one is open settles the first as dismissed rather than
   * orphaning it: the earlier `await` would otherwise hang until its handler timed out.
   */
  function proposeStatusChange(
    plan: StatusPlanEntry[],
    meta: { status: TaskStatus; reopen: boolean },
  ): Promise<StatusChangeOutcome> {
    settleStatusChange?.({ kind: 'dismissed' })
    settleStatusChange = null

    pendingStatusChange.value = {
      id: crypto.randomUUID(),
      plan,
      status: meta.status,
      reopen: meta.reopen,
      createdAt: Date.now(),
      busy: false,
    }

    return new Promise<StatusChangeOutcome>((resolve) => {
      settleStatusChange = (outcome) => {
        settleStatusChange = null
        pendingStatusChange.value = null
        resolve(outcome)
      }
    })
  }

  /** FE-12 calls this when the user approves/rejects/dismisses the card. */
  function settleProposedStatusChange(outcome: StatusChangeOutcome): void {
    settleStatusChange?.(outcome)
  }

  // --- approval cards (spec §6.5, FE-12) -----------------------------------

  /** What FE-13 renders: a headline plus lines that never contain raw JSON. */
  const approvalDescription = computed<MutationDescription | null>(() => {
    const approval = pendingApproval.value
    if (approval === null) return null
    return describeMutation(
      approval.tool,
      approval.args,
      {},
      approval.tasks,
      approval.args.reopen === true,
    )
  })

  /** Replaces the head of the queue. Kept in one place so persistence cannot be skipped. */
  function patchHead(patch: Partial<PendingApproval>): void {
    const head = approvalQueue.value[0]
    if (head === undefined) return
    approvalQueue.value = [{ ...head, ...patch }, ...approvalQueue.value.slice(1)]
    persistPendingApproval()
  }

  /**
   * Sends the resume run.
   *
   * The array has to answer **every** open interrupt, which `buildResumeArray` enforces;
   * that is why a second interrupt is queued rather than answered piecemeal. The run
   * goes out on the same singleton agent (hence the same `threadId`, which the protocol
   * requires) and carries no synthetic user message — the resume entries *are* the
   * input, and the transcript is rebuilt from history as on any other run (FR-AI-04).
   */
  async function runResume(responses: Record<string, ResumeResponse>): Promise<void> {
    approvalInFlight.value = true
    try {
      await execute('', false, true, buildResume(resumableInterrupts(), responses))
    } finally {
      approvalInFlight.value = false
    }
  }

  /**
   * The interrupts a resume has to answer.
   *
   * Normally just the transcript's. After a reload it is not: the transcript is
   * deliberately not persisted (FR-AI-04/OPEN-10), so the *saved card* is the only
   * remaining record that an interrupt is open. Without this, an approval restored by
   * FR-AI-20 could never be answered — `buildResumeArray` would reject an id it does not
   * recognise.
   */
  function resumableInterrupts(): Interrupt[] {
    const fromTranscript = interrupts.value
    const known = new Set(fromTranscript.map((interrupt) => interrupt.id))
    const restored = approvalQueue.value
      .filter((entry) => !known.has(entry.interruptId))
      .map((entry) => ({ id: entry.interruptId, reason: entry.reason }) as Interrupt)
    return [...fromTranscript, ...restored]
  }

  /**
   * Runs the resume and, when it cannot be built (the response set does not answer every
   * open interrupt), puts the card back and says why.
   *
   * The failure is re-thrown rather than swallowed: an incomplete resume is a bug in the
   * decision flow, and a silently dropped one would leave the thread permanently
   * unresumable with nothing in the UI to explain it.
   */
  async function resumeOrSurface(
    approval: PendingApproval,
    response: ResumeResponse,
  ): Promise<void> {
    try {
      await runResume({ [approval.interruptId]: response })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patchHead({ status: 'pending', error: message })
      ui.pushToast({ kind: 'error', title: 'Could not answer the request', detail: message })
      throw error
    }
  }

  /** Drops the head of the queue and re-offers the next one, if any. */
  function settleHead(): void {
    approvalQueue.value = approvalQueue.value.slice(1)
    persistPendingApproval()
  }

  /**
   * Approve: performs the mutation, then tells the model what actually happened.
   *
   * The order matters. `executeMutation` goes through the task store, so the list, the
   * stats and the open detail are refetched from the authoritative REST result before
   * the resume goes out — nothing here is an optimistic update (FR-AI-17). A failure is
   * still reported as `approved: true` with an `error`, because the user *did* approve;
   * pretending otherwise would teach the model to misreport its own refusals (FR-AI-18).
   */
  async function approve(id: string): Promise<void> {
    const approval = findApproval(id)
    if (approval === null || approvalInFlight.value || approval.status !== 'pending') return

    patchHead({ status: 'approving', error: null })
    const outcome = await executeMutation(approval.tool, approval.args)

    const response = outcome.ok
      ? buildApprovalPayload(true, { result: outcome.result })
      : buildApprovalPayload(true, { error: outcome.error })

    await resumeOrSurface(approval, response)

    if (!outcome.ok) {
      // The failure is on the card and on the wire; the card stays open so the user can
      // retry or reject rather than losing the decision surface (FR-AI-18).
      const error =
        outcome.ignored.length > 0
          ? `${outcome.error} — ${ignoredNotice(outcome.ignored)}`
          : outcome.error
      patchHead({ status: 'pending', error })
      return
    }
    markToolCallResult(approval, 'approved')
    settleHead()
  }

  /**
   * Reject. No call to `executeMutation` exists on this path — nothing was attempted, and
   * the model is told so (FR-AI-16, AC-2.5).
   */
  async function reject(id: string, reason?: string): Promise<void> {
    const approval = findApproval(id)
    if (approval === null || approvalInFlight.value || approval.status !== 'pending') return

    patchHead({ status: 'rejecting', error: null })
    await resumeOrSurface(
      approval,
      buildApprovalPayload(false, { reason: reason?.trim() === '' ? undefined : reason }),
    )
    markToolCallResult(approval, 'rejected')
    settleHead()
  }

  /** Dismiss: `cancelled`, with no payload and no mutation (C6, FR-AI-16). */
  async function dismiss(id: string): Promise<void> {
    const approval = findApproval(id)
    if (approval === null || approvalInFlight.value || approval.status !== 'pending') return

    patchHead({ status: 'rejecting' })
    await resumeOrSurface(approval, dismissedResume())
    markToolCallResult(approval, 'dismissed')
    settleHead()
  }

  function findApproval(id: string): PendingApproval | null {
    return approvalQueue.value.find((entry) => entry.interruptId === id) ?? null
  }

  /** Records the decision against the tool call that proposed it, so the transcript agrees. */
  function markToolCallResult(
    approval: PendingApproval,
    decision: 'approved' | 'rejected' | 'dismissed',
  ): void {
    if (approval.toolCallId === null) return
    transcript.value = settleToolCall(transcript.value, approval.toolCallId, {
      content: `${approval.tool}: ${decision}`,
      error: null,
      messageId: crypto.randomUUID(),
    })
  }

  // --- the client-tool status confirmation (spec §6.6) ----------------------

  /**
   * Approving the `update_task_status` card performs the writes from here — the frontend
   * owns every mutation, and no backend write tool exists to be involved instead
   * (FR-AI-19, OPEN-2).
   */
  async function approveStatusChange(): Promise<void> {
    const proposal = pendingStatusChange.value
    if (proposal === null || proposal.busy) return

    const movable = proposal.plan.filter((entry) => entry.allowed && !entry.unchanged)
    const unchanged = proposal.plan.filter((entry) => entry.unchanged).length
    const blocked = proposal.plan.filter((entry) => !entry.allowed)
    const store = useTaskStore()

    if (blocked.length > 0) {
      // AC-1.5: one illegal row rejects the whole batch, so nothing is written.
      const error = blocked
        .map((entry) => `${entry.title}: ${entry.reason ?? 'illegal transition'}`)
        .join('; ')
      ui.pushToast({ kind: 'error', title: 'The status change is not allowed', detail: error })
      settleProposedStatusChange({ kind: 'failed', error })
      return
    }

    proposal.busy = true
    try {
      let updated = 0
      if (movable.length === 1) {
        const [only] = movable
        if (
          only !== undefined &&
          (await store.changeStatus(only.taskId, proposal.status, proposal.reopen))
        ) {
          updated = 1
        }
      } else if (movable.length > 1) {
        const ok = await store.bulkChangeStatus(
          movable.map((entry) => entry.taskId),
          proposal.status,
          proposal.reopen,
        )
        if (ok) updated = movable.length
      }

      if (updated === 0 && movable.length > 0) {
        const error = Object.values(store.formErrors)[0] ?? 'the status change was rejected'
        ui.pushToast({ kind: 'error', title: 'The status change was rejected', detail: error })
        settleProposedStatusChange({ kind: 'failed', error })
        return
      }
      settleProposedStatusChange({ kind: 'approved', updated, unchanged })
    } finally {
      proposal.busy = false
    }
  }

  /** Rejecting the confirmation writes nothing; the handler reports it as a failure. */
  function rejectStatusChange(): void {
    settleProposedStatusChange({ kind: 'rejected' })
  }

  function dismissStatusChange(): void {
    settleProposedStatusChange({ kind: 'dismissed' })
  }

  function askQuestion(input: {
    question: string
    options: string[]
    allowFreeText: boolean
  }): QuestionHandle {
    settleQuestion?.('')
    settleQuestion = null

    const id = crypto.randomUUID()
    pendingQuestion.value = { id, ...input, createdAt: Date.now() }

    const promise = new Promise<string>((resolve) => {
      settleQuestion = (answer) => {
        settleQuestion = null
        pendingQuestion.value = null
        resolve(answer)
      }
    })

    return { id, promise, cancel: () => settleQuestion?.('') }
  }

  /** FE-13 calls this when the user answers or dismisses the question card. */
  function settlePendingQuestion(answer: string): void {
    settleQuestion?.(answer)
  }

  function syncHistory(
    agent: { setMessages(messages: Message[]): void },
    skipToolCallIds?: ReadonlySet<string>,
  ): void {
    agent.setMessages(transcriptToMessages(transcript.value, { skipToolCallIds }))
  }

  function apply(event: Parameters<typeof reduceEvent>[1]): void {
    const next = reduceEvent(transcript.value, event)
    // The reducer returns the same reference for events it does not own; assigning
    // anyway would re-render the panel for events it deliberately never shows.
    if (next !== transcript.value) transcript.value = next
    if (STREAMING_EVENT_TYPES.has(event.type) && phase.value === 'starting') {
      phase.value = 'streaming'
    }
  }

  /**
   * The generic `onEvent` hook is used on purpose: it receives every event, so one
   * reducer call covers all of them and no variant can be missed (FR-AI-08).
   */
  function subscriber(): AgentSubscriber {
    return {
      onEvent: ({ event }) => {
        apply(event)
      },
      // The reducer deliberately ignores state events (FE-09 §"anything else"); they
      // are owned here. These hooks fire before the client applies the patch to its own
      // `agent.state`, so the document in this store stays the one the UI renders from.
      onStateSnapshotEvent: ({ event }) => {
        handleStateSnapshot(event.snapshot)
      },
      onStateDeltaEvent: ({ event }) => {
        handleStateDelta(event.delta)
      },
      onRunFinishedEvent: (params) => {
        const { outcome } = params
        if (outcome === 'interrupt') {
          // The SDK ends a run as an interrupt for two different things: a backend
          // interrupt tool the user must approve (`propose_task_mutation` → approval
          // card) and a CLIENT tool call the browser owns (`ask_user`,
          // `update_task_status`, … → its handler opens the card). Both arrive here, so
          // split them by whether a browser handler exists for the paused call.
          const clientIds: string[] = []
          const approvals: Interrupt[] = []
          for (const interrupt of params.interrupts) {
            const toolCallId = interrupt.toolCallId
            const call =
              toolCallId === undefined ? undefined : toolCallById(transcript.value, toolCallId)
            if (call !== undefined && handlers[call.name] !== undefined) clientIds.push(call.id)
            else approvals.push(interrupt)
          }
          if (approvals.length > 0) {
            phase.value = 'awaiting_approval'
            // The event's own list is authoritative; the reducer has already tagged the
            // originating tool call by the time this runs.
            void intake(approvals)
          } else {
            phase.value = 'interrupted'
          }
          if (clientIds.length > 0 && activeAgent !== null) {
            // Paused client tools are answered through the resume channel, not a re-run.
            void dispatchClientTools(activeAgent, clientIds, 'resume')
          }
        } else if (outcome === 'cancelled') {
          phase.value = 'stopped'
        } else {
          phase.value = 'idle'
          if (activeAgent !== null && params.pendingToolCallIds.length > 0) {
            void dispatchClientTools(activeAgent, params.pendingToolCallIds)
          }
        }
      },
      onRunErrorEvent: ({ event }) => {
        phase.value = 'error'
        lastError.value = event.message
        // A resume the backend no longer accepts (the thread moved on, the interrupt was
        // consumed elsewhere) must not leave the card re-offered forever: drop it and
        // say so, so the user can carry on with the conversation (FE-12 §4.5).
        if (approvalQueue.value.length > 0) {
          approvalQueue.value = []
          clearPendingApproval()
          ui.pushToast({
            kind: 'error',
            title: 'That request could not be resumed',
            detail: `${event.message} — carry on with the conversation and ask again.`,
          })
        }
      },
      onRunFailed: ({ error }) => {
        phase.value = 'error'
        lastError.value = error.message
      },
    }
  }

  /**
   * Runs the client tools the agent asked for, then re-runs it so it can react.
   *
   * Dispatch happens **here and only here** — after the run has reported success — and
   * never mid-stream: an `interrupt` outcome means the same turn is paused for approval,
   * and applying a draft from a turn that is still deciding would pre-fill a form for
   * something the user may yet change (FE-12 owns the paused case).
   *
   * Deliberately not awaited by the subscriber: `runAgent` must resolve so the queue
   * drain and the phase settle can proceed, while a card the user has not answered yet
   * keeps this promise open.
   */
  async function dispatchClientTools(
    agent: HttpAgent,
    pendingIds: string[],
    mode: 'rerun' | 'resume' = 'rerun',
  ): Promise<void> {
    let dispatched = 0
    const settled: { interruptId: string; content: string }[] = []

    for (const id of pendingIds) {
      const call = toolCallById(transcript.value, id)
      if (!call) continue

      const handler = handlers[call.name]
      let result: ToolHandlerResult
      if (!handler) {
        // A tool the model invented. Reportable, never fatal (FR-AI-08).
        result = {
          ok: false,
          content: `unknown tool ${call.name}`,
          error: `unknown tool ${call.name}`,
        }
      } else {
        const invoke = () => handler(call.args, { id: call.id, messageId: call.parentMessageId })
        try {
          // `runWithContext` restores Vue's injection context for handlers that use
          // `useRouter()`; the store dispatches them outside any component (see below).
          result =
            appContext === null ? await invoke() : await appContext.runWithContext(invoke)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          result = { ok: false, content: `${call.name} failed: ${message}`, error: message }
        }
      }

      transcript.value = settleToolCall(transcript.value, call.id, {
        content: result.content,
        // Never `null` on the wire: the client's egress guard rejects null fields.
        error: result.ok ? null : result.error,
        messageId: crypto.randomUUID(),
      })
      settled.push({ interruptId: call.id, content: result.content })
      dispatched += 1
    }

    if (dispatched === 0) return

    if (toolRounds >= MAX_TOOL_ROUNDS) {
      syncHistory(agent)
      transcript.value = withNotice(
        transcript.value,
        `Stopped after ${MAX_TOOL_ROUNDS} tool rounds — waiting for you`,
        crypto.randomUUID(),
      )
      return
    }
    toolRounds += 1

    if (mode === 'resume') {
      // The run paused on these calls, so the backend demands a resume. The settled tool
      // message is shown but left out of this run's history: the resume already answers
      // the call, and sending both would be two responses for one tool call.
      await execute(
        '',
        false,
        true,
        buildClientToolResume(settled),
        new Set(settled.map((entry) => entry.interruptId)),
      )
      return
    }

    // One rebuild puts every result into `agent.messages` through the same code path
    // the rest of the history uses, so no tool message can miss `toolCallId` or carry
    // a null `error` (FR-AI-06).
    syncHistory(agent)
    await execute('', false, true)
  }

  async function execute(
    text: string,
    appendUser: boolean,
    isToolFollowUp = false,
    resume?: ResumeEntry[],
    skipToolCallIds?: ReadonlySet<string>,
  ): Promise<void> {
    const agent = getAgent()
    activeAgent = agent
    if (appendUser) pushUserMessage(text)
    phase.value = 'starting'
    runStartedAt.value = Date.now()
    // A tool-loop round is not a user turn: it must not overwrite the text `retry()`
    // re-runs, nor inflate the turn count the UI shows. A resume is neither — the user
    // drove it by deciding on a card — so it resets the loop budget like a message does.
    if (!isToolFollowUp) {
      turnCount.value += 1
      lastUserText = text
    }
    if (resume !== undefined) toolRounds = 0
    lastError.value = null
    try {
      syncHistory(agent, skipToolCallIds)
      // Immediately before the run, so the document is never stale (spec §5).
      syncState(agent)
      await agent.runAgent(
        resume === undefined ? { tools: clientTools } : { tools: clientTools, resume },
        subscriber(),
      )
    } catch (error) {
      // A transport failure (e.g. the AG-UI endpoint is disabled) never raises RUN_ERROR.
      phase.value = 'error'
      lastError.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (isRunning.value) {
        phase.value = 'idle'
      }
      // Rebuilt after the run too: assistant output and tool results only exist in
      // the transcript once their events have been folded in.
      syncHistory(agent)
    }
  }

  async function send(text: string): Promise<void> {
    if (!enabled) return
    if (isRunning.value) {
      // FR-AI-25: queue, never interleave; the drain below runs exactly one hop.
      queuedMessage.value = text
      transcript.value = withNotice(transcript.value, `Queued: ${text}`, crypto.randomUUID())
      return
    }
    await execute(text, true)
    const queued = queuedMessage.value
    queuedMessage.value = null
    if (queued !== null && phase.value !== 'stopped' && phase.value !== 'awaiting_approval') {
      await execute(queued, true)
    }
  }

  function stop(): void {
    if (!enabled) return
    // Read before mutating: settling the phase first would make this always false.
    const wasRunning = isRunning.value
    phase.value = 'stopped'
    activeAgent?.abortRun()
    if (!wasRunning) return
    // FR-AI-24: the transcript records the interruption, not just the status strip.
    transcript.value = settleStreaming(withNotice(transcript.value, 'Stopped', crypto.randomUUID()))
  }

  async function retry(): Promise<void> {
    if (phase.value === 'error' && lastUserText !== null) {
      // Re-run the last turn without appending a second user message.
      await execute(lastUserText, false)
      return
    }
    lastError.value = null
  }

  function reset(): void {
    phase.value = 'idle'
    lastError.value = null
    queuedMessage.value = null
    runStartedAt.value = null
    turnCount.value = 0
    transcript.value = emptyTranscript()
    cancelPersistedState()
    state.value = emptyState()
    lastSentState.value = emptyState()
    needsResync.value = false
    approvalQueue.value = []
    clearPendingApproval()
    // Settle rather than orphan: an open card would leave its handler awaiting forever.
    settleStatusChange?.({ kind: 'dismissed' })
    settleStatusChange = null
    settleQuestion?.('')
    settleQuestion = null
    pendingStatusChange.value = null
    pendingQuestion.value = null
    toolRounds = 0
    lastUserText = null
    activeAgent = null
  }

  return {
    enabled,
    phase,
    lastError,
    queuedMessage,
    runStartedAt,
    turnCount,
    transcript,
    state,
    lastSentState,
    needsResync,
    approvalQueue,
    pendingApproval,
    approvalDescription,
    approvalInFlight,
    pendingStatusChange,
    pendingQuestion,
    interrupts,
    hasOpenInterrupt,
    isRunning,
    isStreaming,
    hasOpenToolCalls,
    lastAssistantText,
    turns,
    items,
    openToolCalls,
    toolCallsByName: selectToolCallsByName,
    toolCallById,
    canSend,
    send,
    stop,
    retry,
    reset,
    setDraft,
    proposeStatusChange,
    settleProposedStatusChange,
    approveStatusChange,
    rejectStatusChange,
    dismissStatusChange,
    approve,
    reject,
    dismiss,
    askQuestion,
    settlePendingQuestion,
  }
})
