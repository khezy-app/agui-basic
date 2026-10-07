# FE-09 — AG-UI event reducer and transcript store

| | |
|---|---|
| Status | Done (2026-10-08) |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §6.7, §6.8 |
| Satisfies | FR-AI-08, FR-AI-22, FR-AI-23, FR-AI-24, FR-AI-25, FR-AI-26, FR-AI-27, NFR-7, FR-AI-04 |
| Depends on | FE-08 |
| Blocks | FE-10, FE-11, FE-12, FE-13 |
| Parallel-safe | No |

## 1. Objective

One **pure** function that folds the AG-UI event stream into a transcript, plus the store
that wires it to the subscriber. This is the highest-value testable unit in the AI layer
(NFR-7): no network, no model, no DOM.

## 2. Context you need before starting

Read FE-08's report (agent contract: `agent.messages`, `runAgent(params, subscriber)`,
`abortRun`) and the `@ag-ui/client` types in `node_modules/@ag-ui/client` (or the
reference clone at `/mnt/data/protocols/ag-ui/sdks/typescript`).

Event families you must handle (`EventType` in `@ag-ui/client`):

| Event | Handling |
|---|---|
| `RUN_STARTED`, `STEP_STARTED`, `STEP_FINISHED` | run/step markers; step events are recorded but not rendered as bubbles |
| `RUN_FINISHED` | outcome: `success` (+ `result`) / `interrupt` (+ `interrupts`) / `cancelled` |
| `RUN_ERROR` | error item in the transcript + store `lastError` |
| `TEXT_MESSAGE_START` / `_CONTENT` / `_END` | append streamed text to the assistant message |
| `REASONING_*` (`START`, `MESSAGE_START`, `MESSAGE_CONTENT`, `MESSAGE_END`, `END`) | a collapsible reasoning block attached to the assistant message |
| `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` / `TOOL_CALL_RESULT` | tool-call item with progressive args |
| `TOOL_CALL_CHUNK` | convenience aggregate (start+args+end in one event) — support it |
| `STATE_SNAPSHOT` / `STATE_DELTA` | **not** handled here — FE-10 owns state; the reducer may carry them for tests only |
| `MESSAGES_SNAPSHOT` | authoritative history replacement (opt-in in the backend, BE-07) |
| `ACTIVITY_*`, `SUBAGENT_*`, `RAW`, `CUSTOM`, `META` | ignore safely (no crash) |

## 3. Scope

### 3.1 In scope

- [ ] `src/agui/transcript.ts` — types
- [ ] `src/agui/reducer.ts` — `reduceEvent(state, event): TranscriptState`
- [ ] `src/stores/cowork.ts` — replace the FE-08 pass-through subscriber with the real
      one; keep history in sync with `agent.messages`
- [ ] Tests

### 3.2 Out of scope

- State snapshot/delta application (FE-10).
- Tool execution (FE-11) — the reducer only marks tool calls as `awaiting-result`.
- Interrupt UI (FE-12) — the reducer records interrupts; FE-12 acts on them.
- Rendering (FE-13).

## 4. Design

### 4.1 `src/agui/transcript.ts`

```ts
export type ToolCallState = 'streaming-args' | 'awaiting-result' | 'done' | 'error'

export type ToolCallItem = {
  id: string
  name: string
  parentMessageId: string | null
  argsText: string              // raw streamed JSON, may be partial/invalid
  args: unknown                 // parsed when valid, else undefined
  state: ToolCallState
  resultContent: string | null
  resultError: string | null
  resultMessageId: string | null // the tool message carrying TOOL_CALL_RESULT (FR-AI-22)
  metadata: Record<string, unknown> | null
  interruptId: string | null    // set by FE-12 when this call produced an interrupt
}

export type TranscriptItem =
  | { kind: 'user'; id: string; content: string; createdAt: number }
  | { kind: 'assistant'; id: string; content: string; reasoning: string
      toolCalls: ToolCallItem[]; createdAt: number; streaming: boolean }
  | { kind: 'tool-result'; id: string; toolCallId: string; content: string
      error: string | null; createdAt: number }
  | { kind: 'error'; id: string; message: string; code?: string; createdAt: number }
  | { kind: 'notice'; id: string; text: string; createdAt: number }  // stopped, queued, resumed

export type TranscriptState = {
  items: TranscriptItem[]
  runId: string | null
  threadId: string | null
  runOutcome: 'none' | 'success' | 'interrupt' | 'cancelled' | 'error'
  interrupts: Interrupt[]        // from @ag-ui/client
  lastToolCallIdsWithoutResult: string[]
}
export const emptyTranscript = (): TranscriptState => ({ … })
export const openAssistantItem = (s: TranscriptState): TranscriptItem | undefined
export const toolCallById = (s: TranscriptState, id: string): ToolCallItem | undefined
```

