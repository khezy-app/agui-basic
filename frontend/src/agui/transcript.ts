import { contentToText } from '@ag-ui/client'
import type { ContentPart, Interrupt, Message, ToolCall } from '@ag-ui/client'

/**
 * The transcript is the single source of truth for the chat panel: the AG-UI
 * event stream folds into it (`reduceEvent`) and the outgoing history is
 * rebuilt from it (`transcriptToMessages`), because the frontend owns history
 * (FR-AI-04).
 */

export type ToolCallState = 'streaming-args' | 'awaiting-result' | 'done' | 'error'

export type ToolCallItem = {
  id: string
  name: string
  parentMessageId: string | null
  /** Raw streamed JSON. Partial and invalid until `TOOL_CALL_END`; always kept so the UI can show it (FR-AI-27). */
  argsText: string
  /** Parsed `argsText`, or `undefined` while it is incomplete or malformed. */
  args: unknown
  state: ToolCallState
  resultContent: string | null
  resultError: string | null
  /** Message id of the `TOOL_CALL_RESULT` that settled this call (FR-AI-22). */
  resultMessageId: string | null
  metadata: Record<string, unknown> | null
  /** Set once an interrupt is raised for this call; FE-12 resolves it. */
  interruptId: string | null
}

export type TranscriptItem =
  | { kind: 'user'; id: string; content: string; createdAt: number }
  | AssistantItem
  | {
      kind: 'tool-result'
      id: string
      toolCallId: string
      content: string
      error: string | null
      createdAt: number
    }
  | { kind: 'error'; id: string; message: string; code?: string; createdAt: number }
  | { kind: 'notice'; id: string; text: string; createdAt: number }

/** One assistant turn: interleaved answer text, reasoning and the calls it made. */
export type AssistantItem = {
  kind: 'assistant'
  id: string
  content: string
  reasoning: string
  toolCalls: ToolCallItem[]
  createdAt: number
  streaming: boolean
}

export type TranscriptState = {
  items: TranscriptItem[]
  runId: string | null
  threadId: string | null
  runOutcome: 'none' | 'success' | 'interrupt' | 'cancelled' | 'error'
  interrupts: Interrupt[]
  /** Tool calls from the last run that the application still has to answer. */
  lastToolCallIdsWithoutResult: string[]
}

/**
 * Appends a client-side annotation ("Stopped", "Queued: …") to the transcript.
 *
 * These are not protocol events, so the reducer cannot produce them; they live
 * here next to `emptyTranscript` so the store has one way to write into the model.
 */
export function withNotice(state: TranscriptState, notice: string, id: string): TranscriptState {
  return {
    ...state,
    items: [...state.items, { kind: 'notice', id, text: notice, createdAt: Date.now() }],
  }
}

/**
 * Closes any turn still marked as streaming.
 *
 * An aborted run never sends `RUN_FINISHED`, so without this the interrupted turn
 * would keep its typing caret spinning forever (FR-AI-24).
 */
export function settleStreaming(state: TranscriptState): TranscriptState {
  if (!state.items.some((item) => item.kind === 'assistant' && item.streaming)) return state
  return {
    ...state,
    items: state.items.map((item) =>
      item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item,
    ),
  }
}

/**
 * Records the outcome of a client tool call (FE-11).
 *
 * The `ToolMessage` itself is *not* built here: `transcriptToMessages` derives it from
 * these fields, so the history the backend receives and the result the panel renders
 * cannot drift apart.
 */
export function settleToolCall(
  state: TranscriptState,
  toolCallId: string,
  result: { content: string; error: string | null; messageId: string },
): TranscriptState {
  let changed = false

  const items = state.items.map((item) => {
    if (item.kind !== 'assistant') return item
    if (!item.toolCalls.some((call) => call.id === toolCallId)) return item

    changed = true
    const toolCalls = item.toolCalls.map((call) =>
      call.id === toolCallId
        ? {
            ...call,
            resultContent: result.content,
            resultError: result.error,
            resultMessageId: result.messageId,
            state: result.error === null ? ('done' as const) : ('error' as const),
          }
        : call,
    )
    return { ...item, toolCalls }
  })

  if (!changed) return state
  return {
    ...state,
    items,
    lastToolCallIdsWithoutResult: state.lastToolCallIdsWithoutResult.filter(
      (id) => id !== toolCallId,
    ),
  }
}

export function emptyTranscript(): TranscriptState {
  return {
    items: [],
    runId: null,
    threadId: null,
    runOutcome: 'none',
    interrupts: [],
    lastToolCallIdsWithoutResult: [],
  }
}

/** The assistant turn currently being written, i.e. the last one still open. */
export function openAssistantItem(state: TranscriptState): TranscriptItem | undefined {
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item && item.kind === 'assistant' && item.streaming) return item
  }
  return undefined
}

export function toolCallById(state: TranscriptState, id: string): ToolCallItem | undefined {
  for (const item of state.items) {
    if (item.kind !== 'assistant') continue
    const call = item.toolCalls.find((candidate) => candidate.id === id)
    if (call) return call
  }
  return undefined
}

