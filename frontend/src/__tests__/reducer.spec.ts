import { describe, expect, it } from 'vitest'
import { EventType } from '@ag-ui/client'
import type { BaseEvent, Message } from '@ag-ui/client'

import { reduceEvent } from '@/agui/reducer'
import { emptyTranscript } from '@/agui/transcript'
import type { AssistantItem, ToolCallItem, TranscriptState } from '@/agui/transcript'

/** Timestamps are pinned so `createdAt` never leaks wall-clock into an assertion. */
const T0 = 1_700_000_000_000

function event<E extends BaseEvent>(type: EventType, payload: Record<string, unknown>): E {
  return { type, timestamp: T0, ...payload } as E
}

function fold(events: BaseEvent[], from: TranscriptState = emptyTranscript()): TranscriptState {
  return events.reduce(reduceEvent, from)
}

function assistantItems(state: TranscriptState): AssistantItem[] {
  return state.items.filter((item): item is AssistantItem => item.kind === 'assistant')
}

function onlyAssistant(state: TranscriptState): AssistantItem {
  const items = assistantItems(state)
  expect(items).toHaveLength(1)
  return items[0] as AssistantItem
}

function callsOf(state: TranscriptState): ToolCallItem[] {
  return assistantItems(state).flatMap((item) => item.toolCalls)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

describe('reduceEvent — text messages', () => {
  it('folds start, content and end into one assistant item', () => {
    const state = fold([
      event(EventType.TEXT_MESSAGE_START, { messageId: 'm1', role: 'assistant' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'Hello' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: ', ' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'world' }),
      event(EventType.TEXT_MESSAGE_END, { messageId: 'm1' }),
    ])

    const item = onlyAssistant(state)
    expect(item.content).toBe('Hello, world')
    expect(item.streaming).toBe(false)
    expect(item.id).toBe('m1')
  })

  it('continues an existing item when a start repeats the same messageId', () => {
    const state = fold([
      event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'one' }),
      event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: ' two' }),
    ])

    expect(assistantItems(state)).toHaveLength(1)
    expect(onlyAssistant(state).content).toBe('one two')
  })

  it('marks the item as streaming until the end event arrives', () => {
    const streaming = fold([
      event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'partial' }),
    ])
    expect(onlyAssistant(streaming).streaming).toBe(true)

    const settled = reduceEvent(streaming, event(EventType.TEXT_MESSAGE_END, { messageId: 'm1' }))
    expect(onlyAssistant(settled).streaming).toBe(false)
  })

  it('accumulates streamed text in order', () => {
    const state = fold(
      ['a', 'b', 'c', 'd'].map((delta) =>
        event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta }),
      ),
    )
    expect(onlyAssistant(state).content).toBe('abcd')
  })

  it('treats TEXT_MESSAGE_CHUNK as start + content + end', () => {
    const state = fold([event(EventType.TEXT_MESSAGE_CHUNK, { messageId: 'm1', delta: 'chunked' })])

    const item = onlyAssistant(state)
    expect(item.content).toBe('chunked')
    expect(item.streaming).toBe(false)
  })
})

describe('reduceEvent — reasoning', () => {
  it('lands reasoning in `reasoning`, never in `content`', () => {
    const state = fold([
      event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
      event(EventType.REASONING_START, { messageId: 'm1-reasoning' }),
      event(EventType.REASONING_MESSAGE_START, { messageId: 'm1-reasoning', role: 'reasoning' }),
      event(EventType.REASONING_MESSAGE_CONTENT, { messageId: 'm1-reasoning', delta: 'think ' }),
      event(EventType.REASONING_MESSAGE_CONTENT, { messageId: 'm1-reasoning', delta: 'hard' }),
      event(EventType.REASONING_MESSAGE_END, { messageId: 'm1-reasoning' }),
      event(EventType.REASONING_END, { messageId: 'm1-reasoning' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'answer' }),
    ])

    const item = onlyAssistant(state)
    expect(item.reasoning).toBe('think hard')
    expect(item.content).toBe('answer')
  })

  it('creates the assistant item when reasoning arrives before any text', () => {
    const state = fold([
      event(EventType.REASONING_MESSAGE_CONTENT, { messageId: 'm1-reasoning', delta: 'first' }),
      event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'then this' }),
    ])

    // Reasoning rides its own message id; it must not become a second bubble.
    const item = onlyAssistant(state)
    expect(item.id).toBe('m1')
    expect(item.reasoning).toBe('first')
    expect(item.content).toBe('then this')
  })
})

