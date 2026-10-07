# FE-10 — Shared state document: schema, snapshot/delta, persistence, context

| | |
|---|---|
| Status | Done (2026-10-08) |
| Spec | `feature-spec/01-task-mngt-feature-spec.md` §5 |
| Satisfies | FR-S-01, FR-S-02, FR-S-03, FR-S-04, FR-S-05, FR-S-06, FR-AI-20 (storage half), FR-AI-30 |
| Depends on | FE-09 |
| Blocks | FE-11, FE-12 |
| Parallel-safe | No |

## 1. Objective

Own the single state document exchanged with the agent: build it from the app, send it on
every run, apply `STATE_SNAPSHOT` / `STATE_DELTA` per RFC 6902, preserve unknown keys,
reflect the agent's writes into the UI, and persist enough to survive a reload during an
approval (AC-2.8).

## 2. Context you need before starting

Read the spec §5.1/§5.2 verbatim (the schema is a contract with the backend prompt in
BE-07), FE-03's store (the exposed `query`, `selectedIds`, `tasks`, `activeTaskId`,
`view` names), FE-06's `useTaskDraft`, and FE-08/FE-09's agent + transcript contracts.

Backend behaviour you rely on (BE-07): with `shareState(true)` and
`StateUpdates.DELTA` the agent emits an initial `STATE_SNAPSHOT` echoing the input state
at run start, and intercepts the model's internal `update_state` call (the model supplies
the **whole** new state; the agent computes the JSON Patch). So:

- You will receive a snapshot on every run — treat it as authoritative **only** for
  `assistant.*`, otherwise merge (see §4.3).
- Deltas are computed against the *run input* state, so applying them to a document that
  has since changed locally can conflict. §4.4 handles this.

## 3. Scope

### 3.1 In scope

- [ ] `src/agui/state.ts` — types, `emptyState`, `applySnapshot`, `applyDelta`, merge helpers
- [ ] `src/agui/persistence.ts` — session persistence
- [ ] `src/stores/cowork.ts` — build-and-send before each run; apply on state events
- [ ] `src/utils/dates.ts` — `todayIso()` (needed for `context.today`)
- [ ] Tests

### 3.2 Out of scope

- Rendering the pending-approval card (FE-12) — this task only stores
  `assistant.pendingAction`.
- The draft application to the form (FE-06 owns `applyAiDraft`; this task **calls** it).
- The AI panel UI (FE-13).

## 4. Design

### 4.1 Types (`src/agui/state.ts`) — exactly spec §5.1

```ts
export type CoworkView = 'dashboard' | 'task-list' | 'task-detail' | 'task-form'

export type CoworkState = {
  context: {
    view: CoworkView
    today: string                    // yyyy-MM-dd from the client clock
    taskId: string | null
    filters: { status: TaskStatus[]; priority: TaskPriority[]
               assigneeId: string | null; q: string | null; overdue: boolean }
    selectedIds: string[]
    visibleTaskIds: string[]         // capped at 200 (FR-S-05)
  }
  draft: {
    task: Partial<TaskDraftFields> | null
    taskId: string | null
    source: 'ai' | 'user'
    missing: string[]
  } | null
  assistant: {
    phase: 'idle' | 'thinking' | 'awaiting_confirmation' | 'done' | 'error'
    pendingAction: {
      id: string; tool: string; summary: string
      args: Record<string, unknown>; origin: string | null
    } | null
  }
}
export type TaskDraftFields = { title?: string; description?: string | null
  status?: TaskStatus; priority?: TaskPriority; assigneeId?: string | null
  dueDate?: string | null; estimateHours?: number | null; tags?: string[] }

export const emptyState = (): CoworkState => ({ context: { … }, draft: null,
  assistant: { phase: 'idle', pendingAction: null } })
```

`JSON.parse`d agent state must be **validated** before use: unknown top-level keys are
kept (FR-S-06), but `context.view` must be one of `CoworkView`, arrays must be arrays,
etc. Provide `coerceState(raw: unknown): CoworkState` that repairs what it can and
preserves the rest — never throw on a malformed document (a bad document must not break
the app).

### 4.2 Building the outgoing document

