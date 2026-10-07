import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { EventType } from '@ag-ui/client'
import type { AgentSubscriber, BaseEvent, Message } from '@ag-ui/client'

import { useCoworkStore } from '@/stores/cowork'

const { settings, getAgentMock } = vi.hoisted(() => ({
  settings: { aguiEnabled: true, aguiUrl: '/agent' },
  getAgentMock: vi.fn<() => unknown>(),
}))

vi.mock('@/config', () => ({ config: settings }))
vi.mock('@/agui/agent', () => ({
  getAgent: getAgentMock,
  resetAgent: vi.fn<() => void>(),
  currentThreadId: vi.fn<() => string | null>(() => null),
  newThread: vi.fn<() => string>(),
}))

// The handlers reach for the API, the router and Pinia; this suite drives the store's
// dispatch wiring, not the handlers themselves (handlers-*.spec.ts cover those).
type HandlerMock = Mock<(args: unknown, call: unknown) => Promise<unknown>>

const handlerMocks: {
  prefill_task_form: HandlerMock
  update_task_status: HandlerMock
  open_task: HandlerMock
  ask_user: HandlerMock
} = vi.hoisted(() => ({
  prefill_task_form: vi.fn<(args: unknown, call: unknown) => Promise<unknown>>(),
  update_task_status: vi.fn<(args: unknown, call: unknown) => Promise<unknown>>(),
  open_task: vi.fn<(args: unknown, call: unknown) => Promise<unknown>>(),
  ask_user: vi.fn<(args: unknown, call: unknown) => Promise<unknown>>(),
}))

vi.mock('@/agui/handlers', () => ({
  handlers: handlerMocks,
  buildStatusPlan: vi.fn<() => []>(() => []),
  ASK_USER_TIMEOUT_MS: 600_000,
}))

type RunAgentFn = (params?: unknown, subscriber?: AgentSubscriber) => Promise<unknown>

type FakeAgent = {
  messages: Message[]
  setMessages: Mock<(messages: Message[]) => void>
  state: unknown
  setState: Mock<(state: unknown) => void>
  runAgent: Mock<RunAgentFn>
  abortRun: Mock<() => void>
}

function makeFakeAgent(): FakeAgent {
  const fake: FakeAgent = {
    messages: [],
    setMessages: vi.fn<(messages: Message[]) => void>((messages) => {
      fake.messages = messages
    }),
    state: undefined,
    setState: vi.fn<(state: unknown) => void>((state) => {
      fake.state = state
    }),
    runAgent: vi.fn<RunAgentFn>().mockResolvedValue({ result: undefined, newMessages: [] }),
    abortRun: vi.fn<() => void>(),
  }
  return fake
}

function event(type: EventType, payload: Record<string, unknown>): BaseEvent {
  return { type, timestamp: 1_700_000_000_000, ...payload } as BaseEvent
}

type EventParams = Parameters<NonNullable<AgentSubscriber['onEvent']>>[0]
type RunFinishedParams = Parameters<NonNullable<AgentSubscriber['onRunFinishedEvent']>>[0]

const EMPTY_PARAMS = { messages: [], state: {}, agent: {}, input: {} } as unknown as EventParams

function emit(subscriber: AgentSubscriber | undefined, events: BaseEvent[]): void {
  for (const item of events) subscriber?.onEvent?.({ ...EMPTY_PARAMS, event: item })
}

/** A turn that opens a client tool call and never answers it. */
function toolCallTurn(callId: string, name: string, args: unknown): BaseEvent[] {
  return [
    event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' }),
    event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
    event(EventType.TOOL_CALL_START, {
      toolCallId: callId,
      toolCallName: name,
      parentMessageId: 'm1',
    }),
    event(EventType.TOOL_CALL_ARGS, { toolCallId: callId, delta: JSON.stringify(args) }),
    event(EventType.TOOL_CALL_END, { toolCallId: callId }),
  ]
}

function finish(subscriber: AgentSubscriber | undefined, pendingToolCallIds: string[]): void {
  subscriber?.onRunFinishedEvent?.({
    outcome: 'success',
    result: undefined,
    pendingToolCallIds,
  } as unknown as RunFinishedParams)
}

function lastHistory(fake: FakeAgent): Message[] {
  const calls = fake.setMessages.mock.calls
  return (calls[calls.length - 1]?.[0] ?? []) as Message[]
}

