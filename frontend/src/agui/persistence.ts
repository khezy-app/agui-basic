import { isMutationIntent, type MutationIntent } from '@/agui/resume'
import type { CoworkState } from '@/agui/state'
import { coerceState } from '@/agui/state'

/**
 * Session-scoped persistence for the AI layer (FR-AI-20, OPEN-10).
 *
 * Only three things survive a reload: the thread id, the last state document, and a
 * mutation still waiting for approval — the card has to be re-offered rather than
 * silently dropped (AC-2.8). The transcript is deliberately **not** persisted: the
 * backend is stateless between runs (FR-AI-04), so a restored transcript would show a
 * conversation the agent has no memory of. Neither is the draft.
 *
 * Every access is wrapped: Safari private mode and quota errors must degrade to "no
 * persistence", never to a broken app.
 */

const STATE_KEY = 'agui.state'
const APPROVAL_KEY = 'agui.pendingApproval'
/** Owned by `src/agui/agent.ts`; listed here because "New conversation" clears it too. */
const THREAD_KEY = 'agui.threadId'

/** Collapses a burst of state changes into one write. */
export const PERSIST_DEBOUNCE_MS = 300

/**
 * The on-disk shape of the pending approval. Deliberately narrower than the store's
 * `PendingApproval` (FE-12): `error`, `restored` and the resolved `tasks` are per-session
 * state, so they are rebuilt on restore rather than carried across a reload.
 */
export type PersistedApproval = {
  interruptId: string
  toolCallId: string | null
  tool: MutationIntent | ''
  args: Record<string, unknown>
  summary: string
  reason: string
  messageId: string | null
  createdAt: number
  status: 'pending' | 'settled'
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Private mode or quota exceeded: persistence is best-effort by design.
  }
}

function remove(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Same as above.
  }
}

let pendingStateWrite: ReturnType<typeof setTimeout> | null = null

/** Writes the document now, cancelling any pending debounced write. */
export function savePersistedState(state: CoworkState): void {
  if (pendingStateWrite !== null) {
    clearTimeout(pendingStateWrite)
    pendingStateWrite = null
  }
  write(STATE_KEY, JSON.stringify(state))
}

/**
 * Queues a debounced write. A run emits a state snapshot plus a burst of deltas, and
 * each is synchronous; writing them all would be wasted work on the storage path.
 */
export function schedulePersistedState(state: CoworkState): void {
  if (pendingStateWrite !== null) clearTimeout(pendingStateWrite)
  pendingStateWrite = setTimeout(() => {
    pendingStateWrite = null
    write(STATE_KEY, JSON.stringify(state))
  }, PERSIST_DEBOUNCE_MS)
}

/** Cancels a pending debounced write without writing — used when the document is reset. */
export function cancelPersistedState(): void {
  if (pendingStateWrite === null) return
  clearTimeout(pendingStateWrite)
  pendingStateWrite = null
}

/** The last document we held, repaired on read; `null` when nothing was stored. */
export function loadPersistedState(): CoworkState | null {
  const raw = read(STATE_KEY)
  if (raw === null) return null
  try {
    return coerceState(JSON.parse(raw))
  } catch {
    remove(STATE_KEY)
    return null
  }
}

export function savePendingApproval(approval: PersistedApproval): void {
  write(APPROVAL_KEY, JSON.stringify(approval))
}

/** The approval still waiting for an answer, or `null` when there is none (or it is settled). */
export function loadPendingApproval(): PersistedApproval | null {
  const raw = read(APPROVAL_KEY)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedApproval>
    if (typeof parsed?.interruptId !== 'string' || parsed.interruptId === '') return null
    return {
      interruptId: parsed.interruptId,
      toolCallId: typeof parsed.toolCallId === 'string' ? parsed.toolCallId : null,
      tool: isMutationIntent(parsed.tool) ? parsed.tool : '',
      args: typeof parsed.args === 'object' && parsed.args !== null ? parsed.args : {},
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      messageId: typeof parsed.messageId === 'string' ? parsed.messageId : null,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
      // An in-flight `approving`/`rejecting` cannot survive a reload — nothing is in
      // flight in a fresh session, so it comes back as a fresh `pending`.
      status: parsed.status === 'settled' ? 'settled' : 'pending',
    }
  } catch {
    remove(APPROVAL_KEY)
    return null
  }
}

export function clearPendingApproval(): void {
  remove(APPROVAL_KEY)
}

/** "New conversation": drop the thread, its document and any pending approval. */
export function clearPersisted(): void {
  cancelPersistedState()
  remove(STATE_KEY)
  remove(APPROVAL_KEY)
  remove(THREAD_KEY)
}