describe('reduceEvent — tool call arguments', () => {
  const started = event(EventType.TOOL_CALL_START, {
    toolCallId: 'c1',
    toolCallName: 'query_tasks',
    parentMessageId: 'm1',
  })

  it('leaves args undefined while argsText is partial, keeping argsText intact (FR-AI-27)', () => {
    const state = fold([
      started,
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{"sta' }),
    ])

    const call = callsOf(state)[0] as ToolCallItem
    expect(call.argsText).toBe('{"sta')
    expect(call.args).toBeUndefined()
    expect(call.state).toBe('streaming-args')
  })

  it('parses complete JSON on TOOL_CALL_END and waits for the result', () => {
    const state = fold([
      started,
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{"status":' }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '"TODO"}' }),
      event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
    ])

    const call = callsOf(state)[0] as ToolCallItem
    expect(call.args).toEqual({ status: 'TODO' })
    expect(call.state).toBe('awaiting-result')
    expect(state.lastToolCallIdsWithoutResult).toEqual(['c1'])
  })

  it('keeps malformed complete JSON without throwing and leaves args undefined', () => {
    const state = fold([
      started,
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{not json' }),
      event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
    ])

    const call = callsOf(state)[0] as ToolCallItem
    expect(call.argsText).toBe('{not json')
    expect(call.args).toBeUndefined()
    expect(call.state).toBe('awaiting-result')
  })

  it('keeps two interleaved tool calls separate by id', () => {
    const state = fold([
      event(EventType.TOOL_CALL_START, {
        toolCallId: 'c1',
        toolCallName: 'a',
        parentMessageId: 'm1',
      }),
      event(EventType.TOOL_CALL_START, {
        toolCallId: 'c2',
        toolCallName: 'b',
        parentMessageId: 'm1',
      }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c2', delta: '{"b":' }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{"a":' }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c2', delta: '1}' }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '2}' }),
      event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
      event(EventType.TOOL_CALL_END, { toolCallId: 'c2' }),
    ])

    const [c1, c2] = callsOf(state) as [ToolCallItem, ToolCallItem]
    expect(c1.args).toEqual({ a: 2 })
    expect(c2.args).toEqual({ b: 1 })
    expect(assistantItems(state)).toHaveLength(1)
  })

  it('falls back to the last open call when the id is missing', () => {
    const state = fold([
      event(EventType.TOOL_CALL_START, {
        toolCallId: 'c1',
        toolCallName: 'a',
        parentMessageId: 'm1',
      }),
      event(EventType.TOOL_CALL_START, {
        toolCallId: 'c2',
        toolCallName: 'b',
        parentMessageId: 'm1',
      }),
      // Ollama-style: the args chunk arrives without the id it was opened with.
      event(EventType.TOOL_CALL_ARGS, { toolCallId: undefined, delta: '{"late":true}' }),
      event(EventType.TOOL_CALL_END, { toolCallId: undefined }),
    ])

    const [c1, c2] = callsOf(state) as [ToolCallItem, ToolCallItem]
    expect(c1.argsText).toBe('')
    expect(c2.argsText).toBe('{"late":true}')
    expect(c2.state).toBe('awaiting-result')
  })

  it('TOOL_CALL_CHUNK equals start + args + end', () => {
    const chunked = fold([
      event(EventType.TOOL_CALL_CHUNK, {
        toolCallId: 'c1',
        toolCallName: 'query_tasks',
        parentMessageId: 'm1',
        delta: '{"q":"overdue"}',
      }),
    ])

    const split = fold([
      event(EventType.TOOL_CALL_START, {
        toolCallId: 'c1',
        toolCallName: 'query_tasks',
        parentMessageId: 'm1',
      }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{"q":"overdue"}' }),
      event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
    ])

    expect(callsOf(chunked)[0]).toEqual(callsOf(split)[0])
    expect((callsOf(chunked)[0] as ToolCallItem).args).toEqual({ q: 'overdue' })
  })

  it('continues the open call when a chunk omits the id', () => {
    const state = fold([
      event(EventType.TOOL_CALL_START, {
        toolCallId: 'c1',
        toolCallName: 'a',
        parentMessageId: 'm1',
      }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{"a"' }),
      event(EventType.TOOL_CALL_CHUNK, { toolCallId: undefined, delta: ':1}' }),
    ])

    expect(callsOf(state)).toHaveLength(1)
    expect((callsOf(state)[0] as ToolCallItem).args).toEqual({ a: 1 })
  })
})

describe('reduceEvent — tool results', () => {
  const withOpenCall = (): TranscriptState =>
    fold([
      event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
      event(EventType.TOOL_CALL_START, {
        toolCallId: 'c1',
        toolCallName: 'query_tasks',
        parentMessageId: 'm1',
      }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{}' }),
      event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
    ])

  it('fills the result and settles the call as done', () => {
    const state = reduceEvent(
      withOpenCall(),
      event(EventType.TOOL_CALL_RESULT, { messageId: 'tm1', toolCallId: 'c1', content: '2 tasks' }),
    )

    const call = callsOf(state)[0] as ToolCallItem
    expect(call.resultContent).toBe('2 tasks')
    expect(call.resultError).toBeNull()
    expect(call.resultMessageId).toBe('tm1')
    expect(call.state).toBe('done')
    expect(state.lastToolCallIdsWithoutResult).toEqual([])
  })

  it('settles the call as error when the event carries an error (FR-AI-18)', () => {
    const state = reduceEvent(
      withOpenCall(),
      event(EventType.TOOL_CALL_RESULT, {
        messageId: 'tm1',
        toolCallId: 'c1',
        content: '',
        error: 'validation failed',
      }),
    )

    const call = callsOf(state)[0] as ToolCallItem
    expect(call.state).toBe('error')
    expect(call.resultError).toBe('validation failed')
  })

  it('appends a standalone tool-result item when no call matches (FR-AI-08)', () => {
    const state = reduceEvent(
      emptyTranscript(),
      event(EventType.TOOL_CALL_RESULT, {
        messageId: 'tm1',
        toolCallId: 'orphan',
        content: 'still shown',
      }),
    )

    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({
      kind: 'tool-result',
      id: 'tm1',
      toolCallId: 'orphan',
      content: 'still shown',
      error: null,
    })
  })
})

describe('reduceEvent — run lifecycle', () => {
  const runStarted = event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' })

  it('records the run and thread ids and resets the outcome', () => {
    const interrupted = fold([
      runStarted,
      event(EventType.RUN_FINISHED, {
        threadId: 'th1',
        runId: 'r1',
        outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval' }] },
      }),
    ])
    const next = reduceEvent(
      interrupted,
      event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r2' }),
    )

    expect(next.runId).toBe('r2')
    expect(next.threadId).toBe('th1')
    expect(next.runOutcome).toBe('none')
  })

  it('keeps the prior turn items across a run boundary', () => {
    const first = fold([
      runStarted,
      event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'hi' }),
      event(EventType.TEXT_MESSAGE_END, { messageId: 'm1' }),
      event(EventType.RUN_FINISHED, { threadId: 'th1', runId: 'r1' }),
    ])
    const second = reduceEvent(
      first,
      event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r2' }),
    )

    expect(second.items.map((item) => item.kind)).toEqual(['assistant'])
  })

  it('records a notice when a run resumes after an interrupt', () => {
    const first = fold([
      runStarted,
      event(EventType.RUN_FINISHED, {
        threadId: 'th1',
        runId: 'r1',
        outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval' }] },
      }),
    ])
    const second = reduceEvent(
      first,
      event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r2' }),
    )

    expect(second.items.some((item) => item.kind === 'notice')).toBe(true)
  })

  it('records interrupts and tags the originating tool call', () => {
    const state = fold([
      runStarted,
      event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
      event(EventType.TOOL_CALL_START, {
        toolCallId: 'c1',
        toolCallName: 'update_task_status',
        parentMessageId: 'm1',
      }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{}' }),
      event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
      event(EventType.RUN_FINISHED, {
        threadId: 'th1',
        runId: 'r1',
        outcome: {
          type: 'interrupt',
          interrupts: [{ id: 'i1', reason: 'approval', toolCallId: 'c1' }],
        },
      }),
    ])

    expect(state.runOutcome).toBe('interrupt')
    expect(state.interrupts).toHaveLength(1)
    expect((callsOf(state)[0] as ToolCallItem).interruptId).toBe('i1')
  })

  it('reads an omitted outcome as success (legacy reading)', () => {
    const state = fold([
      runStarted,
      event(EventType.RUN_FINISHED, { threadId: 'th1', runId: 'r1' }),
    ])

    expect(state.runOutcome).toBe('success')
    expect(state.interrupts).toEqual([])
  })

  it('records pending tool call ids on success', () => {
    const state = fold([
      runStarted,
      event(EventType.RUN_FINISHED, {
        threadId: 'th1',
        runId: 'r1',
        outcome: { type: 'success', pendingToolCallIds: ['c9'] },
      }),
    ])

    expect(state.lastToolCallIdsWithoutResult).toEqual(['c9'])
  })

  it('settles a cancelled run as cancelled', () => {
    const state = fold([
      runStarted,
      event(EventType.RUN_FINISHED, {
        threadId: 'th1',
        runId: 'r1',
        outcome: { type: 'cancelled' },
      }),
    ])

    expect(state.runOutcome).toBe('cancelled')
  })

  it('appends an error item and sets the outcome on RUN_ERROR (FR-AI-23)', () => {
    const state = fold([
      runStarted,
      event(EventType.RUN_ERROR, { message: 'model unavailable', code: 'ECONNREFUSED' }),
    ])

    expect(state.runOutcome).toBe('error')
    expect(state.items[state.items.length - 1]).toMatchObject({
      kind: 'error',
      message: 'model unavailable',
      code: 'ECONNREFUSED',
    })
  })

  it('closes a turn left streaming when the run ends', () => {
    const state = fold([
      runStarted,
      event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'half a thought' }),
      event(EventType.RUN_FINISHED, { threadId: 'th1', runId: 'r1' }),
    ])

    expect(onlyAssistant(state).streaming).toBe(false)
  })
})

describe('reduceEvent — messages snapshot', () => {
  const messages: Message[] = [
    { id: 'u1', role: 'user', content: 'hello' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'sure',
      toolCalls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'query_tasks', arguments: '{"q":"overdue"}' },
        },
      ],
    },
    { id: 't1', role: 'tool', content: '2 tasks', toolCallId: 'c1' },
  ]

  it('replaces user and assistant items but keeps notice and error items', () => {
    const before = fold([
      event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' }),
      event(EventType.RUN_ERROR, { message: 'previous failure' }),
      event(EventType.TEXT_MESSAGE_START, { messageId: 'stale' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'stale', delta: 'stale text' }),
      event(EventType.RUN_FINISHED, { threadId: 'th1', runId: 'r1' }),
    ])

    const after = reduceEvent(before, event(EventType.MESSAGES_SNAPSHOT, { messages }))

    expect(after.items.map((item) => item.kind)).toEqual(['user', 'assistant', 'error'])
    expect(after.items.filter((item) => item.kind === 'assistant')).toHaveLength(1)
    expect(assistantItems(after)[0]?.content).toBe('sure')
    expect((callsOf(after)[0] as ToolCallItem).resultContent).toBe('2 tasks')
  })

  it('keeps reasoning that only the event stream ever carried', () => {
    const before = fold([
      event(EventType.TEXT_MESSAGE_START, { messageId: 'a1' }),
      event(EventType.REASONING_MESSAGE_CONTENT, { messageId: 'a1-reasoning', delta: 'thinking' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'a1', delta: 'sure' }),
      event(EventType.TEXT_MESSAGE_END, { messageId: 'a1' }),
    ])

    const after = reduceEvent(before, event(EventType.MESSAGES_SNAPSHOT, { messages }))

    expect(onlyAssistant(after).reasoning).toBe('thinking')
  })
})