/** Text of the most recent assistant turn; empty while the model has said nothing yet. */
export function lastAssistantText(state: TranscriptState): string {
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item && item.kind === 'assistant' && item.content) return item.content
  }
  return ''
}

/** A tool call still waiting for its arguments or its result. */
export function openToolCalls(state: TranscriptState): ToolCallItem[] {
  const open: ToolCallItem[] = []
  for (const item of state.items) {
    if (item.kind !== 'assistant') continue
    for (const call of item.toolCalls) {
      if (call.state === 'streaming-args' || call.state === 'awaiting-result') open.push(call)
    }
  }
  return open
}

export function hasOpenToolCalls(state: TranscriptState): boolean {
  return openToolCalls(state).length > 0
}

export function toolCallsByName(state: TranscriptState, name: string): ToolCallItem[] {
  const calls: ToolCallItem[] = []
  for (const item of state.items) {
    if (item.kind !== 'assistant') continue
    for (const call of item.toolCalls) {
      if (call.name === name) calls.push(call)
    }
  }
  return calls
}

export function isStreaming(state: TranscriptState): boolean {
  return openAssistantItem(state) !== undefined
}

/** Interrupts the agent is still waiting on an answer for. */
export function openInterrupts(state: TranscriptState): Interrupt[] {
  const now = Date.now()
  return state.interrupts.filter((interrupt) => {
    if (!interrupt.expiresAt) return true
    const expiry = Date.parse(interrupt.expiresAt)
    return Number.isNaN(expiry) || expiry > now
  })
}

/** One turn of the conversation: a `user` item plus everything the agent produced in answer to it. */
export type TranscriptTurn = {
  id: string
  userMessageId: string | null
  items: TranscriptItem[]
}

/** The transcript grouped into turns; anything before the first user message forms a leading turn. */
export function visibleTurns(state: TranscriptState): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  let current: TranscriptTurn = { id: 'turn-0', userMessageId: null, items: [] }
  let turnNumber = 0

  for (const item of state.items) {
    if (item.kind === 'user') {
      if (current.items.length > 0) turns.push(current)
      turnNumber += 1
      current = { id: `turn-${turnNumber}`, userMessageId: item.id, items: [item] }
      continue
    }
    current.items.push(item)
  }
  if (current.items.length > 0) turns.push(current)
  return turns
}

/** The transcript in order, dropping assistant items that carry nothing renderable yet. */
export function visibleItems(state: TranscriptState): TranscriptItem[] {
  return state.items.filter((item) => {
    if (item.kind !== 'assistant') return true
    return item.content !== '' || item.reasoning !== '' || item.toolCalls.length > 0
  })
}

/**
 * The history sent to the backend, rebuilt from the transcript (FR-AI-04).
 *
 * Reasoning is deliberately not replayed: it is the agent's scratchpad, not part of the
 * conversation contract, and re-sending it grows the prompt without changing the answer.
 * `error` and `notice` items are dropped for the same reason — a client-side failure is
 * not conversation history and must never be handed to the model as one.
 *
 * Optional keys are spread in only when they carry a value: the client's egress guard
 * rejects `null` fields.
 */
export function transcriptToMessages(
  state: TranscriptState,
  options: { skipToolCallIds?: ReadonlySet<string> } = {},
): Message[] {
  const skip = options.skipToolCallIds
  const messages: Message[] = []

  for (const item of state.items) {
    if (item.kind === 'user') {
      messages.push({ id: item.id, role: 'user', content: item.content })
      continue
    }

    if (item.kind === 'assistant') {
      // An unanswered tool call breaks the conversation contract, so a call whose
      // arguments never parsed is dropped rather than replayed half-built.
      const toolCalls: ToolCall[] = item.toolCalls.flatMap((call) =>
        call.args === undefined
          ? []
          : [
              {
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              },
            ],
      )
      messages.push({
        id: item.id,
        role: 'assistant',
        content: item.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      })

      // The tool messages the results arrived with, in call order. They have to
      // follow the assistant turn that declared the calls, or the backend rejects
      // the history — and without them the model can never see what its own
      // tool call returned.
      for (const call of item.toolCalls) {
        if (call.args === undefined) continue
        if (call.state !== 'done' && call.state !== 'error') continue
        // A client tool whose result is delivered through the resume channel in this run
        // must not also appear as a tool message, or the backend sees two responses for
        // one tool call.
        if (skip?.has(call.id) === true) continue
        messages.push({
          id: call.resultMessageId ?? `${item.id}:${call.id}`,
          role: 'tool',
          content: call.resultContent ?? '',
          toolCallId: call.id,
          ...(call.resultError === null ? {} : { error: call.resultError }),
        })
      }
      continue
    }

    if (item.kind === 'tool-result') {
      messages.push({
        id: item.id,
        role: 'tool',
        content: item.content,
        toolCallId: item.toolCallId,
        ...(item.error === null ? {} : { error: item.error }),
      })
    }
  }

  return messages
}

/** The text a tool result carries, flattened from its string or content-part form. */
export function toolResultText(content: string | ContentPart[]): string {
  return contentToText(content)
}