```ts
export function buildState(tasks: TaskStore, draft: AiDraft | null,
                           assistant: AssistantSlice): CoworkState
```
- `context.view` = `tasks.view`
- `context.today` = `todayIso()` (`utils/dates.ts`: `new Date().toISOString().slice(0,10)`
  — document that this is the **client's** UTC day, which is what FR-AI-30 assumes; if a
  reviewer prefers local day, use the local formatter and note it)
- `context.taskId` = `tasks.activeTaskId`
- `context.filters` = the live filter state (not the URL — the store is authoritative)
- `context.selectedIds` = `tasks.selectedIds`
- `context.visibleTaskIds` = ids of the current page, **capped at 200**, most recent page
  first (FR-S-05)
- `draft` = `null` unless FE-06 has an active AI draft; when present, `source: 'ai'`,
  `taskId`, and `missing` from the draft (spec §5.1)
- `assistant.phase` / `assistant.pendingAction` from the store (the backend may own
  `phase`; the frontend keeps its own copy in sync)

Wire it in FE-09's `send`: **immediately before** `agent.runAgent(...)`,
`agent.setState(buildState(...))`. Never send a stale document.

### 4.3 Applying `STATE_SNAPSHOT` (FR-S-01, FR-S-06)

```ts
export function applySnapshot(current: CoworkState, raw: unknown): CoworkState
```
Rules:
1. `coerceState(raw)`.
2. **Ownership split (FR-S-01).** The frontend owns `context` and `draft`; the backend may
   only change `assistant`. Therefore: take `assistant` from the incoming document
   **unconditionally**; take `context` and `draft` from `current` **unless** the incoming
   document contains a `draft` that differs from the current one (i.e. the agent wrote the
   draft — that is the prefill channel, so accept it).
   → Implement as `mergeOwned(current, incoming)` and unit-test both directions.
3. `applySnapshot` returns a new object; unknown keys from `incoming` are merged in at the
   top level (FR-S-06) without deleting local ones.
4. If the incoming `assistant.pendingAction` is non-null, persist it (FR-AI-20).

Accepting an agent-written `draft` means calling FE-06's hook:
```ts
if (next.draft && !isEqual(next.draft, current.draft)) useTaskDraft().applyAiDraft({ … })
```
Guard with a diff so an echo of our own state does not re-apply (FR-S-04). If the agent's
draft is `null` while we have one, **keep ours** — the agent must not clear a draft the
user is editing (spec §5.2 FR-S-03 + §4.9 of the backend prompt).

### 4.4 Applying `STATE_DELTA` (FR-S-02)

RFC 6902 via `fast-json-patch` (the same library the AG-UI docs use):

```ts
import { applyPatch, type Operation } from 'fast-json-patch'
export function applyDelta(current: CoworkState, delta: Operation[]): CoworkState | null
```
- Apply **atomically to a deep clone** with `validateOperation: true`,
  `mutateDocument: false`; on any error return `null` (do not throw, do not partially
  apply) — the caller then triggers a re-sync.
- **Rebase, then re-apply ownership.** The delta was computed against the run's input
  state, which may be older than `current`. Practical approach: keep the last **sent**
  state (`lastSentState`), apply the delta to *that* to reconstruct the agent's view,
  then run `mergeOwned(current, agentView)` to get the new local state. Document this
  reasoning — it is the subtle part of the feature.
