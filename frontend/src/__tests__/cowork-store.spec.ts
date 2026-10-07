import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { EventType } from '@ag-ui/client'
import type { AgentSubscriber, BaseEvent, Message } from '@ag-ui/client'

import { cancelPersistedState, savePersistedState } from '@/agui/persistence'
import { emptyState } from '@/agui/state'
import type { CoworkState } from '@/agui/state'
import { useCoworkStore } from '@/stores/cowork'
import { useTaskDraft } from '@/composables/useTaskDraft'
import { useTaskStore } from '@/stores/tasks'

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
type RunErrorParams = Parameters<NonNullable<AgentSubscriber['onRunErrorEvent']>>[0]
type SnapshotParams = Parameters<NonNullable<AgentSubscriber['onStateSnapshotEvent']>>[0]
type DeltaParams = Parameters<NonNullable<AgentSubscriber['onStateDeltaEvent']>>[0]

const EMPTY_PARAMS = { messages: [], state: {}, agent: {}, input: {} } as unknown as EventParams

/** Replays a scripted event sequence through the subscriber the store installed. */
function emit(subscriber: AgentSubscriber | undefined, events: BaseEvent[]): void {
  for (const item of events) subscriber?.onEvent?.({ ...EMPTY_PARAMS, event: item })
}

/** State events reach the store through their own hooks, not the generic one. */
function emitSnapshot(subscriber: AgentSubscriber | undefined, snapshot: unknown): void {
  subscriber?.onStateSnapshotEvent?.({
    ...EMPTY_PARAMS,
    event: { type: EventType.STATE_SNAPSHOT, snapshot },
  } as unknown as SnapshotParams)
}

function emitDelta(subscriber: AgentSubscriber | undefined, delta: unknown): void {
  subscriber?.onStateDeltaEvent?.({
    ...EMPTY_PARAMS,
    event: { type: EventType.STATE_DELTA, delta },
  } as unknown as DeltaParams)
}

function finishSuccess(subscriber: AgentSubscriber | undefined): void {
  subscriber?.onRunFinishedEvent?.({
    outcome: 'success',
    result: undefined,
    pendingToolCallIds: [],
  } as unknown as RunFinishedParams)
}

function runErrorParams(message: string) {
  return { event: { message } } as unknown as RunErrorParams
}

/** The history the store last handed to the agent. */
function lastHistory(fake: FakeAgent): Message[] {
  const calls = fake.setMessages.mock.calls
  return (calls[calls.length - 1]?.[0] ?? []) as Message[]
}

const RUN_STARTED = event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' })

/** The stream the backend produces for one answered turn. */
const ANSWERED_TURN: BaseEvent[] = [
  RUN_STARTED,
  event(EventType.TEXT_MESSAGE_START, { messageId: 'm1', role: 'assistant' }),
  event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'Two ' }),
  event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'tasks are overdue.' }),
  event(EventType.TEXT_MESSAGE_END, { messageId: 'm1' }),
  event(EventType.RUN_FINISHED, { threadId: 'th1', runId: 'r1', outcome: { type: 'success' } }),
]

describe('useCoworkStore', () => {
  let fake: FakeAgent

  beforeEach(() => {
    setActivePinia(createPinia())
    settings.aguiEnabled = true
    fake = makeFakeAgent()
    getAgentMock.mockReset()
    getAgentMock.mockReturnValue(fake)
  })

  it('appends the user message and runs the agent with the client tool schemas', async () => {
    const store = useCoworkStore()

    await store.send('hello')

    expect(fake.messages).toHaveLength(1)
    expect(fake.messages[0]).toMatchObject({ role: 'user', content: 'hello' })
    expect(fake.runAgent).toHaveBeenCalledTimes(1)
    const [params, subscriber] = fake.runAgent.mock.calls[0] as [
      { tools: { name: string }[] },
      AgentSubscriber,
    ]
    // The four client tools, from their single declaration site (FR-AI-05).
    expect(params.tools.map((tool) => tool.name)).toEqual([
      'prefill_task_form',
      'update_task_status',
      'open_task',
      'ask_user',
    ])
    expect(subscriber.onEvent).toBeTypeOf('function')
    expect(store.phase).toBe('idle')
    expect(store.turnCount).toBe(1)
  })

  it('queues a message sent while running and drains it once the run settles', async () => {
    const store = useCoworkStore()
    let release: (value: unknown) => void = () => {}
    fake.runAgent.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      }),
    )

    const first = store.send('first')
    await vi.waitFor(() => expect(store.phase).toBe('starting'))

    await store.send('second')

    expect(fake.runAgent).toHaveBeenCalledTimes(1)
    expect(store.queuedMessage).toBe('second')

    release({ result: undefined, newMessages: [] })
    await first

    expect(fake.runAgent).toHaveBeenCalledTimes(2)
    expect(fake.messages.map((message) => message.content)).toEqual(['first', 'second'])
    expect(store.queuedMessage).toBeNull()
    expect(store.phase).toBe('idle')
  })

  it('sets phase and lastError from a RUN_ERROR event', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      subscriber?.onRunErrorEvent?.(runErrorParams('boom'))
      return { result: undefined, newMessages: [] }
    })

    await store.send('hi')

    expect(store.phase).toBe('error')
    expect(store.lastError).toBe('boom')
  })

  it('abortRun is called and the phase is stopped on stop()', async () => {
    const store = useCoworkStore()
    await store.send('hi')

    store.stop()

    expect(fake.abortRun).toHaveBeenCalledTimes(1)
    expect(store.phase).toBe('stopped')
  })

  it('is a no-op and constructs no agent when the feature flag is off', async () => {
    settings.aguiEnabled = false
    const store = useCoworkStore()

    await store.send('hi')

    expect(store.enabled).toBe(false)
    expect(store.canSend).toBe(false)
    expect(getAgentMock).not.toHaveBeenCalled()
    expect(fake.messages).toHaveLength(0)
  })
})

