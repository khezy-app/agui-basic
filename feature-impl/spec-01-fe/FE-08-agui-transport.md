# FE-08 — AG-UI transport: proxy, `@ag-ui/client`, run plumbing, feature flag

| | |
|---|---|
| Status | Done (2026-10-08) |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §6.1 |
| Satisfies | FR-AI-01, FR-AI-03, FR-AI-04, NFR-4, NFR-9 |
| Depends on | FE-02 (config) |
| Blocks | FE-09 … FE-13 |
| Parallel-safe | Yes — after FE-02, and independent of FE-03…FE-07 |

## 1. Objective

Make `POST /agent` reachable from the dev server, install `@ag-ui/client`, own the
`HttpAgent` singleton (thread id, history ownership, abort), and expose a store-shaped
API for sending a message with the current state, history and client tools — behind a
feature flag that leaves the CRUD app untouched when off.

## 2. Context you need before starting

### 2.1 Backend contract

From `../spec-01-be/00-index.md` and BE-06's handoff entry:
- `POST /agent`, `Content-Type: application/json`, response `text/event-stream`.
- `AG-UI` disabled ⇒ no agent registered ⇒ a non-2xx response (exact status recorded in
  BE-07's handoff — read it; FE renders it as an error card).
- SSE must survive a 5-minute run; the dev proxy must not buffer.

### 2.2 `@ag-ui/client` 1.0.2 API facts (verify against `node_modules` after install)

```ts
import { HttpAgent, buildResumeArray, getRunOutcome } from '@ag-ui/client'
const agent = new HttpAgent({ url: '/agent', headers: { Accept: 'text/event-stream' } })
agent.threadId            // string, generated once per agent instance
agent.state               // current shared state (any)
agent.messages            // conversation history (Message[])
agent.setState(s) / agent.setMessages(m)
await agent.runAgent({ runId?, tools?, context?, forwardedProps?, resume? }, subscriber?)
agent.abortRun()
agent.isRunning
```
- `state` and `messages` are **not** `runAgent` parameters — they live on the agent and
  are assembled into the request. History ownership (FR-AI-04) therefore means keeping
  `agent.messages` in sync with the transcript.
- The subscriber receives per-event callbacks (`onTextMessageContentEvent`,
  `onToolCallStartEvent`, `onStateSnapshotEvent`, `onStateDeltaEvent`,
  `onRunFinishedEvent` with a discriminated `outcome`, `onRunErrorEvent`, …) and may
  return an `AgentStateMutation` (`{ messages?, state?, stopPropagation? }`).
- `onRunFinishedEvent` gives `{ outcome: 'success', result?, pendingToolCallIds }` /
  `{ outcome: 'interrupt', interrupts }` / `{ outcome: 'cancelled' }`.
- `buildResumeArray(interrupts, responses)` builds the `resume` array and **throws** if
  a response is missing or unknown — FE-12 relies on that.

## 3. Scope

### 3.1 In scope

- [ ] `package.json`: add `@ag-ui/client@1.0.2`; add the env vars to `.env.example`
- [ ] `vite.config.ts`: dev proxy for `/api` and `/agent`
- [ ] `src/agui/agent.ts` — agent singleton factory
- [ ] `src/stores/cowork.ts` — **skeleton only**: run status, send/stop, thread id,
      feature flag. Transcript/state/tool wiring is FE-09…FE-12
- [ ] `src/__tests__/cowork-store.spec.ts`, `src/__tests__/agui-transport.spec.ts`

### 3.2 Out of scope

- The event reducer (FE-09) — the store may install a pass-through subscriber here and be
  replaced next task.
- Shared state assembly (FE-10), tools (FE-11), interrupts (FE-12), UI (FE-13).
- Any backend change.

## 4. Design

### 4.1 Dependency

```sh
npm install @ag-ui/client@1.0.2
```
No lockfile is committed (project `AGENTS.md`) — `npm install`, never `npm ci`. If
`@ag-ui/core` arrives as a transitive dependency, do **not** import from it directly;
import everything from `@ag-ui/client` (it re-exports core).

### 4.2 Vite proxy (NFR-9, dev environment)

```ts
server: {
  proxy: {
    '/api':    { target: 'http://localhost:8080', changeOrigin: false },
    '/agent':  { target: 'http://localhost:8080', changeOrigin: false,
                 // SSE must not be buffered or compressed
                 configure: (proxy) => proxy.on('proxyRes', (res) => {
                   res.headers['x-accel-buffering'] = 'no'
                 }) },
  },
}
```
Notes:
- `changeOrigin: false` keeps the `Origin: localhost:5173` header so BE-06's CORS config
  is exercised as documented.
- Do **not** set `ws: true` (no websockets) and do not add a `rewrite` — the backend
  serves `/api/**` and `/agent` at their literal paths.
- `vite.config.ts` already configures the Vue plugin and the vitest `test` block
  (jsdom, `e2e/**` excluded). Add the proxy to the existing object; do not restructure.
- `config.aguiUrl` / `config.apiBaseUrl` default to `/agent` and `/api` (FE-01), so the
  proxy is what makes them work — no code change needed in `src/api/*`.

### 4.3 `src/agui/agent.ts`

```ts
import { HttpAgent } from '@ag-ui/client'

const AGENT_KEY = 'agui.threadId'

export function getAgent(): HttpAgent {
  // module-level singleton; created lazily so a disabled flag never constructs it
}
export function resetAgent(): void            // for tests and "New conversation"
export function currentThreadId(): string | null
export function newThread(): string           // rotate the thread id, clear history
```

| Rule | Detail |
|---|---|
| Thread id | Persist the generated `agent.threadId` in `sessionStorage` under `AGENT_KEY`; reuse it on reload so history and pending interrupts survive (AC-2.8); `newThread()` generates a fresh one |
| Single instance | Module-level `let agent: HttpAgent | null`; `resetAgent()` nulls it. Vitest resets the module registry per test file |
| URL | `new HttpAgent({ url: config.aguiUrl, headers: { Accept: 'text/event-stream' } })`. No auth headers (non-goal) |
| Flag | If `config.aguiEnabled === false`, `getAgent()` throws `new Error('AG-UI disabled')` and the store short-circuits before constructing it (NFR-4) |
| State | `agent.setState(stateDoc)` is called by FE-10 before each run; `agent.messages` is the history (FE-09 keeps it in sync) |

### 4.4 `src/stores/cowork.ts` — skeleton

```ts
export type RunPhase = 'idle' | 'starting' | 'streaming' | 'awaiting_approval'
                      | 'interrupted' | 'error' | 'stopped'

export const useCoworkStore = defineStore('cowork', () => {
  const enabled = config.aguiEnabled
  const phase = ref<RunPhase>('idle')
  const lastError = ref<string | null>(null)
  const queuedMessage = ref<string | null>(null)
  const runStartedAt = ref<number | null>(null)
  const turnCount = ref(0)

  const isRunning = computed(() => phase.value === 'starting' || phase.value === 'streaming')
  const canSend = computed(() => enabled && !isRunning.value && !hasOpenInterrupt.value)

  async function send(text: string): Promise<void>
  function stop(): void
  async function retry(): Promise<void>
  function reset(): void
  return { … }
})
```

`send(text)` in this task:

1. `if (!enabled) return`
2. if `isRunning` → push to `queuedMessage` and **return** (FR-AI-25 — queued, never
   interleaved; FE-13 renders the queue hint). Do not fire a second request.
3. append a user `Message` to `agent.messages` (`{ id: crypto.randomUUID(), role: 'user',
   content: text }`); FE-09 replaces this with reducer-driven history.
4. `phase = 'starting'`; `await agent.runAgent({ tools: clientToolSchemas() }, subscriber)`
   where the subscriber is a **pass-through** for now (FE-09 supplies the real one) but
   already sets `phase = 'streaming'` on the first content event and handles
   `onRunErrorEvent` → `phase = 'error'`, `lastError = event.message`.
5. in `finally`: `phase` settles from the run outcome; if `queuedMessage` is set, send it
   (one hop only, to avoid recursion).
6. `stop()` → `agent.abortRun()` then `phase = 'stopped'` (FR-AI-24).
7. `retry()` → re-send the last user text **only if** it produced an error; otherwise
   clear the error. Never auto-retry a mutation-bearing turn without a fresh user action.

`hasOpenInterrupt` and the transcript refs are added by FE-09/FE-12 — declare the
placeholder `const hasOpenInterrupt = ref(false)` here so `canSend` compiles, and let
FE-12 replace it.

### 4.5 Env and docs

`.env.example` (create it; do **not** create `.env`):

```
VITE_API_BASE_URL=/api
VITE_AGUI_URL=/agent
VITE_AGUI_ENABLED=true
```
Add `VITE_*` to `src/vite-env.d.ts` as `string | undefined` and document in
`frontend/README.md` that the default values assume the dev proxy.

## 5. Implementation order

1. `npm install @ag-ui/client@1.0.2`.
2. `vite.config.ts` proxy.
3. `.env.example`, `vite-env.d.ts`, `config.ts` (already defaults correctly — verify).
4. `src/agui/agent.ts`.
5. `src/stores/cowork.ts` skeleton.
6. Tests.
7. Manual: `./gradlew bootRun` in `backend/`, `npm run dev`, send "hi", observe SSE in
   the network tab and `RUN_FINISHED` in the console.

## 6. Tests

`src/__tests__/agui-transport.spec.ts` (mock `@ag-ui/client`'s `HttpAgent`)
- `getAgent()` returns the same instance twice.
- the thread id is persisted to `sessionStorage` and reused by a fresh instance.
- `newThread()` rotates the id and clears `agent.messages`.
- `config.aguiEnabled === false` ⇒ `getAgent()` throws and no `HttpAgent` is constructed.
- the agent is constructed with `url: config.aguiUrl`.

`src/__tests__/cowork-store.spec.ts` (fake agent object with `runAgent`/`abortRun`/`messages`)
- `send` appends a user message and calls `runAgent` once with the client tool schemas.
- `send` while running queues the text and issues **no** second call (FR-AI-25); the
  queued message is sent after the run settles.
- a subscriber `onRunErrorEvent` sets `phase: 'error'` and `lastError`.
- `stop()` calls `abortRun()` and sets `phase: 'stopped'`.
- with the flag off, `send` is a no-op (no agent constructed) (NFR-4).

## 7. Definition of done

- [ ] `@ag-ui/client` in `package.json` at 1.0.2; `npm ci` not used anywhere.
- [ ] `POST /agent` streams through the dev proxy with no buffering and no CORS error.
- [ ] With `VITE_AGUI_ENABLED=false` the whole app works and no agent is constructed.
- [ ] lint / type-check / vitest pass; `HANDOFF.md` entry appended (FE-09 needs the exact
      agent/messages/state contract).

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (proxy shape, thread persistence, queue behaviour) …
**Verification** lint / type-check / vitest → …; manual SSE check …
**Known gaps** …
