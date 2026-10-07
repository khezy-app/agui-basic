import { EventType, contentToText } from '@ag-ui/client'
import type {
  BaseEvent,
  Interrupt,
  Message,
  MessagesSnapshotEvent,
  ReasoningMessageContentEvent,
  RunErrorEvent,
  RunFinishedEvent,
  RunStartedEvent,
  TextMessageChunkEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageStartEvent,
  ToolCallArgsEvent,
  ToolCallChunkEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
  ToolCallStartEvent,
} from '@ag-ui/client'

import { emptyTranscript } from '@/agui/transcript'
import type { ToolCallItem, TranscriptItem, TranscriptState } from '@/agui/transcript'

/**
 * Folds one AG-UI event into the transcript.
 *
 * Pure by construction: no Vue, no Pinia, no DOM, no network, and the input state
 * is never mutated — every handler returns a new object, and an event this
 * reducer does not own returns the *same* reference so a subscriber can skip the
 * update (FR-AI-23: nothing is swallowed, nothing is invented).
 *
 * The reducer is deliberately tolerant of providers that are not perfectly
 * well-behaved (Ollama re-mints tool-call ids on args chunks, some agents stream
 * reasoning before any text). Losing a delta is worse than attaching it to the
 * turn it obviously belongs to.
 */

type AssistantItem = Extract<TranscriptItem, { kind: 'assistant' }>

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function newId(): string {
  return crypto.randomUUID()
}

/** `event.timestamp` when the producer sent one, so tests can pin ordering. */
function createdAtOf(event: BaseEvent): number {
  return typeof event.timestamp === 'number' ? event.timestamp : Date.now()
}

function withItems(state: TranscriptState, items: TranscriptItem[]): TranscriptState {
  return { ...state, items }
}

/** Closes every turn still marked as streaming; a run ends the turns it opened. */
function settleStreaming(items: TranscriptItem[]): TranscriptItem[] {
  return items.map((item) =>
    item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item,
  )
}

function parseArgs(argsText: string): unknown {
  try {
    return JSON.parse(argsText) as unknown
  } catch {
    // Partial or malformed streamed JSON. `argsText` is preserved so the UI can
    // show the raw value without ever crashing (FR-AI-27).
    return undefined
  }
}

// --- item lookup ------------------------------------------------------------

function assistantIndexById(items: TranscriptItem[], id: unknown): number {
  if (typeof id !== 'string') return -1
  return items.findIndex((item) => item.kind === 'assistant' && item.id === id)
}

/** The assistant turn currently being written, i.e. the one new content belongs to. */
function openAssistantIndex(items: TranscriptItem[]): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item && item.kind === 'assistant' && item.streaming) return i
  }
  return -1
}

/** An assistant item that has been opened but carries nothing yet (reasoning-only). */
function emptyAssistantIndex(items: TranscriptItem[]): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (!item || item.kind !== 'assistant') break
    if (item.content === '' && item.toolCalls.length === 0) return i
  }
  return -1
}

function createAssistantItem(id: string, createdAt: number): AssistantItem {
  return {
    kind: 'assistant',
    id,
    content: '',
    reasoning: '',
    toolCalls: [],
    createdAt,
    streaming: false,
  }
}

function patchAssistant(
  items: TranscriptItem[],
  index: number,
  patch: Partial<AssistantItem>,
): TranscriptItem[] {
  const item = items[index]
  if (!item || item.kind !== 'assistant') return items
  const next: AssistantItem = { ...item, ...patch }
  return [...items.slice(0, index), next, ...items.slice(index + 1)]
}

function patchToolCall(
  items: TranscriptItem[],
  itemIndex: number,
  callIndex: number,
  patch: Partial<ToolCallItem>,
): TranscriptItem[] {
  const item = items[itemIndex]
  if (!item || item.kind !== 'assistant') return items
  const toolCalls = item.toolCalls.map((call, i) =>
    i === callIndex ? { ...call, ...patch } : call,
  )
  return patchAssistant(items, itemIndex, { toolCalls })
}

type ToolCallLocation = { itemIndex: number; callIndex: number }

/**
 * Locate the tool call an event addresses: by id first, else the last call still
 * collecting arguments. Providers like Ollama sometimes omit or re-mint the id
 * on the args chunks of a call they already opened, and dropping those deltas
 * would leave the model with arguments it never actually sent (FR-AI-08).
 */