Design rules:
- **Items, not a message map.** A single assistant "turn" can interleave text, reasoning
  and several tool calls; one `assistant` item per `messageId` keeps rendering simple
  and matches how `TOOL_CALL_RESULT` arrives as a separate message id (FR-AI-22).
- Each item has a stable `id` so Vue keys are stable and new streaming content does not
  remount the node.
- Immutability: `reduceEvent` returns a **new** `TranscriptState` and never mutates its
  input (or nested items). This makes the reducer trivially testable and lets you
  `shallowEqual` in the store.

### 4.2 `src/agui/reducer.ts` — the fold

```ts
export function reduceEvent(state: TranscriptState, event: BaseEvent): TranscriptState
```

| Event | Effect |
|---|---|
| `RUN_STARTED` | set `runId`, `threadId`, `runOutcome: 'none'`, clear `interrupts`; push a `notice` only if this is a resumed run (state carried a prior `interrupt`) |
| `TEXT_MESSAGE_START` | open (or find) an `assistant` item with `id = event.messageId`, `streaming: true` |
| `TEXT_MESSAGE_CONTENT` | append `event.delta` to that assistant item's `content` |
| `TEXT_MESSAGE_END` | `streaming: false` on that item |
| `REASONING_*` | append `delta` to the **same** assistant item's `reasoning` (create the item if text has not started yet) |
| `TOOL_CALL_START` | ensure the assistant item exists, then push a `ToolCallItem` with `state: 'streaming-args'` |
| `TOOL_CALL_ARGS` | append `event.delta` to the matching call's `argsText` (match by `toolCallId`; if the id is missing, match the **last open** call — providers like Ollama sometimes omit ids; document this tolerance) |
| `TOOL_CALL_CHUNK` | `START` + `ARGS` + `END` in one step (same rules) |
| `TOOL_CALL_END` | try `JSON.parse(argsText)` → `args`; leave `args` undefined on failure; `state: 'awaiting-result'` |
| `TOOL_CALL_RESULT` | set the call's `resultContent` / `resultError` (`event.content`, `event.error`), `state: done|error`, record `resultMessageId = event.messageId`; if no call matches the id (e.g. after a reload), append a standalone `tool-result` item so nothing is lost |
| `MESSAGES_SNAPSHOT` | replace user/assistant items derived from `event.messages` (keep `notice`/`error` items); used only if BE-07 enabled it |
| `RUN_FINISHED` | set `runOutcome` from `event.outcome?.type ?? 'success'`; store `interrupts` when the outcome is `interrupt`; if `outcome.type === 'success'` also record `pendingToolCallIds` (client tools the agent asked for) |
| `RUN_ERROR` | push an `error` item with `event.message` (+ `event.code` if present); `runOutcome: 'error'` |
| anything else | return the state **unchanged** (same reference) — cheap and safe |

Invariants (assert them in tests):
- `reduceEvent` never mutates its input (deep-freeze the input in tests).
- An unknown or malformed event never throws and never changes the item count except by
  the documented appends.
- Streaming text accumulates in order; a second `TEXT_MESSAGE_START` with the same id
  continues the existing item rather than creating a second one.
- `args` stays `undefined` while `argsText` is incomplete (FR-AI-27) and `argsText` is
  always preserved so the UI can show raw JSON.

### 4.3 Store integration

Replace FE-08's pass-through subscriber:

```ts
const transcript = ref<TranscriptState>(emptyTranscript())

function subscriber(): AgentSubscriber {
  return {
    onEvent: ({ event }) => { transcript.value = reduceEvent(transcript.value, event) },
    onRunFinishedEvent: (p) => { … settle phase from p.outcome; record interrupts … },
    onRunErrorEvent: ({ event }) => { lastError.value = event.message },
    onRunFailed: ({ error }) => { lastError.value = error.message; phase.value = 'error' },
  }
}
```
Use the **generic `onEvent`** hook — it receives every event, so one reducer call covers
everything and there is no risk of missing a variant (FR-AI-08: a tool call is never
invisible).

History ownership (FR-AI-04):
- The user message is appended by the store (`send`) before `runAgent`.
- After each run, rebuild the outgoing history from the transcript:
  `agent.setMessages(transcriptToMessages(transcript.value))`, where
  `transcriptToMessages` maps user items → `UserMessage`, assistant items →
  `AssistantMessage` with `toolCalls` (name, id, parsed `args` — **omit** the call when
  `args` is undefined), `tool-result` items → `ToolMessage` with `toolCallId`,
  `error` items → dropped (never send an error to the model).