describe('useCoworkStore — transcript', () => {
  let fake: FakeAgent

  beforeEach(() => {
    setActivePinia(createPinia())
    settings.aguiEnabled = true
    fake = makeFakeAgent()
    getAgentMock.mockReset()
    getAgentMock.mockReturnValue(fake)
  })

  it('folds a scripted event sequence into the transcript and settles the phase', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emit(subscriber, ANSWERED_TURN)
      finishSuccess(subscriber)
      return { result: undefined, newMessages: [] }
    })

    await store.send('what is overdue?')

    expect(store.phase).toBe('idle')
    expect(store.transcript.runOutcome).toBe('success')
    expect(store.lastAssistantText).toBe('Two tasks are overdue.')
    expect(store.isStreaming).toBe(false)
    expect(store.items.map((item) => item.kind)).toEqual(['user', 'assistant'])
    expect(store.turns).toHaveLength(1)
    expect(store.turns[0]?.userMessageId).not.toBeNull()
  })

  it('moves to streaming on the first content event', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emit(subscriber, [RUN_STARTED])
      expect(store.phase).toBe('starting')
      emit(subscriber, [
        event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
        event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'hi' }),
      ])
      expect(store.phase).toBe('streaming')
      return { result: undefined, newMessages: [] }
    })

    await store.send('hello')
  })

  it('rebuilds the outgoing history from the transcript after a run (FR-AI-04)', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emit(subscriber, ANSWERED_TURN)
      return { result: undefined, newMessages: [] }
    })

    await store.send('what is overdue?')

    expect(lastHistory(fake)).toEqual([
      { id: expect.any(String), role: 'user', content: 'what is overdue?' },
      { id: 'm1', role: 'assistant', content: 'Two tasks are overdue.' },
    ])
  })

  it('carries a tool call and its result into the rebuilt history', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emit(subscriber, [
        RUN_STARTED,
        event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
        event(EventType.TOOL_CALL_START, {
          toolCallId: 'c1',
          toolCallName: 'query_tasks',
          parentMessageId: 'm1',
        }),
        event(EventType.TOOL_CALL_ARGS, { toolCallId: 'c1', delta: '{"q":"overdue"}' }),
        event(EventType.TOOL_CALL_END, { toolCallId: 'c1' }),
        event(EventType.TEXT_MESSAGE_END, { messageId: 'm1' }),
        event(EventType.TOOL_CALL_RESULT, {
          messageId: 'tm1',
          toolCallId: 'c1',
          content: '2 tasks',
        }),
        event(EventType.RUN_FINISHED, { threadId: 'th1', runId: 'r1' }),
      ])
      return { result: undefined, newMessages: [] }
    })

    await store.send('what is overdue?')

    expect(store.toolCallById(store.transcript, 'c1')).toMatchObject({
      name: 'query_tasks',
      args: { q: 'overdue' },
      state: 'done',
      resultContent: '2 tasks',
    })
    expect(store.toolCallsByName(store.transcript, 'query_tasks')).toHaveLength(1)
    expect(lastHistory(fake)).toEqual([
      { id: expect.any(String), role: 'user', content: 'what is overdue?' },
      {
        id: 'm1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'query_tasks', arguments: '{"q":"overdue"}' },
          },
        ],
      },
      { id: 'tm1', role: 'tool', content: '2 tasks', toolCallId: 'c1' },
    ])
  })

  it('settles awaiting_approval and blocks sending when the run interrupts', async () => {
    const store = useCoworkStore()
    const interrupts = [{ id: 'i1', reason: 'approval', toolCallId: 'c1' }]
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emit(subscriber, [
        RUN_STARTED,
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

    await store.send('mark them in review')

    expect(store.phase).toBe('awaiting_approval')
    expect(store.interrupts).toHaveLength(1)
    expect(store.hasOpenInterrupt).toBe(true)
    expect(store.canSend).toBe(false)
  })

  it('settles stopped and appends a notice when abortRun lands mid-stream (FR-AI-24)', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emit(subscriber, [
        RUN_STARTED,
        event(EventType.TEXT_MESSAGE_START, { messageId: 'm1' }),
        event(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm1', delta: 'thinking ab' }),
      ])
      store.stop()
      return { result: undefined, newMessages: [] }
    })

    await store.send('write me an essay')

    expect(fake.abortRun).toHaveBeenCalledTimes(1)
    expect(store.phase).toBe('stopped')
    expect(store.isStreaming).toBe(false)
    expect(store.items.map((item) => item.kind)).toEqual(['user', 'assistant', 'notice'])
    expect(store.items[store.items.length - 1]).toMatchObject({ kind: 'notice', text: 'Stopped' })
  })

  it('records the queued message as a notice and never interleaves it (FR-AI-25)', async () => {
    const store = useCoworkStore()
    let release: (value: unknown) => void = () => {}
    fake.runAgent.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      }),
    )

    const first = store.send('first')
    await vi.waitFor(() => expect(store.phase).toBe('starting'))
    await store.send('second')

    expect(fake.runAgent).toHaveBeenCalledTimes(1)
    expect(store.items[store.items.length - 1]).toMatchObject({
      kind: 'notice',
      text: 'Queued: second',
    })

    release({ result: undefined, newMessages: [] })
    await first

    expect(fake.runAgent).toHaveBeenCalledTimes(2)
  })

  it('never drains the queue after a stop', async () => {
    const store = useCoworkStore()
    let release: (value: unknown) => void = () => {}
    fake.runAgent.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      }),
    )

    const first = store.send('first')
    await vi.waitFor(() => expect(store.phase).toBe('starting'))
    await store.send('second')
    store.stop()
    release({ result: undefined, newMessages: [] })
    await first

    expect(fake.runAgent).toHaveBeenCalledTimes(1)
  })

  it('records a transport failure as an error phase', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockRejectedValue(new Error('404 Not Found'))

    await store.send('hi')

    expect(store.phase).toBe('error')
    expect(store.lastError).toBe('404 Not Found')
    // The history is still rebuilt, so the next turn carries what was said.
    expect(fake.setMessages).toHaveBeenCalled()
  })

  it('resets the transcript and the run state without touching the thread id', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emit(subscriber, ANSWERED_TURN)
      return { result: undefined, newMessages: [] }
    })
    await store.send('hello')

    store.reset()

    expect(store.transcript.items).toEqual([])
    expect(store.phase).toBe('idle')
    expect(store.turnCount).toBe(0)
  })
})

