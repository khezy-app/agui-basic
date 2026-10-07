import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PERSIST_DEBOUNCE_MS,
  cancelPersistedState,
  clearPendingApproval,
  clearPersisted,
  loadPendingApproval,
  loadPersistedState,
  savePendingApproval,
  savePersistedState,
  schedulePersistedState,
} from '@/agui/persistence'
import type { PersistedApproval } from '@/agui/persistence'
import { emptyState } from '@/agui/state'

const STATE_KEY = 'agui.state'
const APPROVAL_KEY = 'agui.pendingApproval'
const THREAD_KEY = 'agui.threadId'

function withState(phase: 'idle' | 'thinking' | 'done' = 'idle') {
  return { ...emptyState(), assistant: { phase, pendingAction: null } }
}

const APPROVAL: PersistedApproval = {
  interruptId: 'i1',
  toolCallId: 'c1',
  tool: 'update_task_status',
  args: { taskIds: ['a', 'b'], status: 'DONE' },
  summary: 'Mark 2 tasks DONE',
  reason: 'approval_required',
  messageId: 'c1',
  createdAt: 1_700_000_000_000,
  status: 'pending',
}

describe('state persistence', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cancelPersistedState()
    vi.useRealTimers()
  })

  it('writes and reads the document', () => {
    savePersistedState(withState('thinking'))

    expect(loadPersistedState()?.assistant.phase).toBe('thinking')
  })

  it('debounces a burst of writes into one', () => {
    vi.useFakeTimers()

    schedulePersistedState(withState('thinking'))
    schedulePersistedState(withState('done'))
    expect(sessionStorage.getItem(STATE_KEY)).toBeNull()

    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)

    expect(sessionStorage.getItem(STATE_KEY)).not.toBeNull()
    expect(loadPersistedState()?.assistant.phase).toBe('done')
  })

  it('cancels a pending debounced write', () => {
    vi.useFakeTimers()
    savePersistedState(withState('thinking'))

    schedulePersistedState(withState('done'))
    cancelPersistedState()
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)

    expect(loadPersistedState()?.assistant.phase).toBe('thinking')
  })

  it('returns null when nothing was stored', () => {
    expect(loadPersistedState()).toBeNull()
  })

  it('repairs a stored document written by an older version', () => {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ assistant: { phase: 'bogus' }, legacy: 1 }))

    const restored = loadPersistedState()

    expect(restored?.assistant.phase).toBe('idle')
    expect(restored?.legacy).toBe(1)
  })

  it('discards a stored document that is not JSON at all', () => {
    sessionStorage.setItem(STATE_KEY, 'not json')

    expect(loadPersistedState()).toBeNull()
    expect(sessionStorage.getItem(STATE_KEY)).toBeNull()
  })
})

describe('pending approval persistence (FR-AI-20)', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cancelPersistedState()
  })

  it('survives a simulated reload', () => {
    savePendingApproval(APPROVAL)

    // A reload is a fresh read of sessionStorage with no in-memory state carried over.
    const restored = loadPendingApproval()

    expect(restored).toEqual(APPROVAL)
    expect(restored?.status).toBe('pending')
  })

  it('drops a record whose tool is not one of the four mutation intents', () => {
    sessionStorage.setItem(APPROVAL_KEY, JSON.stringify({ ...APPROVAL, tool: 'drop_everything' }))

    expect(loadPendingApproval()).toMatchObject({ interruptId: 'i1', tool: '' })
  })

  it('rejects a record with no interrupt id and repairs the rest', () => {
    sessionStorage.setItem(APPROVAL_KEY, JSON.stringify({ tool: 'x' }))
    expect(loadPendingApproval()).toBeNull()

    sessionStorage.setItem(
      APPROVAL_KEY,
      JSON.stringify({ interruptId: 'i1', status: 'weird', args: 5 }),
    )
    expect(loadPendingApproval()).toMatchObject({ interruptId: 'i1', status: 'pending', args: {} })
  })

  it('brings an in-flight approval back as pending, because nothing is in flight after a reload', () => {
    sessionStorage.setItem(APPROVAL_KEY, JSON.stringify({ ...APPROVAL, status: 'approving' }))

    expect(loadPendingApproval()?.status).toBe('pending')
  })

  it('clears one approval without touching the document', () => {
    savePersistedState(withState('thinking'))
    savePendingApproval(APPROVAL)

    clearPendingApproval()

    expect(loadPendingApproval()).toBeNull()
    expect(loadPersistedState()).not.toBeNull()
  })
})

describe('clearPersisted', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cancelPersistedState()
  })

  it('empties all three keys', () => {
    sessionStorage.setItem(THREAD_KEY, 'thread-1')
    savePersistedState(withState('thinking'))
    savePendingApproval(APPROVAL)

    clearPersisted()

    expect(sessionStorage.getItem(THREAD_KEY)).toBeNull()
    expect(sessionStorage.getItem(STATE_KEY)).toBeNull()
    expect(sessionStorage.getItem(APPROVAL_KEY)).toBeNull()
    expect(loadPersistedState()).toBeNull()
    expect(loadPendingApproval()).toBeNull()
  })
})

describe('storage failures are swallowed', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    cancelPersistedState()
  })

  it('survives sessionStorage throwing on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    expect(() => savePersistedState(withState('thinking'))).not.toThrow()
    expect(() => schedulePersistedState(withState('thinking'))).not.toThrow()
    expect(() => savePendingApproval(APPROVAL)).not.toThrow()
  })

  it('survives sessionStorage throwing on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('access denied', 'SecurityError')
    })

    expect(loadPersistedState()).toBeNull()
    expect(loadPendingApproval()).toBeNull()
  })

  it('survives sessionStorage throwing on remove', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('access denied', 'SecurityError')
    })

    expect(() => clearPersisted()).not.toThrow()
  })
})
