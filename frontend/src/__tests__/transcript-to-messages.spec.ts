import { EventType } from '@ag-ui/client'
import { describe, expect, it } from 'vitest'
import type { Message } from '@ag-ui/client'

import { reduceEvent } from '@/agui/reducer'
import { emptyTranscript, transcriptToMessages } from '@/agui/transcript'
import type { TranscriptState } from '@/agui/transcript'

/**
 * The history rebuilt from the transcript is what the backend actually sees, so
 * these tests pin its shape rather than the reducer that produced it.
 */

function event(type: EventType, payload: Record<string, unknown>) {
  return { type, timestamp: 1_700_000_000_000, ...payload } as never
}

function fold(events: unknown[], from: TranscriptState = emptyTranscript()): TranscriptState {
  return (events as never[]).reduce(reduceEvent, from)
}

function withItems(items: TranscriptState['items']): TranscriptState {
  return { ...emptyTranscript(), items }
}

/** Puts a user turn in front of the turn the reducer produced. */
function withUserTurn(state: TranscriptState, text = 'what is overdue?'): TranscriptState {
  return {
    ...state,
    items: [{ kind: 'user', id: 'u1', content: text, createdAt: 0 }, ...state.items],
  }
}

describe('transcriptToMessages', () => {
  it('maps a user item to a user message', () => {
    const state = withItems([{ kind: 'user', id: 'u1', content: 'hello', createdAt: 1 }])

    expect(transcriptToMessages(state)).toEqual([{ id: 'u1', role: 'user', content: 'hello' }])
  })

  it('maps an assistant turn with a parsed tool call to AssistantMessage.toolCalls', () => {
    const state = fold([
      event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' }),
      event(EventType.TEXT_MESSAGE_START, { messageId: 'a1' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'a1', delta: 'checking' }),
      event(EventType.TOOL_CALL_START, {
        toolCallId: 'c1',
        toolCallName: 'query_tasks',
        parentMessageId: 'a1',
      }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{"q":"overdue"}' }),
      event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
      event(EventType.TEXT_MESSAGE_END, { messageId: 'a1' }),
    ])

    expect(transcriptToMessages(state)).toEqual([
      {
        id: 'a1',
        role: 'assistant',
        content: 'checking',
        toolCalls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'query_tasks', arguments: '{"q":"overdue"}' },
          },
        ],
      },
    ])
  })

  it('omits a tool call whose arguments never parsed', () => {
    const state = fold([
      event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' }),
      event(EventType.TEXT_MESSAGE_START, { messageId: 'a1' }),
      event(EventType.TOOL_CALL_START, {
        toolCallId: 'c1',
        toolCallName: 'query_tasks',
        parentMessageId: 'a1',
      }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{"q":' }),
    ])

    const [message] = transcriptToMessages(state) as Message[]
    expect(message).toEqual({ id: 'a1', role: 'assistant', content: '' })
    expect('toolCalls' in (message as object)).toBe(false)
  })

  it('maps a standalone tool-result item to a ToolMessage with the matching toolCallId', () => {
    const state = withItems([
      {
        kind: 'tool-result',
        id: 'tm1',
        toolCallId: 'c1',
        content: '2 tasks',
        error: null,
        createdAt: 1,
      },
    ])

    expect(transcriptToMessages(state)).toEqual([
      { id: 'tm1', role: 'tool', content: '2 tasks', toolCallId: 'c1' },
    ])
  })

  it('carries a tool error onto the ToolMessage', () => {
    const state = withItems([
      {
        kind: 'tool-result',
        id: 'tm1',
        toolCallId: 'c1',
        content: '',
        error: 'blocked',
        createdAt: 1,
      },
    ])

    expect(transcriptToMessages(state)).toEqual([
      { id: 'tm1', role: 'tool', content: '', toolCallId: 'c1', error: 'blocked' },
    ])
  })

  it('drops error and notice items — they are not conversation history', () => {
    const state = withItems([
      { kind: 'user', id: 'u1', content: 'hi', createdAt: 1 },
      { kind: 'notice', id: 'n1', text: 'Stopped', createdAt: 2 },
      { kind: 'error', id: 'e1', message: 'model unavailable', createdAt: 3 },
    ])

    expect(transcriptToMessages(state)).toEqual([{ id: 'u1', role: 'user', content: 'hi' }])
  })

  it('never replays reasoning', () => {
    const state = fold([
      event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' }),
      event(EventType.REASONING_MESSAGE_CONTENT, {
        messageId: 'a1-reasoning',
        delta: 'secret thinking',
      }),
      event(EventType.TEXT_MESSAGE_START, { messageId: 'a1' }),
      event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'a1', delta: 'the answer' }),
      event(EventType.TEXT_MESSAGE_END, { messageId: 'a1' }),
    ])

    expect(JSON.stringify(transcriptToMessages(state))).not.toContain('secret thinking')
    expect(transcriptToMessages(state)).toEqual([
      { id: 'a1', role: 'assistant', content: 'the answer' },
    ])
  })

  it('contains no null fields anywhere — the client egress guard rejects them', () => {
    const state = fold([
      event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' }),
      event(EventType.TEXT_MESSAGE_START, { messageId: 'a1' }),
      event(EventType.TOOL_CALL_START, {
        toolCallId: 'c1',
        toolCallName: 'query_tasks',
        parentMessageId: 'a1',
      }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{}' }),
      event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
      event(EventType.TOOL_CALL_RESULT, { messageId: 'tm1', toolCallId: 'c1', content: 'ok' }),
      event(EventType.RUN_ERROR, { message: 'later failure' }),
      event(EventType.RUN_FINISHED, { threadId: 'th1', runId: 'r1' }),
    ])
    state.items.unshift({ kind: 'user', id: 'u1', content: 'hi', createdAt: 0 })

    const messages = transcriptToMessages(state)

    expect(messages.length).toBeGreaterThan(0)
    for (const message of messages) {
      for (const [key, value] of Object.entries(message)) {
        expect(value, `${message.role}.${key} must not be null`).not.toBeNull()
      }
    }
    // A full round trip through JSON is the actual egress path.
    expect(JSON.parse(JSON.stringify(messages))).toEqual(messages)
  })

  it('replays the result of a tool call the agent made, right after that call', () => {
    const state = withUserTurn(
      fold([
        event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' }),
        event(EventType.TEXT_MESSAGE_START, { messageId: 'a1' }),
        event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'a1', delta: 'one moment' }),
        event(EventType.TOOL_CALL_START, {
          toolCallId: 'c1',
          toolCallName: 'query_tasks',
          parentMessageId: 'a1',
        }),
        event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{}' }),
        event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
        event(EventType.TEXT_MESSAGE_END, { messageId: 'a1' }),
        event(EventType.TOOL_CALL_RESULT, {
          messageId: 'tm1',
          toolCallId: 'c1',
          content: '2 overdue',
        }),
        event(EventType.TEXT_MESSAGE_START, { messageId: 'a2' }),
        event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'a2', delta: 'two are overdue' }),
        event(EventType.TEXT_MESSAGE_END, { messageId: 'a2' }),
      ]),
    )

    expect(transcriptToMessages(state)).toEqual([
      { id: 'u1', role: 'user', content: 'what is overdue?' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'one moment',
        toolCalls: [
          { id: 'c1', type: 'function', function: { name: 'query_tasks', arguments: '{}' } },
        ],
      },
      { id: 'tm1', role: 'tool', content: '2 overdue', toolCallId: 'c1' },
      { id: 'a2', role: 'assistant', content: 'two are overdue' },
    ])
  })

  it('omits the result of a call that is still waiting for one', () => {
    const state = withUserTurn(
      fold([
        event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' }),
        event(EventType.TEXT_MESSAGE_START, { messageId: 'a1' }),
        event(EventType.TOOL_CALL_START, {
          toolCallId: 'c1',
          toolCallName: 'ask_user',
          parentMessageId: 'a1',
        }),
        event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{}' }),
        event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
      ]),
    )

    expect(transcriptToMessages(state).map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ])
  })
})