describe('useCoworkStore — shared state', () => {
  let fake: FakeAgent

  beforeEach(() => {
    setActivePinia(createPinia())
    sessionStorage.clear()
    settings.aguiEnabled = true
    fake = makeFakeAgent()
    getAgentMock.mockReset()
    getAgentMock.mockReturnValue(fake)
  })

  afterEach(() => {
    cancelPersistedState()
  })

  it('sends a freshly built document immediately before the run', async () => {
    const tasks = useTaskStore()
    tasks.setView('task-detail')
    await tasks.fetchDetail('t42')
    tasks.toggleSelection('t42')

    const store = useCoworkStore()
    await store.send('what is on t42?')

    expect(fake.setState).toHaveBeenCalledTimes(1)
    const order = fake.setState.mock.invocationCallOrder[0]
    expect(order).toBeLessThan(fake.runAgent.mock.invocationCallOrder[0] as number)

    const sent = fake.state as CoworkState
    expect(sent.context.view).toBe('task-detail')
    expect(sent.context.taskId).toBe('t42')
    expect(sent.context.selectedIds).toEqual(['t42'])
    expect(sent.assistant.phase).toBe('thinking')
    expect(store.lastSentState).toEqual(sent)
  })

  it('rebuilds the document on every run rather than reusing the last one', async () => {
    const tasks = useTaskStore()
    const store = useCoworkStore()
    await store.send('first')

    tasks.setView('dashboard')
    await store.send('second')

    const first = fake.setState.mock.calls[0]?.[0] as CoworkState
    const second = fake.setState.mock.calls[1]?.[0] as CoworkState
    expect(first.context.view).toBe('task-list')
    expect(second.context.view).toBe('dashboard')
  })

  it('adopts the assistant half of a snapshot and keeps its own context (FR-S-01)', async () => {
    const store = useCoworkStore()
    const interrupts = [{ id: 'i1', reason: 'approval_required', toolCallId: 'c1' }]
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emitSnapshot(subscriber, {
        context: { view: 'task-list', selectedIds: ['from-the-backend'] },
        assistant: {
          phase: 'awaiting_confirmation',
          pendingAction: {
            id: 'pa1',
            tool: 'update_task_status',
            summary: 'Mark 2 tasks DONE',
            args: {},
            origin: 'm1',
          },
        },
      })
      // The state arrives during the run; the interrupt is what pauses it.
      emit(subscriber, [
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

    await store.send('mark them done')

    expect(store.state.assistant.phase).toBe('awaiting_confirmation')
    expect(store.state.assistant.pendingAction).toMatchObject({ id: 'pa1' })
    expect(store.state.context.selectedIds).toEqual([])
    expect(store.pendingApproval).toMatchObject({
      interruptId: 'i1',
      tool: 'update_task_status',
      summary: 'Mark 2 tasks DONE',
      status: 'pending',
    })
  })

  it('applies a delta against the document the run started with', async () => {
    const store = useCoworkStore()
    const tasks = useTaskStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      // The user filters while the run is in flight.
      tasks.setQuery({ q: 'typed later' })
      emitDelta(subscriber, [{ op: 'replace', path: '/assistant/phase', value: 'thinking' }])
      emitDelta(subscriber, [
        {
          op: 'replace',
          path: '/context/filters',
          value: { status: [], priority: [], assigneeId: null, q: 'agent opinion', overdue: false },
        },
      ])
      return { result: undefined, newMessages: [] }
    })

    await store.send('hello')

    expect(store.state.assistant.phase).toBe('thinking')
    expect(store.state.context.filters.q).toBe('typed later')
    expect(store.needsResync).toBe(false)
  })

  it('sets needsResync on a failing delta and leaves the document consistent (FR-S-02)', async () => {
    const store = useCoworkStore()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emitDelta(subscriber, [{ op: 'replace', path: '/nope/not/here', value: 1 }])
      return { result: undefined, newMessages: [] }
    })

    await store.send('hello')

    expect(store.needsResync).toBe(true)
    expect(store.state.assistant.phase).toBe('thinking')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('clears needsResync on the next snapshot', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emitDelta(subscriber, [{ op: 'replace', path: '/nope', value: 1 }])
      expect(store.needsResync).toBe(true)
      emitSnapshot(subscriber, { assistant: { phase: 'idle' } })
      return { result: undefined, newMessages: [] }
    })

    await store.send('hello')

    expect(store.needsResync).toBe(false)
  })

  it('feeds an agent-written draft to the form exactly once (FR-S-03, FR-S-04)', async () => {
    const store = useCoworkStore()
    const draft = useTaskDraft()
    draft.setTarget(null)

    const agentDraft = {
      task: { title: 'Fix login redirect', estimateHours: 3 },
      taskId: null,
      source: 'ai',
      missing: ['assigneeId'],
    }

    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emitSnapshot(subscriber, { draft: agentDraft })
      // The next run echoes our own document back; that must not re-apply the draft.
      emitSnapshot(subscriber, { draft: agentDraft })
      return { result: undefined, newMessages: [] }
    })

    await store.send('create a task')

    expect(draft.draft.value?.fields.title).toBe('Fix login redirect')
    // The document carries a number, the form carries a decimal string.
    expect(draft.draft.value?.fields.estimateHours).toBe('3')
    expect(draft.draft.value?.missing).toEqual(['assigneeId'])
    draft.clear()
  })

  it('persists the document and restores it into a fresh store', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emitSnapshot(subscriber, { assistant: { phase: 'awaiting_confirmation' } })
      return { result: undefined, newMessages: [] }
    })
    await store.send('mark them done')
    savePersistedState(store.state)

    setActivePinia(createPinia())
    const restored = useCoworkStore()

    expect(restored.state.assistant.phase).toBe('awaiting_confirmation')
  })

  it('clears the state document and the resync flag on reset', async () => {
    const store = useCoworkStore()
    fake.runAgent.mockImplementation(async (_params: unknown, subscriber?: AgentSubscriber) => {
      emitDelta(subscriber, [{ op: 'replace', path: '/nope', value: 1 }])
      return { result: undefined, newMessages: [] }
    })
    await store.send('hello')

    store.reset()

    expect(store.needsResync).toBe(false)
    expect(store.state).toEqual(emptyState())
    expect(store.lastSentState).toEqual(emptyState())
    expect(store.pendingApproval).toBeNull()
  })
})
