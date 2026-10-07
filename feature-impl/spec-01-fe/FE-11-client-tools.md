# FE-11 — Client tool declarations and handlers

| | |
|---|---|
| Status | Done (2026-10-08) |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §6.2 |
| Satisfies | FR-AI-05, FR-AI-06, FR-AI-07, FR-AI-08, FR-AI-12 (frontend half) |
| Depends on | FE-06 (`applyAiDraft`), FE-09 (tool-call tracking), FE-10 (draft in state) |
| Blocks | FE-12, FE-13 |
| Parallel-safe | No |

## 1. Objective

Declare the four client tools in one place and implement their handlers: prefilling the
form without submitting (AC-2.1), preparing a status change for human confirmation
(§6.6), opening a task, and asking the user a clarifying question (AC-2.6). Every handler
returns a `ToolMessage`-shaped result with a stable string contract or an explicit error.

## 2. Context you need before starting

Read spec §6.2 (argument schemas are part of the contract), FE-06 (`useTaskDraft`,
`applyAiDraft`), FE-09 (`transcript`, `ToolCallItem.state`, handler dispatch point),
FE-10 (`buildState`, `agent.setState`).

The client tool contract with the backend prompt (BE-07 §4.3): the model is told these
are executed by the app; the frontend advertises them in
`agent.runAgent({ tools })` and receives `TOOL_CALL_*` events for them.

Tool dispatch mechanics (state them precisely, they are easy to get wrong):
- The reducer (FE-09) records `TOOL_CALL_START/ARGS/END` and leaves the call in
  `awaiting-result`. Dispatch happens when the **agent signals the run is over**:
  `onRunFinishedEvent` reports `pendingToolCallIds` (every started call that never got a
  `TOOL_CALL_RESULT`) — that is the trigger to execute client tools.
- Client tool calls **must not** be executed mid-stream, because the run's outcome
  determines what to do with them (an `interrupt` outcome means the run is paused for
  approval, and the same turn must not also apply a draft — decide and document; the
  recommendation is: execute pending client tools **after** the run finishes with
  `outcome: 'success'` only, and ignore them on `interrupt`/`cancelled` outcomes).

## 3. Scope

### 3.1 In scope

- [ ] `src/agui/tools.ts` — the four `Tool` declarations (single source of truth)
- [ ] `src/agui/handlers.ts` — the handler registry
- [ ] Dispatch wiring in `src/stores/cowork.ts` (on run finish, iterate pending calls)
- [ ] Tests

### 3.2 Out of scope

- The approval/interrupt flow (FE-12) — `update_task_status`'s handler here only *opens*
  the confirmation; FE-12 owns the mutation and the resume.
- Rendering (FE-13).
- Backend tools (BE-08).

## 4. Design

### 4.1 `src/agui/tools.ts` (FR-AI-05 — declare once, nowhere else)

```ts
import type { Tool } from '@ag-ui/client'
export const clientTools: Tool[] = [prefillTaskFormTool, updateTaskStatusTool, openTaskTool, askUserTool]
```

| Tool | `parameters` (JSON Schema) | Description (model-facing; keep it literal, the model is small) |
|---|---|---|
| `prefill_task_form` | `{ title?, description?, status?, priority?, assigneeName?, dueDate?, estimateHours?, tags?, taskId? }` — `status`/`priority` enums inline; `dueDate` described as `yyyy-MM-dd` | "Fill the task form for the user to review. Does NOT save anything — the user must press Save. Call this when the user describes a task they want to create or change. Omit any field you could not determine." |
| `update_task_status` | `{ taskId?, taskIds?, status, reopen? }` with `status` enum; `taskId`/`taskIds` described as "one of them is required" | "Ask the user to confirm a status change for one or more tasks. The user sees a confirmation card; this does NOT change anything by itself. Use taskIds for several tasks at once." |
| `open_task` | `{ taskId }` | "Open a task in the user's task list. Use after identifying the right task, e.g. to show it." |
| `ask_user` | `{ question, options?: string[], allowFreeText?: boolean }` | "Ask the user a clarifying question when the request is ambiguous (which task, which person, which date). Waits for their answer." |

Schema rules:
- Every property has a `description`; the enums are spelled out in the description string
  as well as in `enum` (small-model robustness, same trick as BE-08).
- `required` only where the model cannot proceed: `status` for `update_task_status`,
  `taskId` for `open_task`, `question` for `ask_user`, nothing for `prefill_task_form`
  except `title` when no `taskId` is given — express that as: no `required`, and describe
  it ("at least `title` or `taskId`").
