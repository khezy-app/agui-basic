# FE-12 — Approval flow: interrupts, resume, and the status-change confirmation

| | |
|---|---|
| Status | Done |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §6.5, §6.6 |
| Satisfies | FR-AI-11, FR-AI-14, FR-AI-15, FR-AI-16, FR-AI-17, FR-AI-18, FR-AI-19, FR-AI-20 |
| Depends on | FE-11 |
| Blocks | FE-13 |
| Parallel-safe | No |

## 1. Objective

Complete the human-in-the-loop loop on both paths:

1. **Backend-proposed mutation** (`propose_task_mutation` → interrupt → approval card →
   perform via REST → `resume`) — AC-2.5.
2. **Frontend status change** (`update_task_status` client tool → confirmation card →
   `POST /api/tasks/bulk-status` → tool result) — AC-2.4, FR-AI-19.

Nothing mutates without a human decision, and a reload mid-approval does not lose the
decision surface (AC-2.8).

## 2. Context you need before starting

Read spec §6.5/§6.6, `../spec-01-be/00-index.md` §3 **C6** and **OPEN-2**, BE-09's
handoff entry (the interrupt fields the backend actually emits), FE-04's
`BulkActionBar` (reuse the same intersection logic and visual language), FE-09
(`interrupts`, `outcome`), FE-10 (`persistence`, `assistant.pendingAction`,
`needsResync`), FE-11 (the `update_task_status` plan builder and the promise resolvers).

### 2.1 Protocol rules you must honour

| Rule | Consequence in the UI |
|---|---|
| Resume uses the **same `threadId`** | Use the singleton agent from FE-08 — never a new one |
| A resume array must answer **every** open interrupt | Use `buildResumeArray(interrupts, responses)` from `@ag-ui/client`; it throws if incomplete |
| While interrupts are open, any new run must carry the resume | Disable the composer (`canSend === false`) and show the approval card instead (FE-13) |
| Resumes are idempotent for the same `(threadId, interruptId, status, payload)` | Disable the Approve/Reject buttons while a resume run is in flight |
| Interrupt `expiresAt` | BE-09 omits it — so never fabricate an expiry; do not auto-expire |

### 2.2 Resume payloads (C6)

| Case | `status` | `payload` |
|---|---|---|
| Approve, mutation succeeded | `resolved` | `{ approved: true, result: <REST response> }` |
| Approve, mutation failed | `resolved` | `{ approved: true, error: "<backend detail>" }` |
| Reject | `resolved` | `{ approved: false, reason: "<user's words or a default>" }` |
| Dismiss | `cancelled` | *(omitted)* |

`result` is the REST response **verbatim** (`TaskResponse`, `BulkStatusResponse`, or
`{ deleted: "<id>" }`).

## 3. Scope

### 3.1 In scope

- [x] `src/agui/resume.ts` — payload builders + validation + the approval state machine
- [x] `src/stores/cowork.ts` — interrupt intake, approval/dismiss actions, resume run
- [x] The mutation executors: `executeMutation(tool, args)` mapping the four mutation
      intents onto the REST API (through the **task store**, so validation, error mapping
      and refetching are shared)
- [x] Tests

### 3.2 Out of scope

- The card markup (FE-13) — this task defines the state and the actions; FE-13 renders.
- The AI panel chrome (FE-13).

## 4. Design

### 4.1 `src/agui/resume.ts`

```ts
export type PendingApproval = {
  interruptId: string
  toolCallId: string | null
  messageId: string | null
  tool: 'create_task' | 'update_task_status' | 'update_task_fields' | 'delete_task'
  args: Record<string, unknown>
  summary: string
  reason: string
  createdAt: number
  status: 'pending' | 'approving' | 'rejecting' | 'settled'
}

export const buildApprovalPayload = (approved: boolean, extra?: { result?: unknown; error?: string; reason?: string })
  : { status: 'resolved'; payload: Record<string, unknown> }

export const validateResumePayload = (raw: unknown): { approved: boolean } | null
export function describeMutation(tool: string, args: Record<string, unknown>): {
  title: string; lines: { label: string; value: string }[]
}
```

- `validateResumePayload` implements the C6 `responseSchema` check **client-side**
  (the docs tell clients to validate before submitting): `approved` must be a boolean;
  `result`/`error`/`reason`, when present, must have the right primitive types.