- Reasoning is **not** sent back (it is not part of the conversation contract here);
  document that decision.
- Persist the transcript in memory only; on reload the thread id is reused but the
  transcript starts empty (the backend is stateless, FR-AI-04). Say this out loud in the
  handoff and consider a "conversation history is not restored" notice on reload — decide
  and record.

Phase transitions: `starting` → `streaming` (first content/tool/state event) →
`success` (`outcome: 'success'`) / `awaiting_approval` (FE-12, `outcome: 'interrupt'`) /
`stopped` (`abortRun`) / `error`.

### 4.4 Selectors FE-13 needs (export them)

`lastAssistantText`, `hasOpenToolCalls` (any `awaiting-result`),
`toolCallsByName(name)`, `interrupts`, `isStreaming`, `visibleItems` (items after the
last `user` item collapsed into turns).

## 5. Implementation order

1. `src/agui/transcript.ts` types + `emptyTranscript` + selectors.
2. `src/agui/reducer.ts` message/reasoning events.
3. Tool-call events, incl. `TOOL_CALL_CHUNK` and the missing-id tolerance.
4. `RUN_*` / `MESSAGES_SNAPSHOT` / ignore-everything-else.
5. `transcriptToMessages`.
6. Store wiring in `src/stores/cowork.ts`.
7. Tests (the largest test file in the project — budget for it).

## 6. Tests

`src/__tests__/reducer.spec.ts` — table-driven, one `describe` per event family:

- text: start → 3 content events → end produces one assistant item with concatenated
  content and `streaming: false`; re-using a `messageId` continues the item.
- reasoning: 2 content events land in `reasoning`, not `content`; reasoning before any
  text creates the item.
- tool args: partial JSON (`'{"sta'`) leaves `args === undefined` and `argsText`
  preserved (FR-AI-27); `TOOL_CALL_END` with complete JSON parses it; malformed complete
  JSON keeps `argsText` and `args === undefined` without throwing.
- tool result: `TOOL_CALL_RESULT` fills `resultContent` and sets `state: 'done'`;
  `event.error` present sets `state: 'error'` and `resultError` (FR-AI-18);
  an orphan result id appends a `tool-result` item.
- two tool calls interleaved in one assistant turn keep separate `argsText` (by id) and
  the fallback matches the last open call when the id is missing.
- `TOOL_CALL_CHUNK` equals start+args+end.
- run lifecycle: `RUN_STARTED` resets outcome; `RUN_FINISHED` with
  `{type:'interrupt', interrupts:[…]}` sets `runOutcome: 'interrupt'` and keeps
  `interrupts`; with `outcome` omitted → `success` (legacy reading).
- `RUN_ERROR` appends an `error` item and sets the outcome.
- purity: `Object.freeze` the input deeply, run the whole fixture, expect no throw and no
  mutation.
- unknown event types (`ACTIVITY_SNAPSHOT`, `RAW`, `CUSTOM`, a bogus `type`) return the
  **same reference**.
- `MESSAGES_SNAPSHOT` replaces user/assistant items but keeps `notice`/`error` items.

`src/__tests__/transcript-to-messages.spec.ts`
- user → `role: 'user'`; assistant with a parsed tool call → `AssistantMessage.toolCalls`
  with `{ id, type: 'function', function: { name, arguments: JSON string } }`.
- an assistant item whose args never parsed produces a message **without** that tool call.
- `tool-result` → `ToolMessage` with matching `toolCallId`; `error` items dropped.
- reasoning never appears in the outgoing messages.

`src/__tests__/cowork-store.spec.ts` (extend FE-08's)
- feeding a scripted event sequence through the fake agent's subscriber produces the
  expected transcript and settles `phase` correctly for each outcome.
- after a run, `agent.setMessages` was called with the rebuilt history.
- `abortRun` mid-stream appends a "Stopped" notice and settles `phase: 'stopped'`.

## 7. Definition of done

- [ ] `src/agui/reducer.ts` has zero imports from Vue, Pinia, the DOM or the network.
- [ ] Every event variant in the table above has a test, including the ignore cases.
- [ ] History sent to the backend is rebuilt from the transcript (FR-AI-04) and contains
      no `null` fields (the client's egress guard rejects them — worth a test).
- [ ] lint / type-check / vitest pass; `HANDOFF.md` entry appended.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (item model, missing-id tolerance, reasoning not replayed, reload behaviour) …
**Contract changes** (exported selectors and `transcriptToMessages` for FE-10…FE-13) …
**Verification** lint / type-check / vitest → …
**Known gaps** …