- Nothing backend-only is mirrored here (FR-AI-05): no `query_tasks`, no
  `propose_task_mutation`.
- Add a unit test asserting the declared tool names are exactly these four.

### 4.2 `src/agui/handlers.ts`

```ts
export type ToolHandlerResult =
  | { ok: true; content: string }                 // becomes ToolMessage.content
  | { ok: false; content: string; error: string } // ToolMessage.error (FR-AI-07)

export type ToolHandler = (args: unknown, call: { id: string; messageId: string | null })
                                         => Promise<ToolHandlerResult>

export const handlers: Record<string, ToolHandler> =
  { prefill_task_form, update_task_status, open_task, ask_user }
```

Handlers:

**`prefill_task_form(args)`**
1. Validate: `args` is an object; at least `title` (≤160 chars after trim) or `taskId`.
   Otherwise → `{ ok: false, error: 'prefill_task_form needs a title (max 160 chars) or a taskId' }`.
2. Resolve `assigneeName` → id through `useTeamStore().byName` (mirrors the backend's
   resolution). **No match ⇒ omit the field and add it to `missing`** — never `null`
   (FR-AI-12 / spec §6.2). Also validate `status`/`priority` against the enums and
   `dueDate` against `yyyy-MM-dd`; invalid values are omitted + reported in `missing`,
   not coerced.
3. Build the patch and call `useTaskDraft().applyAiDraft({ taskId, fields, missing })`
   (FE-06). The draft is **also** written into the shared state document
   (`draft.*`, spec §5.1) so it survives into the next turn.
4. Navigation (OPEN-11): if `taskId` is present → patch the form in place; if the user is
   not on a form route, navigate to `/tasks/:id/edit` (guarding the dirty-form prompt);
   if it is a create draft → navigate to `/tasks/new`.
5. Content contract (stable strings the model can rely on):
   `prefilled title="Fix login redirect", priority=HIGH, dueDate=2026-01-09, tags=[bug,auth]; missing=[assignee]`.
   List the supplied fields and the missing ones, nothing else.

**`update_task_status(args)`** — the §6.6 frontend path
1. Validate: exactly one of `taskId` / `taskIds`, `status` valid, `taskIds.length` ≤ 100.
2. Resolve the tasks: from the store's loaded page first; otherwise `taskApi.get` each id
   (bounded, ≤ 100). Any id that cannot be fetched → include it in the content as
   `not_found` and continue with the rest; **do not** fail the whole call.
3. Compute, per task, whether the transition is legal using `allowedTargets` (FE-02,
   OPEN-1 mirror). Build a plan:
   `{ taskId, title, from, to, allowed: boolean, reason?: string }[]`.
4. Open the confirmation card via a store/API this task defines:
   `useCoworkStore().proposeStatusChange(plan, { status, reopen })` — the card UI is
   FE-13, FE-12 completes the mutation. Until FE-12 lands, the store records the pending
   plan so the flow is testable.
5. Content: `3 proposed: 2 allowed, 1 blocked (TASK-123 already DONE); awaiting user confirmation`.
   Note: this handler **awaits** the user's decision — resolve its promise when the
   approval card settles (FE-12 supplies the resolver), then return
   `{ ok: true, content: 'approved: 2 updated, 1 unchanged' }` or
   `{ ok: false, content: 'rejected by user', error: 'user rejected the status change' }`.
   Cancelling the card resolves with `{ ok: false, error: 'user dismissed the confirmation' }`
   (FR-AI-07: cancellation is a failure, never a silent success).

**`open_task(args)`**
- `await taskApi.get(taskId)`; on success `router.push('/tasks/{id}')` and return
  `ok: { content: 'opened {id}' }`; on 404 return `{ ok: false, error: 'not_found' }`;
  never navigate to a non-existent task.

**`ask_user(args)`**
- `question` non-empty; `options` optional array of ≤ 6 strings (each ≤ 120 chars).
- Store the question as a pending question card and return a promise resolved by FE-13's
  card. Content on answer: `answer: <text>` (or `answer: <option>`). Timeout: after
  10 minutes resolve with `{ ok: false, error: 'no answer within 10 minutes' }` (clears
  the card). This is the FR-AI-29 clarification path (AC-2.6).

### 4.3 Dispatch wiring