- `describeMutation` renders `args` into human-readable lines for the card — the card
  must never dump raw JSON to the user. It also **resolves names**: if `args.assigneeName`
  is present, look it up in `useTeamStore` and display the display name (or "unknown
  person" when unresolvable).
- For `update_task_status` with `taskIds`, the card lists every task with
  current → target and per-task legality (reuse FE-11's plan builder and FE-04's
  intersection wording so the UI and AI flows are indistinguishable).

### 4.2 Approval state machine (in the store)

```
run finishes with outcome 'interrupt'
  → intake(interrupts[]): validate each against C6; store PendingApproval(s)
  → phase = 'awaiting_approval'; persist (FR-AI-20); canSend = false
  → FE-13 renders the ApprovalCard bound to pendingApproval

user clicks Approve
  → status = 'approving' (buttons disabled)
  → result = await executeMutation(tool, args)          // via the task store
  → payload = result.ok ? { approved: true, result } : { approved: true, error }
  → await runResume([{ interruptId, status: 'resolved', payload }])
  → status = 'settled'; refresh list/stats/detail; clear pending

user clicks Reject(reason)
  → payload = { approved: false, reason }
  → runResume(...); status = 'settled'          // no mutation was attempted — FR-AI-16

user clicks Dismiss
  → runResume([{ interruptId, status: 'cancelled' }]); status = 'settled'
```

Guarantees to encode in code:

| ID | Guarantee |
|---|---|
| FR-AI-15 | The card is the only approval UI; `useConfirm()` may wrap the Reject reason prompt but **no** `window.confirm` and no auto-approval |
| FR-AI-16 | Reject/Dismiss paths contain **no** call to `executeMutation` (unit-test this by spying on it) |
| FR-AI-17 | On approve, the UI refetches from the authoritative REST result (`fetchList` + `fetchStats` + `fetchDetail`) — no optimistic mutation (OPEN-9) |
| FR-AI-18 | A failed mutation is reported in the card *and* travels to the model as `payload.error`; the card stays open with a Retry/Reject choice |
| FR-AI-11 | There is no code path that resumes `approved: true` without a preceding click |
| FR-AI-14 | One resume entry per open interrupt, and at most one mutation is executed per approval — `executeMutation` rejects `args.taskIds.length > 100` and never fans out internally |

### 4.3 `executeMutation(tool, args)`

| `tool` | REST call (through the task store, not `taskApi` directly) |
|---|---|
| `create_task` | `store.saveTask('create', …)` from the mapped input — returns `{ ok, task | errors }` |
| `update_task_status` | single `taskId` → `store.changeStatus(id, status, reopen)`; `taskIds` → `store.bulkChangeStatus(ids, status, reopen)` |
| `update_task_fields` | `store.saveTask('edit', taskId, patch)` with `expectedVersion` |
| `delete_task` | `store.deleteTask(taskId, force)` |

Mapping rules before the call:
- `assigneeName` → `assigneeId` via `useTeamStore().byName`; **unresolvable ⇒ the mutation
  fails before any request** with `error: "unknown team member 'X'"` (FR-AI-12).
- `dueDate` must be `yyyy-MM-dd`, `estimateHours` a number, `tags` an array of strings —
  otherwise the call is rejected locally with a precise message (do not let the model send
  a malformed patch into a 422).
- `update_task_fields` must not contain `status`, `id`, `version`, `createdAt`,
  `updatedAt`, `isOverdue`, `isUnassigned` — strip server-owned keys and report the attempt
  in the card as "ignored non-editable field(s): status" (FR-B-19 spirit on the UI side).
- The result returned in the payload must be a **plain JSON object** (a Vue reactive proxy
  is not serialisable-safe): `toRaw`/`JSON.parse(JSON.stringify(...))` it, or better, have
  the store return the plain REST response. Add a test asserting the payload is
  JSON-serialisable.

### 4.4 Running the resume

```ts
async function runResume(responses: Record<string, ResumeResponse>) {
  const resume = buildResumeArray(openInterrupts.value, responses)   // throws if incomplete
  await getAgent().runAgent({ resume })
}
```
- The resume run reuses the same singleton agent (same `threadId`), keeps the current
  transcript, and does **not** append a synthetic user message — the resume entries are
  the input. (Record this decision; it affects what the model sees.)
- The reducer must tag the originating tool call with the `interruptId` so the transcript
  shows the approval result against the right call (FE-09's `ToolCallItem.interruptId`).
- While the resume run is in flight, further approval clicks and composer sends are
  disabled; a second interrupt arriving replaces the card with a queue of cards (render
  one at a time, in order).

### 4.5 Reload recovery (FR-AI-20, AC-2.8)

On store init, if `sessionStorage['agui.pendingApproval']` exists and its `status` is not
`settled`:
- restore it as the pending approval, `phase = 'awaiting_approval'`, `canSend = false`;
- re-offer the card with a note: "Restored from a previous session — approve or dismiss";
- on approve/reject, resume against the **same `threadId`** (FE-08 persists it).
- If the backend reports the resume as stale/invalid (a `RUN_ERROR`), clear the pending
  approval, toast the error, and offer "continue the conversation" instead of looping.

## 5. Implementation order

1. `src/agui/resume.ts` — payload builders, validation, `describeMutation`.
2. `executeMutation` mapping (pure part first: name resolution + key stripping).
3. Store: interrupt intake + persistence + `phase`/`canSend`.
4. `approve` / `reject` / `dismiss` actions + `runResume`.
5. Wire the resolvers FE-11 left open (status-change promise, question promise).
6. Reload recovery.
7. Tests.

## 6. Tests

`src/__tests__/resume.spec.ts`
- the three payload shapes match C6 exactly (snapshot them).
- `validateResumePayload` accepts `{approved:true, result:{…}}`, rejects
  `{approved:'yes'}`, `{}`, `null`.
- `describeMutation` renders friendly lines for all four tools, resolves `assigneeName`
  to a display name, and never emits a raw JSON blob.
- for `update_task_status` with `taskIds`, the description lists per-task legality and
  matches FE-04's intersection wording.

`src/__test__/mutation-execute.spec.ts` → `src/__tests__/mutation-execute.spec.ts`
- each of the four tools calls the documented store action with the mapped arguments.
- an unresolvable `assigneeName` fails **without** any store call.
- server-owned keys in `update_task_fields` are stripped and reported.
- `taskIds.length > 100` is refused (FR-AI-14).
- the returned payload is JSON-serialisable (no proxies).

`src/__tests__/cowork-approval.spec.ts`
- an `interrupt` outcome creates a `PendingApproval` from `interrupt.metadata`, sets
  `phase: 'awaiting_approval'`, disables `canSend`, and persists it.
- **Approve** runs the mutation, refetches list+stats+detail, and resumes with
  `{approved:true,result}`; assert the resume went out on the same `threadId`.
- **Reject** performs **no** mutation (spy count 0) and resumes with
  `{approved:false,reason}` (FR-AI-16, AC-2.5).
- **Dismiss** resumes with `status:'cancelled'` and no payload.
- a failing mutation yields `{approved:true,error}` and keeps the card open (FR-AI-18).
- `buildResumeArray` throws when only some interrupts are answered → caught and surfaced,
  not swallowed.
- double-clicking Approve issues one resume (buttons disabled in flight).
- reload recovery: a persisted pending approval is restored, `canSend` is false, and
  approving resumes on the persisted thread id (AC-2.8).
- a stale resume (`RUN_ERROR`) clears the pending approval and toasts.

`src/__test__/status-flow.spec.ts` → folded into `src/__tests__/handlers-status.spec.ts`
(FE-11): approving the client-tool status change calls `POST /api/tasks/bulk-status` from
the **frontend**, with no backend write tool involved (FR-AI-19), and the handler resolves
with `approved: 2 updated, 1 unchanged`.

## 7. Definition of done

- [x] No mutation executes without a human click — proven by spy-based tests for both
      paths.
- [x] Both resume payload families match C6 and are validated client-side.
- [x] Reload mid-approval restores the card (AC-2.8).
- [x] lint / type-check / vitest pass; `HANDOFF.md` entry appended (FE-13 needs the card
      state contract: `pendingApproval`, statuses, actions).

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (no synthetic user message on resume, queue vs single card,
argument pre-validation) …
**Contract changes** (the card-facing store API FE-13 must bind to) …
**Verification** lint / type-check / vitest → …
**Known gaps** …