function findToolCall(items: TranscriptItem[], id: unknown): ToolCallLocation | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item?.kind !== 'assistant') continue
    for (let j = item.toolCalls.length - 1; j >= 0; j -= 1) {
      const call = item.toolCalls[j]
      if (call && typeof id === 'string' && call.id === id) {
        return { itemIndex: i, callIndex: j }
      }
    }
  }
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item?.kind !== 'assistant') continue
    for (let j = item.toolCalls.length - 1; j >= 0; j -= 1) {
      if (item.toolCalls[j]?.state === 'streaming-args') return { itemIndex: i, callIndex: j }
    }
  }
  return null
}

function toolCallAt(items: TranscriptItem[], location: ToolCallLocation): ToolCallItem | undefined {
  const item = items[location.itemIndex]
  return item?.kind === 'assistant' ? item.toolCalls[location.callIndex] : undefined
}

// --- text -------------------------------------------------------------------

function reduceTextMessageStart(
  state: TranscriptState,
  event: TextMessageStartEvent,
): TranscriptState {
  const messageId = text(event.messageId)
  const createdAt = createdAtOf(event)
  const items = settleStreaming(state.items)

  const existing = assistantIndexById(items, messageId)
  if (existing >= 0) {
    // A repeated start continues the same turn rather than opening a second one.
    return withItems(state, patchAssistant(items, existing, { streaming: true }))
  }

  // Reasoning usually streams before any text and opens its own message id. Adopt
  // that empty turn instead of splitting reasoning and answer into two bubbles.
  const adopted = emptyAssistantIndex(items)
  if (adopted >= 0 && messageId !== '') {
    const item = items[adopted]
    if (item?.kind === 'assistant') {
      const retagged: AssistantItem = { ...item, id: messageId, streaming: true }
      return withItems(state, [...items.slice(0, adopted), retagged, ...items.slice(adopted + 1)])
    }
  }

  return withItems(state, [
    ...items,
    { ...createAssistantItem(messageId, createdAt), streaming: true },
  ])
}

function reduceTextMessageContent(
  state: TranscriptState,
  event: TextMessageContentEvent,
): TranscriptState {
  const delta = text(event.delta)
  if (delta === '') return state

  let items = state.items
  let index = assistantIndexById(items, event.messageId)
  if (index < 0) index = openAssistantIndex(items)
  if (index < 0) {
    items = [...items, createAssistantItem(text(event.messageId) || newId(), createdAtOf(event))]
    index = items.length - 1
  }

  const item = items[index]
  if (!item || item.kind !== 'assistant') return state
  return withItems(state, patchAssistant(items, index, { content: item.content + delta }))
}

function reduceTextMessageEnd(state: TranscriptState, event: TextMessageEndEvent): TranscriptState {
  const index = assistantIndexById(state.items, event.messageId)
  if (index < 0) return state
  return withItems(state, patchAssistant(state.items, index, { streaming: false }))
}

function reduceTextMessageChunk(
  state: TranscriptState,
  event: TextMessageChunkEvent,
): TranscriptState {
  let next = state
  if (typeof event.messageId === 'string' && event.messageId !== '') {
    next = reduceTextMessageStart(next, event as unknown as TextMessageStartEvent)
  }
  if (typeof event.delta === 'string' && event.delta !== '') {
    next = reduceTextMessageContent(next, event as unknown as TextMessageContentEvent)
  }
  if (typeof event.messageId === 'string' && event.messageId !== '') {
    next = reduceTextMessageEnd(next, event as unknown as TextMessageEndEvent)
  }
  return next
}

// --- reasoning --------------------------------------------------------------

function reduceReasoningContent(
  state: TranscriptState,
  event: ReasoningMessageContentEvent,
): TranscriptState {
  const delta = text(event.delta)
  if (delta === '') return state

  let items = state.items
  // Reasoning rides its own message id (`<messageId>-reasoning` from the Spring AI
  // backend), so it joins whichever turn is open, or opens one (FR-AI-26).
  let index = assistantIndexById(items, event.messageId)
  if (index < 0) index = openAssistantIndex(items)
  if (index < 0) {
    items = [...items, createAssistantItem(text(event.messageId) || newId(), createdAtOf(event))]
    index = items.length - 1
  }

  const item = items[index]
  if (!item || item.kind !== 'assistant') return state
  return withItems(state, patchAssistant(items, index, { reasoning: item.reasoning + delta }))
}