- On `null` (patch failure): log a warning with the current state and the patch (as the
  AG-UI docs recommend), keep the UI as-is, and set a `needsResync` flag. FE-13 renders a
  subtle "resyncing…" hint; the next user message triggers a fresh run whose initial
  snapshot re-establishes the baseline (FR-S-02's prescribed recovery).
- Convert numeric JSON-pointer segments to array indices automatically —
  `fast-json-patch` does this when the target is an array; assert it in a test with an
  `add` to `/context/selectedIds/-`.

### 4.5 Persistence (FR-AI-20, OPEN-10)

`src/agui/persistence.ts`, **sessionStorage** only:

| Key | Value | Restored on load |
|---|---|---|
| `agui.threadId` | thread id | FE-08 |
| `agui.state` | last sent **and** last applied `CoworkState` | re-sent on the next run |
| `agui.pendingApproval` | `{ interruptId, tool, args, summary, reason, messageId, createdAt }` | FE-12 re-offers the card |

- Never persist the transcript (decided in FE-09) or the draft (OPEN-10).
- Write on every state change, debounced 300 ms; read once at store init.
- Wrap all access in `try/catch` — Safari private mode and quota errors must not break
  the app. Provide `clearPersisted()` used by "New conversation".

### 4.6 `assistant.phase` bookkeeping

Map run phases into the document for the agent's benefit:

| Local run phase | `assistant.phase` |
|---|---|
| idle | `idle` |
| starting / streaming | `thinking` |
| outcome = interrupt (FE-12 owns the card) | `awaiting_confirmation` |
| success | `done` |
| error / stopped | `error` |

The backend may overwrite `assistant.phase`; keep the local phase as the UI source of
truth and only surface the document's value when it differs (FE-13 concern).

## 5. Implementation order

1. `src/utils/dates.ts` (`todayIso`, `formatDate`, `formatRelative` — FE-04 used it too;
   if FE-04 already added it, extend rather than duplicate).
2. `npm install fast-json-patch @types/fast-json-patch`.
3. `src/agui/state.ts`: types → `emptyState` → `coerceState` → `buildState` →
   `mergeOwned` → `applySnapshot` → `applyDelta`.
4. `src/agui/persistence.ts`.
5. Store wiring: send-time `setState`, `onStateSnapshotEvent`, `onStateDeltaEvent`,
   draft bridge to `useTaskDraft`.
6. Tests.

## 6. Tests

`src/__tests__/state-build.spec.ts`
- `buildState` mirrors the store: view, `today` format, taskId, filters, selectedIds,
  `visibleTaskIds` capped at 200 (assert with 250 tasks), `draft` null unless an AI draft
  exists (with `source: 'ai'` and `missing`).
- `assistant.phase` mapping per §4.6 table.

`src/__tests__/state-snapshot.spec.ts`
- incoming `assistant.pendingAction` is adopted; incoming `assistant.phase` is adopted.
- incoming `context` is **ignored** when it differs from ours (FR-S-01), but an agent-written
  `draft` **is** applied (prefill channel) and `useTaskDraft.applyAiDraft` is called once.
- an echo of our own state does not re-apply the draft (FR-S-04 guard).
- incoming `draft: null` does not clear our local draft.
- unknown top-level keys are preserved (FR-S-06) and unknown enum values in `context.view`
  are repaired to `'task-list'` without throwing.
- malformed input (`null`, `"x"`, `{}`) yields `emptyState()` merged with what we had —
  never a throw.

`src/__tests__/state-delta.spec.ts`
- `[{op:'replace', path:'/assistant/phase', value:'thinking'}]` updates only that field.
- an `add` to `/context/selectedIds/-` appends correctly.
- an atomic failure (bad path) leaves the document untouched and returns `null`.
- **rebase**: with `lastSentState` older than `current`, a delta computed against
  `lastSentState` still produces the right agent-owned fields, and our local `context`
  wins.
- `needsResync` is set on failure and cleared on the next snapshot.

`src/__test__/persistence.spec.ts` → `src/__tests__/persistence.spec.ts`
- writes/reads the three keys; `sessionStorage` throwing is swallowed.
- a restored pending approval survives a simulated reload and is exposed for FE-12.
- `clearPersisted()` empties everything.

## 7. Definition of done

- [ ] Every run sends a freshly built document (assert in a store test that
      `agent.setState` is called before `runAgent`).
- [ ] `context`/`draft` ownership rules are unit-tested in both directions.
- [ ] A failing delta leaves the UI consistent and sets `needsResync`.
- [ ] `fast-json-patch` is the only patching library; version pinned in `package.json`.
- [ ] lint / type-check / vitest pass; `HANDOFF.md` entry appended, stating the
      `todayIso()` UTC-vs-local decision.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (rebase strategy, ownership merge, todayIso UTC) …
**Contract changes** (anything FE-11/FE-12 must know about `needsResync`,
`lastSentState`, persistence keys) …
**Verification** lint / type-check / vitest → …
**Known gaps** …
