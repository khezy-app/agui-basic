import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { EventType } from '@ag-ui/client'
import type { AgentSubscriber, BaseEvent, Message } from '@ag-ui/client'

import { emptyTranscript } from '@/agui/transcript'
import { EMPTY_STATS, makePage, makeTask, TEAM_MEMBERS } from './fixtures'
import { useCoworkStore } from '@/stores/cowork'
import { useTaskStore } from '@/stores/tasks'

const { settings, getAgentMock, resetAgentMock } = vi.hoisted(() => ({
  settings: { aguiEnabled: true, aguiUrl: '/agent' },
  getAgentMock: vi.fn<() => unknown>(),
  resetAgentMock: vi.fn<() => void>(),
}))

vi.mock('@/config', () => ({ config: settings }))
vi.mock('@/agui/agent', () => ({
  getAgent: getAgentMock,
  resetAgent: resetAgentMock,
  currentThreadId: vi.fn<() => string | null>(() => 'th1'),
  newThread: vi.fn<() => string>(),
}))
vi.mock('@/api/tasks', () => ({
  taskApi: {
    list: vi.fn<() => Promise<unknown>>(),
    stats: vi.fn<() => Promise<unknown>>(),
    get: vi.fn<(id: string) => Promise<unknown>>(),
    create: vi.fn<() => Promise<unknown>>(),
    patch: vi.fn<() => Promise<unknown>>(),
    changeStatus: vi.fn<() => Promise<unknown>>(),
    bulkStatus: vi.fn<() => Promise<unknown>>(),
    remove: vi.fn<() => Promise<unknown>>(),
  },
}))
vi.mock('@/api/team', () => ({
  teamApi: { list: vi.fn<() => Promise<unknown>>() },
}))

import { taskApi } from '@/api/tasks'
import { teamApi } from '@/api/team'
import { useUiStore } from '@/stores/ui'

type RunAgentFn = (
  params?: { resume?: unknown[] },
  subscriber?: AgentSubscriber,
) => Promise<unknown>

type FakeAgent = {
  threadId: string
  messages: Message[]
  setMessages: Mock<(messages: Message[]) => void>
  state: unknown
  setState: Mock<(state: unknown) => void>
  runAgent: Mock<RunAgentFn>
  abortRun: Mock<() => void>
}

