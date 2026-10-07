import { HttpAgent } from '@ag-ui/client'

import { config } from '@/config'

/** sessionStorage key holding the AG-UI thread id (survives a reload, FR-AI-20). */
const AGENT_KEY = 'agui.threadId'

let agent: HttpAgent | null = null

function readStoredThreadId(): string | null {
  try {
    return sessionStorage.getItem(AGENT_KEY)
  } catch {
    return null
  }
}

function writeStoredThreadId(threadId: string): void {
  try {
    sessionStorage.setItem(AGENT_KEY, threadId)
  } catch {
    // Storage can be unavailable (private mode, quota); a fresh id is still valid.
  }
}

/**
 * The single `HttpAgent` for this tab. Created lazily so a disabled feature flag
 * never constructs one (NFR-4).
 */
export function getAgent(): HttpAgent {
  if (!config.aguiEnabled) {
    throw new Error('AG-UI disabled')
  }
  if (!agent) {
    agent = new HttpAgent({
      url: config.aguiUrl,
      headers: { Accept: 'text/event-stream' },
      threadId: readStoredThreadId() ?? undefined,
    })
    writeStoredThreadId(agent.threadId)
  }
  return agent
}

/** Drop the cached instance; the persisted thread id is reused by the next `getAgent()`. */
export function resetAgent(): void {
  agent = null
}

/** The live agent's thread id, or the persisted one when no agent is loaded yet. */
export function currentThreadId(): string | null {
  return agent ? agent.threadId : readStoredThreadId()
}

/** Rotate the thread id and clear the live history — used by "New conversation". */
export function newThread(): string {
  const threadId = crypto.randomUUID()
  if (agent) {
    agent.threadId = threadId
    agent.setMessages([])
  }
  writeStoredThreadId(threadId)
  return threadId
}