// --- tool calls -------------------------------------------------------------

function reduceToolCallStart(state: TranscriptState, event: ToolCallStartEvent): TranscriptState {
  const createdAt = createdAtOf(event)
  let items = state.items

  // A tool call belongs to the assistant turn named by `parentMessageId`, else to
  // whichever turn is open, else to a turn this call opens by itself.
  let index = assistantIndexById(items, event.parentMessageId)
  if (index < 0) index = openAssistantIndex(items)
  if (index < 0) {
    items = [...items, createAssistantItem(text(event.parentMessageId) || newId(), createdAt)]
    index = items.length - 1
  }

  const item = items[index]
  if (!item || item.kind !== 'assistant') return state

  const call: ToolCallItem = {
    id: text(event.toolCallId) || `tool-call-${item.toolCalls.length + 1}`,
    name: text(event.toolCallName),
    parentMessageId: optionalText(event.parentMessageId),
    argsText: '',
    args: undefined,
    state: 'streaming-args',
    resultContent: null,
    resultError: null,
    resultMessageId: null,
    metadata: (event.metadata as Record<string, unknown> | undefined) ?? null,
    interruptId: null,
  }
  return withItems(state, patchAssistant(items, index, { toolCalls: [...item.toolCalls, call] }))
}

function reduceToolCallArgs(state: TranscriptState, event: ToolCallArgsEvent): TranscriptState {
  const delta = text(event.delta)
  if (delta === '') return state

  const found = findToolCall(state.items, event.toolCallId)
  if (!found) return state
  const call = toolCallAt(state.items, found)
  if (!call) return state

  const argsText = call.argsText + delta
  // Re-parse while still streaming so a partial call renders as soon as it is
  // valid JSON; `undefined` in between is the documented "not parseable yet".
  return withItems(
    state,
    patchToolCall(state.items, found.itemIndex, found.callIndex, {
      argsText,
      args: call.state === 'streaming-args' ? parseArgs(argsText) : call.args,
    }),
  )
}

function reduceToolCallEnd(state: TranscriptState, event: ToolCallEndEvent): TranscriptState {
  const found = findToolCall(state.items, event.toolCallId)
  if (!found) return state
  const call = toolCallAt(state.items, found)
  if (!call) return state

  const items = patchToolCall(state.items, found.itemIndex, found.callIndex, {
    args: parseArgs(call.argsText),
    state: 'awaiting-result',
  })
  const next = withItems(state, items)
  return next.lastToolCallIdsWithoutResult.includes(call.id)
    ? next
    : { ...next, lastToolCallIdsWithoutResult: [...next.lastToolCallIdsWithoutResult, call.id] }
}

function reduceToolCallChunk(state: TranscriptState, event: ToolCallChunkEvent): TranscriptState {
  // A chunk stands for start + args + end in one event, so the id may be absent
  // when it continues a call that is already open (same tolerance as TOOL_CALL_ARGS).
  const known = findToolCall(state.items, event.toolCallId)
  const alreadyOpen = known !== null && toolCallAt(state.items, known)?.state === 'streaming-args'

  let next = state
  if (!alreadyOpen) {
    next = reduceToolCallStart(next, {
      toolCallId: text(event.toolCallId),
      toolCallName: text(event.toolCallName),
      parentMessageId: optionalText(event.parentMessageId),
    } as ToolCallStartEvent)
  }

  if (typeof event.delta === 'string' && event.delta !== '') {
    next = reduceToolCallArgs(next, event as unknown as ToolCallArgsEvent)
  }
  return reduceToolCallEnd(next, event as unknown as ToolCallEndEvent)
}

