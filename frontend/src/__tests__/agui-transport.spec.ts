import { beforeEach, describe, expect, it, vi } from 'vitest'

import { currentThreadId, getAgent, newThread, resetAgent } from '@/agui/agent'

const { settings, HttpAgentMock } = vi.hoisted(() => {
  class HttpAgentMock {
    static instances: HttpAgentMock[] = []

    url: string
    headers: Record<string, string>
    threadId: string
    messages: unknown[] = []
    state: unknown = {}
    isRunning = false
    abortRun = vi.fn<() => void>()
    setState = vi.fn<(state: unknown) => void>()
    setMessages = vi.fn<(messages: unknown[]) => void>((messages) => {
      this.messages = messages
    })
    runAgent = vi.fn<(params?: unknown, subscriber?: unknown) => Promise<unknown>>()

    constructor(config: { url: string; headers?: Record<string, string>; threadId?: string }) {
      this.url = config.url
      this.headers = config.headers ?? {}
      this.threadId = config.threadId ?? crypto.randomUUID()
      HttpAgentMock.instances.push(this)
    }
  }

  return {
    settings: { aguiEnabled: true, aguiUrl: '/agent' },
    HttpAgentMock,
  }
})

vi.mock('@ag-ui/client', () => ({ HttpAgent: HttpAgentMock }))
vi.mock('@/config', () => ({ config: settings }))

describe('agui/agent', () => {
  beforeEach(() => {
    resetAgent()
    sessionStorage.clear()
    HttpAgentMock.instances.length = 0
    settings.aguiEnabled = true
    settings.aguiUrl = '/agent'
  })

  it('returns the same instance on every call', () => {
    expect(getAgent()).toBe(getAgent())
    expect(HttpAgentMock.instances).toHaveLength(1)
  })

  it('constructs the agent with the configured url and SSE accept header', () => {
    const agent = getAgent()

    expect(agent.url).toBe('/agent')
    expect(agent.headers).toEqual({ Accept: 'text/event-stream' })
  })

  it('persists the generated thread id and reuses it in a fresh instance', () => {
    const first = getAgent()
    expect(sessionStorage.getItem('agui.threadId')).toBe(first.threadId)

    resetAgent()
    const second = getAgent()

    expect(second.threadId).toBe(first.threadId)
    expect(HttpAgentMock.instances).toHaveLength(2)
  })

  it('reuses a stored thread id when constructing the first instance', () => {
    sessionStorage.setItem('agui.threadId', 'stored-thread')
    const agent = getAgent()

    expect(agent.threadId).toBe('stored-thread')
    expect(currentThreadId()).toBe('stored-thread')
  })

  it('newThread rotates the thread id and clears the live history', () => {
    const agent = getAgent()
    const before = agent.threadId
    agent.messages.push({ id: 'm1', role: 'user', content: 'x' })

    const rotated = newThread()

    expect(rotated).not.toBe(before)
    expect(agent.threadId).toBe(rotated)
    expect(agent.messages).toEqual([])
    expect(sessionStorage.getItem('agui.threadId')).toBe(rotated)
  })

  it('throws and constructs nothing when the feature flag is off', () => {
    settings.aguiEnabled = false

    expect(() => getAgent()).toThrow('AG-UI disabled')
    expect(HttpAgentMock.instances).toHaveLength(0)
  })
})