describe('client tool dispatch', () => {
  let fake: FakeAgent

  beforeEach(() => {
    setActivePinia(createPinia())
    settings.aguiEnabled = true
    fake = makeFakeAgent()
    getAgentMock.mockReset()
    getAgentMock.mockReturnValue(fake)
    for (const handler of Object.values(handlerMocks)) handler.mockReset()
    handlerMocks.prefill_task_form.mockResolvedValue({ ok: true, content: 'prefilled title="X"' })
    handlerMocks.open_task.mockResolvedValue({ ok: true, content: 'opened t1' })
    handlerMocks.update_task_status.mockResolvedValue({ ok: true, content: 'approved: 1 updated' })
    handlerMocks.ask_user.mockResolvedValue({ ok: true, content: 'answer: yes' })
  })

  it('dispatches pending client tool calls after a success outcome', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      if (fake.runAgent.mock.calls.length === 1) {
        emit(subscriber, toolCallTurn('c1', 'prefill_task_form', { title: 'X' }))
        finish(subscriber, ['c1'])
      }
      return { result: undefined, newMessages: [] }
    })

    await store.send('create a task')

    await vi.waitFor(() => expect(handlerMocks.prefill_task_form).toHaveBeenCalledTimes(1))
    expect(handlerMocks.prefill_task_form.mock.calls[0]?.[0]).toEqual({ title: 'X' })
  })

  it('records the result on the transcript item (FR-AI-08)', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emit(subscriber, toolCallTurn('c1', 'prefill_task_form', { title: 'X' }))
      finish(subscriber, ['c1'])
      return { result: undefined, newMessages: [] }
    })

    await store.send('create a task')

    await vi.waitFor(() =>
      expect(store.toolCallById(store.transcript, 'c1')).toMatchObject({
        state: 'done',
        resultContent: 'prefilled title="X"',
        resultError: null,
      }),
    )
    expect(store.hasOpenToolCalls).toBe(false)
  })

  it('starts a follow-up run carrying the tool message', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      if (fake.runAgent.mock.calls.length === 1) {
        emit(subscriber, toolCallTurn('c1', 'prefill_task_form', { title: 'X' }))
        finish(subscriber, ['c1'])
      }
      return { result: undefined, newMessages: [] }
    })

    await store.send('create a task')

    await vi.waitFor(() => expect(fake.runAgent).toHaveBeenCalledTimes(2))
    const history = lastHistory(fake)
    const toolMessage = history.find((message) => message.role === 'tool')
    expect(toolMessage).toEqual({
      id: expect.any(String),
      role: 'tool',
      content: 'prefilled title="X"',
      toolCallId: 'c1',
    })
  })

  it('never emits a null error on a tool message (egress guard)', async () => {
    const store = useCoworkStore()
    handlerMocks.open_task.mockResolvedValue({
      ok: false,
      content: 'not_found t9',
      error: 'not_found',
    })
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      if (fake.runAgent.mock.calls.length === 1) {
        emit(subscriber, toolCallTurn('c1', 'open_task', { taskId: 't9' }))
        finish(subscriber, ['c1'])
      }
      return { result: undefined, newMessages: [] }
    })

    await store.send('open t9')

    await vi.waitFor(() => expect(fake.runAgent).toHaveBeenCalledTimes(2))
    for (const message of lastHistory(fake)) {
      for (const [key, value] of Object.entries(message)) {
        expect(value, `${message.role}.${key}`).not.toBeNull()
      }
    }
    expect(lastHistory(fake).find((message) => message.role === 'tool')).toMatchObject({
      error: 'not_found',
    })
  })

  it('reports a tool the model invented instead of crashing (FR-AI-08)', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      if (fake.runAgent.mock.calls.length === 1) {
        emit(subscriber, toolCallTurn('c1', 'delete_everything', {}))
        finish(subscriber, ['c1'])
      }
      return { result: undefined, newMessages: [] }
    })

    await store.send('do something wild')

    await vi.waitFor(() => expect(fake.runAgent).toHaveBeenCalledTimes(2))
    expect(store.toolCallById(store.transcript, 'c1')).toMatchObject({
      state: 'error',
      resultError: 'unknown tool delete_everything',
    })
    expect(Object.values(handlerMocks).flatMap((h) => h.mock.calls)).toHaveLength(0)
  })

  it('turns a throwing handler into an error result rather than an unhandled rejection', async () => {
    const store = useCoworkStore()
    handlerMocks.prefill_task_form.mockRejectedValue(new Error('router exploded'))
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      if (fake.runAgent.mock.calls.length === 1) {
        emit(subscriber, toolCallTurn('c1', 'prefill_task_form', { title: 'X' }))
        finish(subscriber, ['c1'])
      }
      return { result: undefined, newMessages: [] }
    })

    await store.send('create a task')

    await vi.waitFor(() =>
      expect(store.toolCallById(store.transcript, 'c1')).toMatchObject({
        state: 'error',
        resultError: 'router exploded',
      }),
    )
  })

  it('routes a backend interrupt tool to the approval queue without dispatching a handler', async () => {
    const store = useCoworkStore()
    const interrupts = [{ id: 'c1', reason: 'input_required', toolCallId: 'c1' }]
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emit(subscriber, [
        ...toolCallTurn('c1', 'propose_task_mutation', { tool: 'delete_task' }),
        event(EventType.RUN_FINISHED, {
          threadId: 'th1',
          runId: 'r1',
          outcome: { type: 'interrupt', interrupts },
        }),
      ])
      subscriber?.onRunFinishedEvent?.({
        outcome: 'interrupt',
        interrupts,
      } as unknown as RunFinishedParams)
      return { result: undefined, newMessages: [] }
    })

    await store.send('create a task')

    expect(Object.values(handlerMocks).flatMap((h) => h.mock.calls)).toHaveLength(0)
    expect(fake.runAgent).toHaveBeenCalledTimes(1)
    expect(store.phase).toBe('awaiting_approval')
  })

  it('dispatches a CLIENT tool paused as an interrupt outcome (FR-AI-29)', async () => {
    const store = useCoworkStore()
    const interrupts = [{ id: 'c1', reason: 'tool_call', toolCallId: 'c1' }]
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      if (fake.runAgent.mock.calls.length === 1) {
        emit(subscriber, toolCallTurn('c1', 'prefill_task_form', { title: 'X' }))
        subscriber?.onRunFinishedEvent?.({
          outcome: 'interrupt',
          interrupts,
        } as unknown as RunFinishedParams)
      }
      return { result: undefined, newMessages: [] }
    })

    await store.send('create a task')

    await vi.waitFor(() => expect(handlerMocks.prefill_task_form).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(fake.runAgent).toHaveBeenCalledTimes(2))

    // The result goes back through the resume channel; a re-run would be rejected by the
    // backend with "pending interrupt(s) not addressed by resume".
    const secondParams = fake.runAgent.mock.calls[1]?.[0] as { resume?: unknown[] }
    expect(secondParams.resume).toEqual([
      { interruptId: 'c1', status: 'resolved', payload: 'prefilled title="X"' },
    ])
  })

  it('dispatches nothing on a cancelled outcome', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emit(subscriber, toolCallTurn('c1', 'prefill_task_form', { title: 'X' }))
      subscriber?.onRunFinishedEvent?.({ outcome: 'cancelled' } as unknown as RunFinishedParams)
      return { result: undefined, newMessages: [] }
    })

    await store.send('create a task')

    expect(handlerMocks.prefill_task_form).not.toHaveBeenCalled()
  })

  it('runs several pending calls in order', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      if (fake.runAgent.mock.calls.length === 1) {
        emit(subscriber, [
          ...toolCallTurn('c1', 'prefill_task_form', { title: 'X' }),
          ...toolCallTurn('c2', 'open_task', { taskId: 't1' }),
        ])
        finish(subscriber, ['c1', 'c2'])
      }
      return { result: undefined, newMessages: [] }
    })

    await store.send('create a task and open t1')

    await vi.waitFor(() => expect(fake.runAgent).toHaveBeenCalledTimes(2))
    expect(handlerMocks.prefill_task_form.mock.invocationCallOrder[0]).toBeLessThan(
      handlerMocks.open_task.mock.invocationCallOrder[0] as number,
    )
  })

  it('stops after three follow-up runs and hands control back to the user', async () => {
    const store = useCoworkStore()
    // Every round asks for one more tool call, forever.
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      const round = fake.runAgent.mock.calls.length
      emit(subscriber, toolCallTurn(`c${round}`, 'open_task', { taskId: 't1' }))
      finish(subscriber, [`c${round}`])
      return { result: undefined, newMessages: [] }
    })

    await store.send('go')

    // The user turn plus exactly three follow-up runs, then the loop refuses to start a fourth.
    await vi.waitFor(() => expect(handlerMocks.open_task).toHaveBeenCalledTimes(4))
    expect(fake.runAgent).toHaveBeenCalledTimes(4)
    expect(store.phase).toBe('idle')
    expect(store.items.some((item) => item.kind === 'notice')).toBe(true)
  })

  it('resets the round counter when the user speaks again', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      if (fake.runAgent.mock.calls.length === 1) {
        emit(subscriber, toolCallTurn('c1', 'open_task', { taskId: 't1' }))
        finish(subscriber, ['c1'])
      }
      return { result: undefined, newMessages: [] }
    })

    await store.send('open t1')
    await vi.waitFor(() => expect(fake.runAgent).toHaveBeenCalledTimes(2))

    await store.send('and now something else')
    expect(fake.runAgent).toHaveBeenCalledTimes(3)
  })

  it('advertises the four client tools and nothing else (FR-AI-05)', async () => {
    useCoworkStore()
    await useCoworkStore().send('hi')

    const [params] = fake.runAgent.mock.calls[0] as [{ tools: { name: string }[] }]
    expect(params.tools.map((tool) => tool.name)).toEqual([
      'prefill_task_form',
      'update_task_status',
      'open_task',
      'ask_user',
    ])
  })

  it('a tool-loop round is not counted as a user turn', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      if (fake.runAgent.mock.calls.length === 1) {
        emit(subscriber, toolCallTurn('c1', 'open_task', { taskId: 't1' }))
        finish(subscriber, ['c1'])
      }
      return { result: undefined, newMessages: [] }
    })

    await store.send('open t1')
    await vi.waitFor(() => expect(fake.runAgent).toHaveBeenCalledTimes(2))

    expect(store.turnCount).toBe(1)
  })
})
