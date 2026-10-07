import { EventType } from '@ag-ui/client'
import { describe, expect, it } from 'vitest'
import type { BaseEvent } from '@ag-ui/client'

import { reduceEvent } from '@/agui/reducer'
import {
  emptyTranscript,
  hasOpenToolCalls,
  isStreaming,
  lastAssistantText,
  openAssistantItem,
  openInterrupts,
  openToolCalls,
  toolCallById,
  toolCallsByName,
  visibleItems,
  visibleTurns,
  withNotice,
} from '@/agui/transcript'
import type { TranscriptState } from '@/agui/transcript'

/** The selectors FE-13 renders from; pinning them here keeps that contract honest. */

function event(type: EventType, payload: Record<string, unknown>): BaseEvent {
  return { type, timestamp: 1_700_000_000_000, ...payload } as BaseEvent
}

function fold(events: BaseEvent[], from: TranscriptState = emptyTranscript()): TranscriptState {
  return events.reduce(reduceEvent, from)
}

const FIRST_TURN: BaseEvent[] = [
  event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' }),
  event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
  event(EventType.TOOL_CALL_START, {
    toolCallId: 'c1',
    toolCallName: 'query_tasks',
    parentMessageId: 'm1',
  }),
  event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{}' }),
  event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
  event(EventType.TOOL_CALL_RESULT, { messageId: 'tm1', toolCallId: 'c1', content: '2 tasks' }),
  event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'two are overdue' }),
  event(EventType.TEXT_MESSAGE_END, { messageId: 'm1' }),
]

describe('transcript selectors', () => {
  const answered = withNotice(
    {
      ...emptyTranscript(),
      items: [{ kind: 'user', id: 'u1', content: 'hi', createdAt: 0 }, ...fold(FIRST_TURN).items],
    },
    'Stopped',
    'n1',
  )

  it('find the settled tool call by id and by name', () => {
    expect(toolCallById(answered, 'c1')).toMatchObject({ name: 'query_tasks', state: 'done' })
    expect(toolCallById(answered, 'missing')).toBeUndefined()
    expect(toolCallsByName(answered, 'query_tasks')).toHaveLength(1)
    expect(toolCallsByName(answered, 'nope')).toEqual([])
  })

  it('report the last assistant text and no open tool calls once everything settled', () => {
    expect(lastAssistantText(answered)).toBe('two are overdue')
    expect(hasOpenToolCalls(answered)).toBe(false)
    expect(openToolCalls(answered)).toEqual([])
    expect(isStreaming(answered)).toBe(false)
    expect(openAssistantItem(answered)).toBeUndefined()
  })

  it('report a call still awaiting its result as open', () => {
    const awaiting = fold([
      event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
      event(EventType.TOOL_CALL_START, {
        toolCallId: 'c1',
        toolCallName: 'ask_user',
        parentMessageId: 'm1',
      }),
      event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{}' }),
      event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
    ])

    expect(hasOpenToolCalls(awaiting)).toBe(true)
    expect(openToolCalls(awaiting).map((call) => call.id)).toEqual(['c1'])
  })

  it('drop an assistant item that carries nothing yet from the visible list', () => {
    const empty = fold([event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' })])
    expect(visibleItems(empty)).toEqual([])
    expect(visibleItems(answered)).toHaveLength(3)
  })

  it('group items into turns, one per user message', () => {
    const twoTurns = fold([event(EventType.TEXT_MESSAGE_START, { messageId: 'm2' })], {
      ...emptyTranscript(),
      items: [...answered.items, { kind: 'user', id: 'u2', content: 'and blocked?', createdAt: 2 }],
    })

    const turns = visibleTurns(twoTurns)
    expect(turns).toHaveLength(2)
    expect(turns[0]?.userMessageId).toBe('u1')
    expect(turns[1]?.userMessageId).toBe('u2')
    expect(turns[1]?.items.map((item) => item.kind)).toEqual(['user', 'assistant'])
  })

  it('put anything sent before the first user message into a leading turn', () => {
    const turns = visibleTurns(withNotice(emptyTranscript(), 'Resumed', 'n1'))

    expect(turns).toHaveLength(1)
    expect(turns[0]?.userMessageId).toBeNull()
    expect(turns[0]?.items[0]).toMatchObject({ kind: 'notice' })
  })

  it('drop an interrupt that has expired', () => {
    const interrupted = fold([
      event(EventType.RUN_FINISHED, {
        threadId: 'th1',
        runId: 'r1',
        outcome: {
          type: 'interrupt',
          interrupts: [
            { id: 'live', reason: 'approval' },
            { id: 'stale', reason: 'approval', expiresAt: '2020-01-01T00:00:00.000Z' },
          ],
        },
      }),
    ])

    expect(interrupted.interrupts).toHaveLength(2)
    expect(openInterrupts(interrupted).map((interrupt) => interrupt.id)).toEqual(['live'])
  })
})