function reduceToolCallResult(state: TranscriptState, event: ToolCallResultEvent): TranscriptState {
  const toolCallId = text(event.toolCallId)
  const content = contentToText(event.content)
  const error = optionalText((event as { error?: unknown }).error)
  const found = findToolCall(state.items, toolCallId)

  const next = found
    ? withItems(
        state,
        patchToolCall(state.items, found.itemIndex, found.callIndex, {
          resultContent: content,
          resultError: error,
          state: error === null ? 'done' : 'error',
          resultMessageId: optionalText(event.messageId),
        }),
      )
    : // The call is not in this transcript (a reload, or a stream whose start we
      // never saw). Keep the result visible rather than dropping it on the floor.
      withItems(state, [
        ...state.items,
        {
          kind: 'tool-result',
          id: optionalText(event.messageId) ?? newId(),
          toolCallId,
          content,
          error,
          createdAt: createdAtOf(event),
        },
      ])

  return {
    ...next,
    lastToolCallIdsWithoutResult: next.lastToolCallIdsWithoutResult.filter(
      (id) => id !== toolCallId,
    ),
  }
}

// --- run lifecycle ----------------------------------------------------------

function reduceRunStarted(state: TranscriptState, event: RunStartedEvent): TranscriptState {
  const items = settleStreaming(state.items)
  // A run that follows an interrupt is a resume, and the user should see that the
  // thread carried over rather than silently starting over (FR-AI-24).
  const resumed = state.runOutcome === 'interrupt'

  return {
    ...emptyTranscript(),
    items: resumed
      ? [...items, { kind: 'notice', id: newId(), text: 'Resumed', createdAt: createdAtOf(event) }]
      : items,
    runId: optionalText(event.runId),
    threadId: optionalText(event.threadId),
  }
}

function reduceRunFinished(state: TranscriptState, event: RunFinishedEvent): TranscriptState {
  const outcome = event.outcome
  const outcomeType = outcome?.type ?? 'success'

  const interrupts: Interrupt[] = outcome?.type === 'interrupt' ? (outcome.interrupts ?? []) : []

  // Tag the call each interrupt belongs to, so FE-12 renders the approval against
  // the right tool call rather than guessing from order.
  let items = settleStreaming(state.items)
  for (const interrupt of interrupts) {
    if (!interrupt.toolCallId) continue
    const found = findToolCall(items, interrupt.toolCallId)
    if (found)
      items = patchToolCall(items, found.itemIndex, found.callIndex, { interruptId: interrupt.id })
  }

  const next: TranscriptState = {
    ...state,
    items,
    runId: optionalText(event.runId) ?? state.runId,
    threadId: optionalText(event.threadId) ?? state.threadId,
    runOutcome:
      outcomeType === 'interrupt'
        ? 'interrupt'
        : outcomeType === 'cancelled'
          ? 'cancelled'
          : 'success',
    interrupts,
  }

  if (outcome?.type !== 'success' || !outcome.pendingToolCallIds) return next

  // Keep anything still awaiting a result even when the producer names none, so a
  // client tool the agent asked for is never silently dropped (FR-AI-08).
  const pending = [...next.lastToolCallIdsWithoutResult]
  for (const id of outcome.pendingToolCallIds) {
    if (!pending.includes(id)) pending.push(id)
  }
  return { ...next, lastToolCallIdsWithoutResult: pending }
}

function reduceRunError(state: TranscriptState, event: RunErrorEvent): TranscriptState {
  const item: TranscriptItem = {
    kind: 'error',
    id: newId(),
    message: text(event.message),
    createdAt: createdAtOf(event),
    ...(typeof event.code === 'string' ? { code: event.code } : {}),
  }
  return { ...withItems(state, [...state.items, item]), runOutcome: 'error' }
}

// --- messages snapshot ------------------------------------------------------

/**
 * Rebuild the conversation from an authoritative `MESSAGES_SNAPSHOT` (BE-07 emits
 * one per run). Client-side `notice` and `error` items are kept — the backend has
 * never seen them and cannot reproduce them — and reasoning is carried over by
 * message id, because reasoning is not part of the message contract and a rebuild
 * would otherwise erase what the user already read.
 */