In `src/stores/cowork.ts`, on `onRunFinishedEvent` with `outcome === 'success'`:
1. Read `pendingToolCallIds` from the event params.
2. For each, in order: look up the `ToolCallItem`, skip unknown names with an
   `error` result (a tool the model invented — never crash, FR-AI-08), else await the
   handler.
3. Convert the result into a `ToolMessage` and append it to `agent.messages`:
   ```ts
   { id: crypto.randomUUID(), role: 'tool', content: r.content,
     toolCallId: call.id, ...(r.ok ? {} : { error: r.error }) }
   ```
   **Never send `error: null`** — the client's egress guard rejects null fields.
4. Update the transcript item (`state: 'done' | 'error'`, `resultContent`,
   `resultError`, `resultMessageId`) so FE-13 renders the result (FR-AI-08, FR-AI-22).
5. If there were client tool calls, start the **next** run automatically so the model can
   react to the results — this is the tool loop for client tools. Guard: at most one
   follow-up run per tool batch, and never loop more than 3 times without a user message
   (a runaway-loop backstop; document it).
6. On `outcome === 'interrupt'` or `'cancelled'`: do **not** dispatch; FE-12 handles it.

Because the handler results are appended to `agent.messages`, the *next* run carries them
— this is what lets the model see "prefilled title=…" and continue coherently.

## 5. Implementation order

1. `src/agui/tools.ts` + schema test.
2. `handlers.ts` skeleton with validation helpers shared by all four handlers.
3. `prefill_task_form` + draft/state integration (FE-06, FE-10) + tests.
4. `open_task` + tests.
5. `update_task_status` plan builder (pure, testable) + store hook.
6. `ask_user` + timeout + tests.
7. Dispatch wiring in the store + follow-up-run loop.
8. Tests for the dispatch (success path, unknown tool, interrupt path, loop backstop).

## 6. Tests

`src/__tests__/tools.spec.ts`
- exactly four tools, names as specified; no backend tool name appears.
- every property has a `description`; the status enum matches `TASK_STATUSES` exactly.
- `update_task_status` requires `status`; `open_task` requires `taskId`.

`src/__tests__/handlers-prefill.spec.ts`
- valid args → `applyAiDraft` called with the resolved fields; **no** `taskApi` write
  called (assert zero POST/PATCH calls — the AC-2.1 regression guard).
- unknown `assigneeName` → field omitted and `missing` includes `assigneeId`.
- invalid `status`/`priority`/`dueDate` → omitted + listed in `missing`; no throw.
- missing `title` and `taskId` → `ok: false` with an explanatory `error`.
- content string matches the documented shape (snapshot it).
- create draft navigates to `/tasks/new`; edit draft patches in place without navigating
  when already on that route (OPEN-11).

`src/__tests__/handlers-status.spec.ts`
- plan builder: legal, illegal with the allowed-targets reason, already-at-target
  (reported as `unchanged`, not an error), `reopen` for `CANCELLED`.
- an id that 404s is reported as `not_found` and the rest still proceed.
- approve → `ok: true` with the counts; reject → `ok: false` with `error`; dismiss →
  `ok: false` with the dismissal error (FR-AI-07).

`src/__tests__/handlers-ask-open.spec.ts`
- `open_task` navigates on success, returns `not_found` on 404, and never navigates on
  failure.
- `ask_user` resolves with the chosen option; resolves with a free-text answer when
  `allowFreeText`; times out after 10 minutes (fake timers) with an error.

`src/__tests__/cowork-dispatch.spec.ts`
- pending client tool calls dispatch after a `success` outcome and a follow-up run starts
  with the tool `ToolMessage`s in `agent.messages`.
- an unknown tool name yields an error `ToolMessage` (no crash).
- an `interrupt` outcome dispatches nothing.
- the follow-up loop stops after 3 rounds without a user message.
- `error` is `null`-free in every produced `ToolMessage` (assert with a strict shape check).

## 7. Definition of done

- [ ] Four tools, one declaration site, schemas matching §4.1.
- [ ] `prefill_task_form` provably performs no network write.
- [ ] Every handler failure path returns `error` and never a silent success.
- [ ] lint / type-check / vitest pass; `HANDOFF.md` entry appended (FE-12 consumes the
      approval resolver and the question resolver contracts).

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (dispatch timing, follow-up loop cap, content string formats) …
**Contract changes** (resolver contracts FE-12 must satisfy) …
**Verification** lint / type-check / vitest → …
**Known gaps** …