function makeFakeAgent(): FakeAgent {
  const fake: FakeAgent = {
    threadId: 'th1',
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

const EMPTY_PARAMS = { messages: [], state: {}, agent: {}, input: {} } as unknown as EventParams

/** The interrupt BE-09 actually emits: the proposal rides in `metadata.arguments` as JSON. */
function mutationInterrupt(
  id: string,
  proposal: Record<string, unknown>,
  toolCallId = 'c1',
): Record<string, unknown> {
  return {
    id,
    reason: 'input_required',
    message: 'propose_task_mutation',
    toolCallId,
    metadata: { toolName: 'propose_task_mutation', arguments: JSON.stringify(proposal) },
  }
}

const STATUS_PROPOSAL = {
  tool: 'update_task_status',
  args: { taskId: 't1', status: 'DONE' },
  summary: 'Mark the task Done',
  reason: 'The user asked for it.',
}

/**
 * Scripts the first run to stop on an interrupt and every later (resume) run to succeed,
 * so a test can inspect what the resume actually carried.
 */
function scriptInterruptRun(fake: FakeAgent, interrupts: Record<string, unknown>[]): void {
  fake.runAgent.mockImplementation(async (params, subscriber) => {
    if (params?.resume === undefined) {
      subscriber?.onEvent?.({
        ...EMPTY_PARAMS,
        event: event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r1' }),
      })
      subscriber?.onEvent?.({
        ...EMPTY_PARAMS,
        event: event(EventType.RUN_FINISHED, {
          threadId: 'th1',
          runId: 'r1',
          outcome: { type: 'interrupt', interrupts },
        }),
      })
      subscriber?.onRunFinishedEvent?.({
        outcome: 'interrupt',
        interrupts,
        pendingToolCallIds: [],
      } as unknown as RunFinishedParams)
    } else {
      // A real resume run opens a fresh run (which clears the previous interrupts) and
      // then finishes successfully.
      subscriber?.onEvent?.({
        ...EMPTY_PARAMS,
        event: event(EventType.RUN_STARTED, { threadId: 'th1', runId: 'r2' }),
      })
      subscriber?.onEvent?.({
        ...EMPTY_PARAMS,
        event: event(EventType.RUN_FINISHED, {
          threadId: 'th1',
          runId: 'r2',
          outcome: { type: 'success', pendingToolCallIds: [] },
        }),
      })
      subscriber?.onRunFinishedEvent?.({
        outcome: 'success',
        pendingToolCallIds: [],
      } as unknown as RunFinishedParams)
    }
    return { result: undefined, newMessages: [] }
  })
}

/** The resume array the nth run was called with (`undefined` for a non-resume run). */
function resumeOf(
  fake: FakeAgent,
  callIndex: number,
): { interruptId: string; status: string; payload?: unknown }[] {
  const call = fake.runAgent.mock.calls[callIndex]
  const params = call?.[0] as {
    resume?: { interruptId: string; status: string; payload?: unknown }[]
  }
  return params?.resume ?? []
}

/** Brings the store up to a state where one approval card is open. */
async function openCard(
  interrupts: Record<string, unknown>[] = [mutationInterrupt('i1', STATUS_PROPOSAL)],
) {
  const store = useCoworkStore()
  scriptInterruptRun(fake, interrupts)
  await store.send('mark it done')
  await vi.waitFor(() => expect(store.pendingApproval).not.toBeNull())
  return store
}

let fake: FakeAgent

beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  settings.aguiEnabled = true
  fake = makeFakeAgent()
  getAgentMock.mockReset()
  getAgentMock.mockReturnValue(fake)
  resetAgentMock.mockReset()

  const list = taskApi.list as unknown as Mock
  list.mockResolvedValue(makePage([makeTask({ id: 't1' })]))
  ;(taskApi.stats as unknown as Mock).mockResolvedValue(EMPTY_STATS)
  ;(taskApi.get as unknown as Mock).mockResolvedValue(makeTask({ id: 't1', status: 'DONE' }))
  ;(taskApi.changeStatus as unknown as Mock).mockResolvedValue(
    makeTask({ id: 't1', status: 'DONE' }),
  )
  ;(taskApi.bulkStatus as unknown as Mock).mockResolvedValue({
    updated: 1,
    tasks: [makeTask({ id: 't1', status: 'DONE' })],
  })
  ;(taskApi.create as unknown as Mock).mockResolvedValue(makeTask({ id: 'new' }))
  ;(taskApi.patch as unknown as Mock).mockResolvedValue(makeTask({ id: 't1' }))
  ;(taskApi.remove as unknown as Mock).mockResolvedValue(undefined)
  ;(teamApi.list as unknown as Mock).mockResolvedValue(TEAM_MEMBERS)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('interrupt intake (FR-AI-20)', () => {
  it('opens a card from interrupt.metadata and blocks the composer', async () => {
    const store = await openCard()

    expect(store.pendingApproval).toMatchObject({
      interruptId: 'i1',
      toolCallId: 'c1',
      tool: 'update_task_status',
      summary: 'Mark the task Done',
      status: 'pending',
    })
    expect(store.phase).toBe('awaiting_approval')
    expect(store.canSend).toBe(false)
  })

  it('persists the card so a reload can re-offer it', async () => {
    await openCard()

    const stored = JSON.parse(sessionStorage.getItem('agui.pendingApproval') ?? 'null')
    expect(stored).toMatchObject({
      interruptId: 'i1',
      tool: 'update_task_status',
      status: 'pending',
    })
  })

  it('describes the card without any raw JSON', async () => {
    const store = await openCard()

    expect(store.approvalDescription?.title).toBe('Change status')
    const values = store.approvalDescription?.lines.map((line) => line.value).join(' | ') ?? ''
    expect(values).not.toContain('{')
  })

  it('queues a second interrupt behind the first', async () => {
    const store = await openCard([
      mutationInterrupt('i1', STATUS_PROPOSAL),
      mutationInterrupt('i2', { ...STATUS_PROPOSAL, summary: 'Second' }, 'c2'),
    ])

    expect(store.approvalQueue).toHaveLength(2)
    expect(store.pendingApproval?.interruptId).toBe('i1')
  })

  it('still opens an answerable card when the proposal cannot be read', async () => {
    const store = await openCard([mutationInterrupt('i1', { tool: 'nope', args: {} })])

    expect(store.pendingApproval).toMatchObject({ interruptId: 'i1', tool: '' })
  })
})

describe('approve (FR-AI-11, FR-AI-17)', () => {
  it('performs the mutation, refetches, and resumes with the REST result', async () => {
    const store = await openCard()
    const tasks = useTaskStore()

    await store.approve('i1')

    // The write went through the store, so the list and stats were refetched (FR-AI-17).
    expect(taskApi.changeStatus).toHaveBeenCalledWith('t1', {
      status: 'DONE',
      reopen: false,
      expectedVersion: undefined,
    })
    expect(taskApi.list).toHaveBeenCalled()
    expect(taskApi.stats).toHaveBeenCalled()
    expect(tasks.lastWrite.kind).toBe('status')

    const resume = resumeOf(fake, 1)
    expect(resume).toHaveLength(1)
    expect(resume[0]).toMatchObject({
      interruptId: 'i1',
      status: 'resolved',
      payload: { approved: true, result: { id: 't1', status: 'DONE' } },
    })
  })

  it('resumes on the same singleton agent, so the thread id is unchanged', async () => {
    const store = await openCard()

    await store.approve('i1')

    expect(getAgentMock).toHaveBeenCalled()
    expect(resetAgentMock).not.toHaveBeenCalled()
    expect(fake.threadId).toBe('th1')
    // Both runs went to the same agent instance — there is only one.
    expect(fake.runAgent).toHaveBeenCalledTimes(2)
  })

  it('clears the card once the resume run settles', async () => {
    const store = await openCard()

    await store.approve('i1')

    expect(store.pendingApproval).toBeNull()
    expect(store.canSend).toBe(true)
  })

  it('issues exactly one resume when approve is clicked twice (FR-AI-14)', async () => {
    const store = await openCard()

    const first = store.approve('i1')
    const second = store.approve('i1')
    await Promise.all([first, second])

    // The initial run plus exactly one resume.
    expect(fake.runAgent).toHaveBeenCalledTimes(2)
    expect(fake.runAgent.mock.calls.filter((call) => call[0]?.resume !== undefined)).toHaveLength(1)
  })

  it('keeps the card open and reports the failure when the mutation fails (FR-AI-18)', async () => {
    const store = await openCard()
    ;(taskApi.changeStatus as unknown as Mock).mockRejectedValue(
      Object.assign(new Error('Rejected'), { kind: 'illegal-transition', name: 'ApiError' }),
    )

    await store.approve('i1')

    const resume = resumeOf(fake, 1)
    const payload = (resume[0]?.payload ?? {}) as {
      approved?: boolean
      error?: string
      result?: unknown
    }
    expect(payload.approved).toBe(true)
    expect(payload.error).toBeTruthy()
    expect(payload.result).toBeUndefined()

    expect(store.pendingApproval).not.toBeNull()
    expect(store.pendingApproval?.status).toBe('pending')
    expect(store.pendingApproval?.error).toBeTruthy()
  })
})

describe('reject and dismiss (FR-AI-16, AC-2.5)', () => {
  it('reject performs no mutation and resumes with the reason', async () => {
    const store = await openCard()
    const changeStatus = vi.spyOn(useTaskStore(), 'changeStatus')

    await store.reject('i1', 'Not this one')

    expect(changeStatus).not.toHaveBeenCalled()
    expect(taskApi.changeStatus).not.toHaveBeenCalled()
    expect(taskApi.bulkStatus).not.toHaveBeenCalled()
    expect(taskApi.patch).not.toHaveBeenCalled()
    expect(taskApi.create).not.toHaveBeenCalled()

    expect(resumeOf(fake, 1)[0]).toMatchObject({
      interruptId: 'i1',
      status: 'resolved',
      payload: { approved: false, reason: 'Not this one' },
    })
    expect(store.pendingApproval).toBeNull()
  })

  it('reject still sends a usable reason when the user typed nothing', async () => {
    const store = await openCard()

    await store.reject('i1')

    const payload = resumeOf(fake, 1)[0]?.payload as { reason?: string }
    expect(payload.reason).toBeTruthy()
  })

  it('dismiss resumes as cancelled with no payload and no mutation', async () => {
    const store = await openCard()

    await store.dismiss('i1')

    const entry = resumeOf(fake, 1)[0]
    expect(entry).toMatchObject({ interruptId: 'i1', status: 'cancelled' })
    expect(entry?.payload).toBeUndefined()
    expect(taskApi.changeStatus).not.toHaveBeenCalled()
  })
})

describe('incomplete resume (protocol rule)', () => {
  it('surfaces the buildResumeArray failure instead of swallowing it', async () => {
    // Two interrupts are open; answering only one cannot satisfy the protocol.
    const store = await openCard([
      mutationInterrupt('i1', STATUS_PROPOSAL),
      mutationInterrupt('i2', { ...STATUS_PROPOSAL, summary: 'Second' }, 'c2'),
    ])

    await expect(store.approve('i1')).rejects.toThrow(/missing responses/)

    expect(useUiStore().toasts.some((toast) => toast.kind === 'error')).toBe(true)
    // The card is put back so the user is not left staring at a stuck button.
    expect(store.pendingApproval?.status).toBe('pending')
  })
})

describe('reload recovery (FR-AI-20, AC-2.8)', () => {
  it('restores a persisted pending approval and keeps the composer closed', () => {
    sessionStorage.setItem(
      'agui.pendingApproval',
      JSON.stringify({
        interruptId: 'i9',
        toolCallId: 'c9',
        tool: 'update_task_status',
        args: { taskId: 't1', status: 'DONE' },
        summary: 'Restored proposal',
        reason: 'input_required',
        messageId: 'c9',
        createdAt: 1_700_000_000_000,
        status: 'pending',
      }),
    )

    const store = useCoworkStore()

    expect(store.pendingApproval).toMatchObject({
      interruptId: 'i9',
      tool: 'update_task_status',
      summary: 'Restored proposal',
      status: 'pending',
      restored: true,
    })
    expect(store.canSend).toBe(false)
    expect(store.phase).toBe('awaiting_approval')
  })

  it('ignores a settled record', () => {
    sessionStorage.setItem(
      'agui.pendingApproval',
      JSON.stringify({ interruptId: 'i9', tool: 'delete_task', args: {}, status: 'settled' }),
    )

    expect(useCoworkStore().pendingApproval).toBeNull()
  })

  it('resumes an approved restored card on the persisted thread id', async () => {
    sessionStorage.setItem(
      'agui.pendingApproval',
      JSON.stringify({
        interruptId: 'i9',
        toolCallId: 'c9',
        tool: 'delete_task',
        args: { taskId: 't1' },
        summary: 'Delete it',
        reason: 'input_required',
        messageId: 'c9',
        createdAt: 1_700_000_000_000,
        status: 'pending',
      }),
    )

    const store = useCoworkStore()
    fake.runAgent.mockResolvedValue({ result: undefined, newMessages: [] })

    await store.approve('i9')

    expect(getAgentMock).toHaveBeenCalled()
    expect(fake.threadId).toBe('th1')
    expect(resumeOf(fake, 0)[0]).toMatchObject({
      interruptId: 'i9',
      status: 'resolved',
      payload: { approved: true, result: { deleted: 't1' } },
    })
  })
})

describe('stale resume', () => {
  it('clears the pending approval and toasts when the backend rejects the resume', async () => {
    const store = await openCard()
    // The resume run comes back as a RUN_ERROR — the interrupt is no longer valid.
    fake.runAgent.mockImplementation(async (params, subscriber) => {
      if (params?.resume !== undefined) {
        subscriber?.onRunErrorEvent?.({
          event: { message: 'unknown interrupt id' },
        } as unknown as RunErrorParams)
      }
      return { result: undefined, newMessages: [] }
    })

    await store.approve('i1')

    expect(store.pendingApproval).toBeNull()
    expect(useUiStore().toasts.some((toast) => toast.kind === 'error')).toBe(true)
  })
})

describe('the transcript contract', () => {
  it('starts from an empty transcript and keeps the interrupt visible', async () => {
    const store = await openCard()

    expect(store.transcript.interrupts).toHaveLength(1)
    expect(store.interrupts).toHaveLength(1)
    expect(emptyTranscript().items).toEqual([])
  })
})