function reduceMessagesSnapshot(
  state: TranscriptState,
  event: MessagesSnapshotEvent,
): TranscriptState {
  if (!Array.isArray(event.messages)) return state

  const createdAt = createdAtOf(event)
  const previousReasoning = new Map<string, string>()
  for (const item of state.items) {
    if (item.kind === 'assistant' && item.reasoning !== '')
      previousReasoning.set(item.id, item.reasoning)
  }

  const items: TranscriptItem[] = []
  for (const message of event.messages as Message[]) {
    if (message.role === 'user') {
      items.push({
        kind: 'user',
        id: message.id,
        content: contentToText(message.content),
        createdAt,
      })
      continue
    }

    if (message.role === 'assistant') {
      items.push({
        kind: 'assistant',
        id: message.id,
        content: message.content ?? '',
        reasoning: previousReasoning.get(message.id) ?? '',
        toolCalls: (message.toolCalls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          parentMessageId: message.id,
          argsText: call.function.arguments,
          args: parseArgs(call.function.arguments),
          state: 'awaiting-result',
          resultContent: null,
          resultError: null,
          resultMessageId: null,
          metadata: (call.metadata as Record<string, unknown> | undefined) ?? null,
          interruptId: null,
        })),
        createdAt,
        streaming: false,
      })
      continue
    }

    if (message.role !== 'tool') continue

    const error = optionalText(message.error)
    const found = findToolCall(items, message.toolCallId)
    if (!found) {
      items.push({
        kind: 'tool-result',
        id: message.id,
        toolCallId: message.toolCallId,
        content: contentToText(message.content),
        error,
        createdAt,
      })
      continue
    }
    // Attach to the assistant turn that made the call, so the card renders next to
    // it instead of floating loose (FR-AI-22).
    const patched = patchToolCall(items, found.itemIndex, found.callIndex, {
      resultContent: contentToText(message.content),
      resultError: error,
      state: error === null ? 'done' : 'error',
      resultMessageId: message.id,
    })
    items.splice(0, items.length, ...patched)
  }

  return withItems(state, [...items, ...preservedAnnotations(state.items)])
}

/** The client-side `notice`/`error` items a snapshot cannot reconstruct. */
function preservedAnnotations(items: TranscriptItem[]): TranscriptItem[] {
  return items.filter((item) => item.kind === 'notice' || item.kind === 'error')
}

// --- entry point ------------------------------------------------------------

export function reduceEvent(state: TranscriptState, event: BaseEvent): TranscriptState {
  if (!event || typeof event !== 'object') return state

  switch (event.type) {
    case EventType.RUN_STARTED:
      return reduceRunStarted(state, event as RunStartedEvent)
    case EventType.RUN_FINISHED:
      return reduceRunFinished(state, event as RunFinishedEvent)
    case EventType.RUN_ERROR:
      return reduceRunError(state, event as RunErrorEvent)
    case EventType.TEXT_MESSAGE_START:
      return reduceTextMessageStart(state, event as TextMessageStartEvent)
    case EventType.TEXT_MESSAGE_CONTENT:
      return reduceTextMessageContent(state, event as TextMessageContentEvent)
    case EventType.TEXT_MESSAGE_END:
      return reduceTextMessageEnd(state, event as TextMessageEndEvent)
    case EventType.TEXT_MESSAGE_CHUNK:
      return reduceTextMessageChunk(state, event as TextMessageChunkEvent)
    case EventType.REASONING_MESSAGE_CONTENT:
    case EventType.REASONING_MESSAGE_CHUNK:
      return reduceReasoningContent(state, event as ReasoningMessageContentEvent)
    case EventType.TOOL_CALL_START:
      return reduceToolCallStart(state, event as ToolCallStartEvent)
    case EventType.TOOL_CALL_ARGS:
      return reduceToolCallArgs(state, event as ToolCallArgsEvent)
    case EventType.TOOL_CALL_END:
      return reduceToolCallEnd(state, event as ToolCallEndEvent)
    case EventType.TOOL_CALL_CHUNK:
      return reduceToolCallChunk(state, event as ToolCallChunkEvent)
    case EventType.TOOL_CALL_RESULT:
      return reduceToolCallResult(state, event as ToolCallResultEvent)
    case EventType.MESSAGES_SNAPSHOT:
      return reduceMessagesSnapshot(state, event as MessagesSnapshotEvent)
    default:
      // STATE_SNAPSHOT / STATE_DELTA (FE-10), STEP_* markers, ACTIVITY_*,
      // SUBAGENT_*, RAW, CUSTOM, REASONING_* markers and REASONING_ENCRYPTED_VALUE:
      // recorded nowhere, rendered nowhere. Same reference, so a subscriber can
      // skip the update entirely.
      return state
  }
}
