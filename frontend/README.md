# Frontend — Vue 3 + AG-UI Client

Vue 3 + Vite + TypeScript UI for the Task Management app, with an AI cowork panel
that talks to the backend over the **AG-UI** protocol.

## Libraries for AG-UI

| Library | Responsible for |
|---|---|
| `@ag-ui/client` (1.0.2) | The core SDK. Provides `HttpAgent` — a streaming SSE client that posts `RunAgentInput` to `POST /agent` and yields typed AG-UI events (`RUN_STARTED`, `STATE_SNAPSHOT`/`STATE_DELTA`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `RUN_FINISHED`, `RUN_ERROR`). Also owns `threadId`/`runId` lifecycle. |
| `fast-json-patch` | Applies the RFC 6902 `STATE_DELTA` patches the backend sends (the server emits the whole state diffed into a patch — you apply it client-side). |
| `vue` / `pinia` | You own the reactive state document: the SDK emits events, your store decides how they update UI state. |
| Your REST client (`src/api/*`) | Everything non-streaming — initial loads, mutations the user confirms, etc. AG-UI is additive on top. |

## Core concept: the SDK gives you events, you write the reducer

AG-UI does **not** ship a Vue store or a chat widget. The split of responsibilities:

**The SDK provides:**

- `HttpAgent` — connection + run lifecycle (`runAgent`), thread/run ids.
- Typed events as an async stream.
- Client-tool registration (`tools`) — functions the *model* can call that run in *your* browser.

**You implement:**

1. **State document** (`src/agui/state.ts`) — one plain object shared with the agent.
   Your store owns its lifetime; the SDK never touches it directly.
2. **Event reducer** (`src/agui/reducer.ts`) — fold events into that state:
   - `STATE_SNAPSHOT` → replace
   - `STATE_DELTA` → `applyPatch(state, patch)`
   - `TEXT_MESSAGE_*` → append to transcript (`src/agui/transcript.ts`)
   - `TOOL_CALL_*` → render pending tool calls, dispatch to client tool handlers
3. **Client tool handlers** (`src/agui/handlers.ts`) — run in the browser, e.g.
   prefill a form or ask the user to confirm a status change. **Never** let a tool
   call silently succeed on failure — the model reasons from your result string.
4. **Persistence** (`src/agui/persistence.ts`) — thread id in `sessionStorage`,
   so a reload resumes the same conversation.

## Scenario cheatsheet

### 1. Connect to the agent and start a run

```ts
import { getAgent } from '@/agui/agent'

const agent = getAgent()           // lazily creates HttpAgent(url, threadId)
agent.setMessages(transcriptToMessages(transcript.value))
agent.setState(document)           // hand the agent the fresh state document
await agent.runAgent({ tools: clientTools }, subscriber())

// subscriber() is AgentSubscriber: onEvent folds every event through your reducer,
// onStateSnapshotEvent/onStateDeltaEvent own the shared-state document.
```

### 2. Share UI state with the model

Define one document and hand it to the agent before every run — the backend echoes a
`STATE_SNAPSHOT` and the model receives it in its prompt:

```ts
const state = {
  view: 'task-list',
  visibleTaskIds: [...],
  draft: { task: null, taskId: null, source: 'user', missing: [] },
  assistantPhase: 'idle',
}
agent.setState(document)
await agent.runAgent({ tools: clientTools }, subscriber())
```

Later, the model updates it; the client hooks deliver snapshot/delta, you apply the
patch to your own copy (the store renders from yours, not `agent.state`):

```ts
import { applyPatch } from 'fast-json-patch'
onStateDeltaEvent: ({ event }) => {
  document = applyPatch(document, event.delta, true, false).newDocument
}
```

### 3. Client-defined tool (model calls your browser)

```ts
import type { Tool } from '@ag-ui/client'

const tools: Tool[] = [{
  name: 'prefill_task_form',
  description: 'Fill the task form draft without submitting',
  parameters: { /* JSON schema — describe every enum value in prose for small models */ },
}]

// Handlers dispatched after RUN_FINISHED by looking the call up in the transcript:
const handlers = {
  prefill_task_form: async (args) => {
    applyAiDraft({ taskId: args.taskId, fields: args.fields, missing: args.missing })
    return { ok: true, content: 'Draft applied' }   // always return a result string
  },
}
await agent.runAgent({ tools }, subscriber())
```

Rule: every failure path returns `{ ok: false, content, error }` — dismissal,
timeout, API error all count as failure, or the model continues from a false premise.

### 4. Backend interrupt tool (approval flow)

The backend declares e.g. `update_task_status` but never executes it. The run ends
with `RUN_FINISHED { outcome: { type: 'interrupt', toolCalls } }`. You:

1. Render a confirmation card for each pending tool call.
2. After the user decides, settle the interrupt and start the next run carrying the
   approval result in the transcript/messages — the backend completes the pending
   tool call from it:

```ts
transcript.value = settleInterrupt(transcript.value, interrupt.id, { approved: true })
syncHistory(agent)
await agent.runAgent({ tools: clientTools }, subscriber())
```

### 5. Replay history after reconnect

Backend sends `MESSAGES_SNAPSHOT` just before `RUN_FINISHED` — reconcile your local
transcript with it so durable history wins over in-memory text deltas.

### 6. Disable the AI layer

```ts
if (!config.aguiEnabled) return   // config reads VITE_AGUI_ENABLED
```

The app must behave exactly as a plain CRUD UI (no agent construction, no /agent calls).

## Commands

```sh
npm install
npm run dev          # vite dev server (uses the dev proxy for /api and /agent)
npm run lint         # oxlint --fix + eslint --fix (mutates files)
npm run format       # prettier --write over src/
npm run type-check   # vue-tsc --build
npx vitest run       # one-shot tests (npm run test:unit is watch mode)
npm run build        # type-check + vite build
```

Manual verification checklist: `scripts/verify-01.md`.

Env: copy `.env.example` to `.env` to override `VITE_API_BASE_URL`,
`VITE_AGUI_URL`, `VITE_AGUI_ENABLED`. In Docker they are build args instead.