describe('reduceEvent — ignored and malformed events', () => {
  it('returns the same reference for events it does not own', () => {
    const state = fold([event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' })])

    for (const ignored of [
      event(EventType.ACTIVITY_SNAPSHOT, { messageId: 'a' }),
      event(EventType.ACTIVITY_DELTA, { messageId: 'a', delta: 'x' }),
      event(EventType.RAW, { event: { any: 'thing' } }),
      event(EventType.CUSTOM, { name: 'x', value: 1 }),
      event(EventType.STEP_STARTED, { stepName: 'think' }),
      event(EventType.STEP_FINISHED, { stepName: 'think' }),
      event(EventType.STATE_SNAPSHOT, { snapshot: { a: 1 } }),
      event(EventType.STATE_DELTA, { delta: [] }),
      event(EventType.SUBAGENT_STARTED, { subagentRunId: 's1' }),
      event(EventType.REASONING_ENCRYPTED_VALUE, { messageId: 'a1-reasoning', value: 'xx' }),
      { type: 'NOT_A_REAL_EVENT', timestamp: T0 } as unknown as BaseEvent,
    ]) {
      expect(reduceEvent(state, ignored)).toBe(state)
    }
  })

  it('never throws on a malformed event', () => {
    const state = fold([event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' })])

    for (const malformed of [
      null,
      undefined,
      {},
      { type: EventType.TEXT_MESSAGE_CONTENT },
      { type: EventType.TEXT_MESSAGE_START },
      { type: EventType.TOOL_CALL_ARGS, delta: 'x' },
      { type: EventType.TOOL_CALL_END },
      { type: EventType.TOOL_CALL_RESULT, toolCallId: 'c' },
      { type: EventType.RUN_FINISHED, outcome: { type: 'nonsense' } },
      { type: EventType.MESSAGES_SNAPSHOT, messages: 'not-an-array' },
    ] as unknown as BaseEvent[]) {
      expect(() => reduceEvent(state, malformed)).not.toThrow()
    }
  })
})

describe('reduceEvent — purity', () => {
  it('does not mutate a deeply frozen input over a full run', () => {
    const seeded = deepFreeze(
      fold([
        event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' }),
        event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
        event(EventType.REASONING_MESSAGE_CONTENT, { messageId: 'm1-reasoning', delta: 'why' }),
        event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'because' }),
        event(EventType.TOOL_CALL_START, {
          toolCallId: 'c1',
          toolCallName: 'query_tasks',
          parentMessageId: 'm1',
        }),
        event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{"q":' }),
        event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
        event(EventType.TOOL_CALL_RESULT, { messageId: 'tm1', toolCallId: 'c1', content: 'ok' }),
        event(EventType.TEXT_MESSAGE_END, { messageId: 'm1' }),
        event(EventType.RUN_FINISHED, { threadId: 'th1', runId: 'r1' }),
      ]),
    )
    const snapshot = JSON.stringify(seeded)

    expect(() =>
      fold(
        [
          event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r2' }),
          event(EventType.TEXT_MESSAGE_START, { messageId: 'm2' }),
          event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm2', delta: 'again' }),
          event(EventType.TEXT_MESSAGE_END, { messageId: 'm2' }),
          event(EventType.RUN_ERROR, { message: 'boom' }),
        ],
        seeded,
      ),
    ).not.toThrow()

    expect(JSON.stringify(seeded)).toBe(snapshot)
  })

  it('shares nothing mutable with its input', () => {
    const before = fold([
      event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'first' }),
    ])
    const after = reduceEvent(
      before,
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: ' second' }),
    )

    expect(after).not.toBe(before)
    expect(after.items).not.toBe(before.items)
    expect(after.items[0]).not.toBe(before.items[0])
    expect(onlyAssistant(before).content).toBe('first')
    expect(onlyAssistant(after).content).toBe('first second')
  })
})
