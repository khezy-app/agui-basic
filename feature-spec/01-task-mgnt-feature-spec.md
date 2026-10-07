# Feature Spec — AG-UI Cowork Demo: Task Management

| | |
|---|---|
| Status | Draft for review (high-level contract) |
| Scope | `backend/` (Spring Boot 4.1.1, servlet) + `frontend/` (Vue 3 + Vite + TS) |
| Protocol | AG-UI over SSE at `POST /agent` |
| Purpose | Demonstrate that AG-UI can retrofit an **AI Cowork** layer onto an ordinary CRUD feature, not just a greenfield chat app |

This document is the **feature contract**. It defines *what* the system must do and
*which behaviours are guaranteed*, so that implementation detail can be extracted
later into separate backend and frontend task documents. It intentionally does **not**
 prescribe class names, file layout, libraries beyond what the contract requires, or
code.

Requirement IDs (`FR-B-*`, `FR-F-*`, `FR-AI-*`, `FR-S-*`, `NFR-*`) are stable
references for those downstream task documents.

---

## 1. Goals and non-goals

### 1.1 Goals

| ID | Goal |
|---|---|
| G1 | Ship a realistic, self-contained Task Management CRUD backend |
| G2 | Ship a standard admin-dashboard frontend over that backend |
| G3 | Add an **AI Cowork** layer that (a) prefills forms without submitting, (b) assists with status updates through both backend and frontend tools, (c) answers questions about the data — all via AG-UI shared state and tool calls |
| G4 | Keep the AI layer strictly **additive**: with the AI panel closed or the model unavailable, the product must behave identically to a plain CRUD app |
| G5 | Exercise a meaningful slice of AG-UI: shared state (snapshot + delta), client-defined tools, backend tools, tool results, error paths, run lifecycle |

### 1.2 Non-goals

- Authentication, authorization, multi-tenancy. A single implicit "current user" is
  assumed; team members are seeded reference data.
- Real-time multi-user collaboration (no WebSocket, no presence).
- File attachments, comments, activity feed, subtasks.
- Generative UI as a general feature (A2UI / MCP-UI / Open-JSON-UI are out of scope;
  a small fixed set of app-owned cards is rendered from tool results — see §6.7).
- Production hardening of the LLM itself (evals, prompt versioning, cost controls).
- i18n, dark mode, accessibility audit beyond keyboard-reachable forms.

---

## 2. Domain model (authoritative)

### 2.1 Task

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | server-assigned, immutable |
| `title` | string | required, trimmed, 1–160 chars |
| `description` | string \| null | optional, ≤ 4000 chars |
| `status` | enum | required, defaults to `TODO`. One of `BACKLOG`, `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `BLOCKED`, `DONE`, `CANCELLED` |
| `priority` | enum | required, defaults to `MEDIUM`. One of `LOW`, `MEDIUM`, `HIGH`, `URGENT` |
| `assigneeId` | UUID \| null | optional; must reference an existing team member when non-null |
| `reporterId` | UUID \| null | optional; same reference rule |
| `dueDate` | date (ISO `yyyy-MM-dd`) \| null | optional; no restriction relative to today |
| `estimateHours` | decimal \| null | optional, 0 – 999, at most 1 decimal place |
| `tags` | string[] | optional, 0–5 entries, each 1–24 chars, lowercased, de-duplicated |
| `createdAt` | instant | server-assigned |
| `updatedAt` | instant | server-assigned, changes on every mutation |
| `version` | integer | optimistic-lock counter, server-assigned, exposed to clients |

**Derived, not stored** (computed by the backend where needed, never client-authored):
`isOverdue` (`dueDate` earlier than today **and** status not in `DONE`, `CANCELLED`),
`isUnassigned`.

**Status semantics.** The enum is a fixed linear workflow with two side states:

```
BACKLOG → TODO → IN_PROGRESS → IN_REVIEW → DONE
                          ↘ BLOCKED ↗
any → CANCELLED
```

Transitions are constrained by `FR-B-06`. The enum is the single source of truth for
badge colour and for AI tool arguments — no second status vocabulary may exist.

### 2.2 TeamMember (seeded reference data, read-only)

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | fixed seed values |
| `displayName` | string | required |
| `email` | string | required, valid email |
| `role` | enum | `ENGINEER`, `DESIGNER`, `PRODUCT_OWNER`, `QA` |

No CRUD endpoints for `TeamMember` beyond listing.

### 2.3 Invariants

| ID | Invariant |
|---|---|
| INV-1 | A `DONE` task cannot be moved directly to `BACKLOG`; it must pass through `TODO` |
| INV-2 | Moving out of `CANCELLED` requires an explicit "reopen" intent (`PATCH /status` with `reopen=true`) and lands on `TODO` |
| INV-3 | A blocked task must carry a non-empty `description` explaining the blocker (enforced on entering `BLOCKED`) |
| INV-4 | Deleting a task is hard delete, but a task referenced by an AI pending action may be deleted — the AI must re-resolve by `id` and surface "not found" |
| INV-5 | Server is the sole authority for validation, derived fields and timestamps; clients never supply them |

---

## 3. Backend feature contract — Phase 1 (CRUD)

Base path `/api`. All request/response bodies are JSON. All list endpoints return the
standard envelope (§3.6).

### 3.1 Task endpoints

| ID | Endpoint | Behaviour |
|---|---|---|
| FR-B-01 | `GET /api/tasks` | Paged, filtered, sorted list. Filters: `status` (repeatable), `priority` (repeatable), `assigneeId`, `unassigned=true`, `tag`, `q` (case-insensitive substring over title + description), `overdue=true`, `dueWithinDays`, `createdFrom`, `createdTo`. Sorting: `sort` = one of `createdAt`, `updatedAt`, `dueDate`, `title`, `priority`, `status`, optionally `-` prefix for descending, default `-createdAt`. Paging: `page` (0-based), `size` (default 20, max 100). Every filter must combine as AND; array filters combine as OR within themselves |
| FR-B-02 | `GET /api/tasks/{id}` | Single task with derived flags. `404` with error envelope when absent |
| FR-B-03 | `POST /api/tasks` | Create. Server assigns `id`, `version` (1), timestamps. Honors `version`/`id` if sent by an AI tool? **No** — a create payload with a client `id` is rejected (§3.5) |
| FR-B-04 | `PATCH /api/tasks/{id}` | Partial update of *business fields only* (`title`, `description`, `priority`, `assigneeId`, `reporterId`, `dueDate`, `estimateHours`, `tags`). Rejects attempts to set `status` here; status has its own endpoint. Partial semantics: omitted field = unchanged; explicit `null` clears nullable field |
| FR-B-05 | `DELETE /api/tasks/{id}` | Hard delete, returns `204`. `404` if absent, `409` if an AI pending action holds a stale reference **and** the client does not pass `?force=true` (see §6.6) |
| FR-B-06 | `POST /api/tasks/{id}/status` | Body: `{ "status": <enum>, "reopen": false, "expectedVersion": n }`. Validates the transition against §2.3 and INV-3. Returns the updated task |
| FR-B-07 | `POST /api/tasks/bulk-status` | Body: `{ "ids": [...], "status": <enum>, "expectedVersion": {...} }`. All-or-nothing: any invalid transition or missing id fails the whole call. Returns `{ "updated": n, "tasks": [...] }` |
| FR-B-08 | `GET /api/tasks/stats` | Dashboard aggregates in one call: totals per status, per priority, per assignee (with open/overdue counts), `{ overdueTotal, dueThisWeek, unassignedTotal, createdLast7Days }`. Computed over **all** tasks, not the current page |
| FR-B-09 | `GET /api/team-members` | Seeded list, ordered by `displayName` |
| FR-B-10 | — | CORS: the AG-UI endpoint and `/api` must be reachable from the Vite dev origin (`http://localhost:5173`). Either a Vite proxy **or** a backend CORS configuration satisfying `NFR-9` is acceptable, but exactly one documented approach per environment |

### 3.2 Validation and error contract

| ID | Rule |
|---|---|
| FR-B-11 | All §2.1 field rules are enforced server-side and reported as field-level errors, never as a single opaque message |
| FR-B-12 | Every error response uses one envelope: `{ "type", "title", "status", "detail", "instance", "errors": [ { "field", "message" } ] }` (RFC 9457 shaped). `errors` is optional/empty when not field-related |
| FR-B-13 | Status codes: `400` malformed/validation, `404` unknown id, `409` illegal transition / optimistic-lock conflict / blocked delete, `422` unparseable enum or impossible-to-satisfy request, `500` unexpected |
| FR-B-14 | Optimistic locking: mutating endpoints accept optional `expectedVersion`; mismatch → `409` with a `versionConflict` marker so the UI can offer reload-and-retry |

### 3.3 Seed data

| ID | Rule |
|---|---|
| FR-B-15 | On first run (empty store) the backend seeds 6 team members and 40–60 tasks spread across all 7 statuses and 4 priorities, with a mix of overdue, due-this-week, unassigned and tagged tasks, so that every filter and every dashboard card is demonstrable. Seeding is idempotent and must not run when the store already has tasks |

### 3.4 Persistence

| ID | Rule |
|---|---|
| FR-B-16 | Persistence is behind a repository boundary with an in-memory implementation permitted. The contract must be re-satisfiable by a JDBC/JPA implementation without changing controllers or the AI layer |
| FR-B-17 | Search/filter/sort must be applied by the persistence layer, not by loading everything into memory |

### 3.5 AI-tool write safety

| ID | Rule |
|---|---|
| FR-B-18 | Every tool that writes (§6.5, §6.6) must go through the **same** service + validation path as the REST controllers — no bypass, no second set of rules |
| FR-B-19 | Write tools reject unknown fields and any attempt to set server-owned fields (`id`, `version`, `createdAt`, `updatedAt`, derived flags) with a `422` tool error explaining which field is not writable |
| FR-B-20 | Write tools are idempotent where practical: applying the same tool arguments twice must not create duplicate tasks |

### 3.6 List envelope

```json
{ "content": [ /* tasks */ ], "page": 0, "size": 20, "totalElements": 137, "totalPages": 7 }
```

| ID | Rule |
|---|---|
| FR-B-21 | The envelope is stable and is what both the admin UI table and the AI read tool consume, so pagination semantics never diverge between UI and agent |

---

## 4. Frontend feature contract — Phase 1 (admin dashboard)

Standard admin dashboard, Vue 3 + TS, router-based, Pinia store, typed API client.

### 4.1 Shell and navigation

| ID | Requirement |
|---|---|
| FR-F-01 | App shell: persistent left sidebar (Dashboard, Tasks, and later AI Cowork entry), top bar with page title, current-user indicator and a global task-search box |
| FR-F-02 | Routes: `/` (Dashboard), `/tasks` (list), `/tasks/new`, `/tasks/:id` (detail), `/tasks/:id/edit`. Unknown routes render a not-found view, not a blank screen |
| FR-F-03 | Loading, empty, and error states exist for every data-backed view and are visually distinct. Empty task list offers a "Create task" primary action |

### 4.2 Task list

| ID | Requirement |
|---|---|
| FR-F-04 | Tabular list with columns: title (+tag chips), status badge, priority, assignee avatar/name, due date (visually flagged when overdue), updated-at. Column sort is clickable and reflects in the request |
| FR-F-05 | Filter bar covering every `FR-B-01` filter, with active-filter chips and a "clear all". Filters live in the URL query so a filtered view is linkable and survives reload |
| FR-F-06 | Pagination control showing total count and page size selector |
| FR-F-07 | Row click opens detail; checkbox column enables multi-select with a bulk action bar (change status via `FR-B-07`, delete) |
| FR-F-08 | Row-level quick actions: change status inline through a dropdown that only offers legal next statuses, edit, delete (delete requires confirmation) |

### 4.3 Task form

| ID | Requirement |
|---|---|
| FR-F-09 | One form component serves create and edit. Client-side validation mirrors §2.1 exactly, with inline field errors using the `FR-B-12` shape when the server rejects a submission |
| FR-F-10 | Status is edited on a dedicated status control in detail/edit views (never as a free field in the general form), reflecting `FR-B-04` / `FR-B-06` |
| FR-F-11 | Submit is disabled while invalid or in-flight; the form is not reset on failure; a server `409` on status offers reload-and-retry |
| FR-F-12 | The form **renders an AI-supplied draft without submitting it** and clearly marks it as unsaved (see `FR-F-30`) |

### 4.4 Dashboard

| ID | Requirement |
|---|---|
| FR-F-13 | Stat cards: total open, overdue, due this week, unassigned — from `FR-B-08` |
| FR-F-14 | A status-distribution visual and a "my tasks / due soon" list that deep-links into the task list with filters pre-applied |

### 4.5 Shared UI rules

| ID | Requirement |
|---|---|
| FR-F-15 | Every server error surfaces a toast/banner with the `title` + `detail`, plus field errors inline. No silent failures |
| FR-F-16 | The API client is the only place that knows backend URLs and error shapes; stores and components consume typed results |
| FR-F-17 | The task store holds the list query, filters, selection and the loaded detail, and is the single source the UI **and** the AI layer read from |

---

## 5. Shared AI state contract

The agent and the UI exchange exactly one state document over AG-UI shared state.
This is the most important cross-cutting contract in the spec: the frontend sends it
as `RunAgentInput.state` on every run, and the backend emits it back via
`STATE_SNAPSHOT` / `STATE_DELTA`.

### 5.1 Schema

```jsonc
{
  "context": {
    "view": "dashboard | task-list | task-detail | task-form",
    "today": "yyyy-MM-dd",        // client clock, so the model resolves dates the same way
    "taskId": "uuid | null",
    "filters": { "status": [], "priority": [], "assigneeId": null, "q": null, "overdue": false },
    "selectedIds": [],
    "visibleTaskIds": []          // capped, most recent page
  },
  "draft": {                      // the prefill channel — see FR-AI-02
    "task": { "title": "…", "description": null, "status": "TODO", "priority": "HIGH",
              "assigneeId": null, "dueDate": null, "estimateHours": null, "tags": [] } | null,
    "taskId": "uuid | null",      // non-null when the draft edits an existing task
    "source": "ai | user",
    "missing": ["assigneeId"]      // fields the agent could not resolve
  },
  "assistant": {
    "phase": "idle | thinking | awaiting_confirmation | done | error",
    "pendingAction": {            // set when a mutation awaits human approval, see §6.6
      "id": "uuid", "tool": "update_task_status", "summary": "Mark 3 tasks DONE",
      "args": { }, "origin": "assistant-message-id"
    } | null
  }
}
```

### 5.2 Rules

| ID | Rule |
|---|---|
| FR-S-01 | The document is owned by the **frontend**; the backend treats it as read-only context except for `assistant.*`, which it may update |
| FR-S-02 | The frontend applies `STATE_SNAPSHOT` by replacement and `STATE_DELTA` by applying RFC 6902 operations atomically; on patch failure it discards the delta and re-syncs by starting a new run |
| FR-S-03 | Every `draft` change coming from the agent opens/updates the form and marks it dirty, but **never** triggers a create/update request. Submission is always a human action |
| FR-S-04 | When a user edits a draft field that the AI supplied, the change is authoritative — the agent does not overwrite it unless the user asks again |
| FR-S-05 | `visibleTaskIds` is capped (e.g. 200) and is a convenience only; the agent must use the read tool for anything it intends to reason over |
| FR-S-06 | Unknown keys in the state document are preserved, not stripped, so backend and frontend versions may evolve independently |

---

## 6. AI Cowork contract — Phase 2

### 6.1 Transport

| ID | Rule |
|---|---|
| FR-AI-01 | One AG-UI endpoint, `POST /agent`, `text/event-stream` response, served by the AG-UI Spring WebMVC server module. No bespoke chat endpoint may coexist with it |
| FR-AI-02 | The agent is a single `Agent` bean wrapping a Spring AI `ChatClient`, with shared state enabled (`shareState(true)`, delta updates). Registered as a bean explicitly — the auto-registration that lives in the Spring-AI *starter* is not in use |
| FR-AI-03 | Frontend uses `@ag-ui/client` (`HttpAgent`) pointed at `/agent` (or the proxy path). The HTTP agent is the only network path for the assistant |
| FR-AI-04 | Chat history is owned by the frontend (the `messages` array on `RunAgentInput`) and rendered from streamed events; the backend is stateless between runs apart from what the state document carries |

### 6.2 Frontend-defined (client) tools

Client tools are declared by the frontend and sent in `RunAgentInput.tools`. The
agent never executes them; it emits `TOOL_CALL_START/ARGS/END` and the frontend runs
the handler and returns a `ToolMessage`.

| Tool | Args (JSON Schema, abbreviated) | Contract |
|---|---|---|
| `prefill_task_form` | `{ title?, description?, status?, priority?, assigneeName?, dueDate?, estimateHours?, tags?, taskId? }` | Writes §5.1 `draft` into shared state. Must **not** submit. Unknown/unresolvable `assigneeName` is omitted and listed in `draft.missing` rather than guessed. Returns a `ToolMessage` describing what was prefilled and what was still missing |
| `update_task_status` | `{ taskId?, taskIds?, status, reopen? }` | Opens the status confirmation UI for one or many tasks (see §6.6). Requires either `taskId` or `taskIds`. Returns `approved` / `rejected` / `cancelled` |
| `open_task` | `{ taskId }` | Frontend navigates to the task detail route and focuses the row. Returns `ok` or `not_found` |
| `ask_user` | `{ question, options?, allowFreeText? }` | Renders a question card with optional choices; the answer becomes the `ToolMessage` content. This is the **clarification** path for ambiguous requests |

| ID | Rule |
|---|---|
| FR-AI-05 | Client tool schemas are defined once in the frontend and are the only tools advertised in `RunAgentInput.tools`; backend tools are **not** mirrored there |
| FR-AI-06 | Every client tool handler returns a `ToolMessage` with `toolCallId` set and a stable string content contract, so the model can rely on it |
| FR-AI-07 | Handler failures (including "user pressed cancel") return a `ToolMessage` with `error` set — never a silent success |
| FR-AI-08 | Tool calls render in the chat transcript with name, streamed-argument progress, and the result — a tool call is never invisible |

### 6.3 Backend tools (read-only, agent-executed)

Registered on the `ChatClient`; the agent executes them and emits `TOOL_CALL_RESULT`.

| Tool | Args | Contract |
|---|---|---|
| `query_tasks` | `{ q?, status?, priority?, assigneeName?, overdue?, unassigned?, dueWithinDays?, limit? }` | Returns the §3.6 envelope, `limit` default 20 / max 100. The agent's **only** sanctioned way to read task data |
| `get_task` | `{ taskId }` | Returns one task incl. derived flags, or a tool error `not_found` |
| `get_task_stats` | `{}` | Returns the `FR-B-08` aggregate |
| `list_team_members` | `{}` | Name→id mapping so the agent can resolve `assigneeName` to `assigneeId` |

| ID | Rule |
|---|---|
| FR-AI-09 | These tools are read-only and side-effect-free, safe to loop on |
| FR-AI-10 | The agent must not be told about `/api` REST paths; it uses tools only |

### 6.4 Backend tools (write, agent-executed, approval-gated)

| Tool | Args | Contract |
|---|---|---|
| `update_task_status` | `{ taskId \| taskIds[], status, reopen?, reason }` | Requires human approval before execution (§6.6). Returns `{ updated, tasks }` |
| `create_task` | `{ title, description?, status?, priority?, assigneeName?, dueDate?, estimateHours?, tags? }` | Approval-gated. Returns the created task. **Never called to satisfy "prefill my form"** — that is `prefill_task_form` |
| `update_task_fields` | `{ taskId, ...patch }` | Approval-gated. Same field rules as `FR-B-04` |
| `delete_task` | `{ taskId }` | Approval-gated. Destructive: must be called at most once per run and requires explicit `reason` |

| ID | Rule |
|---|---|
| FR-AI-11 | Every write tool requires approval. Approval is not optional and not configurable per-run |
| FR-AI-12 | Write tools resolve names (`assigneeName`) through `list_team_members`; an unresolvable name is a tool error, never a silent `null` |
| FR-AI-13 | The agent must prefer `prefill_task_form` over `create_task` whenever the user's intent is "help me make this task" — the system prompt states this preference explicitly |
| FR-AI-14 | A run may execute at most one approved write per user approval; the loop must not fan out into unrequested mutations |

### 6.5 Human-in-the-loop approval flow

| ID | Rule |
|---|---|
| FR-AI-15 | Before a write tool executes, the UI shows an approval card: a human-readable summary, the resolved argument list, and Approve / Reject buttons. Never a browser-native `confirm()` |
| FR-AI-16 | On **Reject**, the write tool is never called; the agent receives a `ToolMessage` with `error` = rejection reason and is expected to propose an alternative |
| FR-AI-17 | On **Approve**, the tool executes server-side; the resulting `TOOL_CALL_RESULT` is rendered and the affected rows are refreshed in the UI from the authoritative result — not optimistically assumed |
| FR-AI-18 | If the write fails validation or the transition is illegal, the `TOOL_CALL_RESULT` carries `error`, the UI shows it, and the agent is expected to explain or re-plan |

### 6.6 Frontend status-change flow (client-tool path)

Demonstrates the client-tool variant of a status change: the AI prepares, the human
commits.

1. User: *"mark the three login tasks as in review"*.
2. Agent resolves the tasks with `query_tasks`, then calls the **client** tool
   `update_task_status` with `taskIds` and `status`.
3. Frontend renders a bulk confirmation card listing each task with its current and
   target status; illegal transitions are shown as blocked with the reason.
4. User approves → frontend calls `POST /api/tasks/bulk-status` and returns
   `approved` (with per-task outcomes in the tool content).
5. Refresh the list, tell the agent the outcome in the next turn.

| ID | Rule |
|---|---|
| FR-AI-19 | This path must not require any backend write tool; the frontend owns the mutation |
| FR-AI-20 | `assistant.pendingAction` in shared state marks the in-flight approval. The backend is stateless, so the frontend persists the last state document locally (session-scoped) and restores the pending-action card on reload; the card is re-offered, never silently dropped |

### 6.7 Rendered tool output

| ID | Rule |
|---|---|
| FR-AI-21 | A fixed set of app-owned cards may be rendered from tool results: task summary card, task list card, stats card, approval card, question card, error card. The set is fixed in code — the model does not choose components |
| FR-AI-22 | Each card is rendered from the `ToolMessage` content of its own message id, coexisting with the assistant's follow-up text |

### 6.8 Run lifecycle and errors

| ID | Rule |
|---|---|
| FR-AI-23 | The UI renders `RUN_STARTED` → (text / reasoning / tool calls / state) → `RUN_FINISHED`, and surfaces `RUN_ERROR` as an in-transcript error card plus a banner — never a swallowed exception |
| FR-AI-24 | The user can stop an in-flight run; the UI marks the transcript as interrupted and the next run starts fresh |
| FR-AI-25 | A new user message sent while a run is in flight is queued (or rejected with an explicit message), never silently interleaved |
| FR-AI-26 | Streaming text renders incrementally; reasoning content renders collapsed by default and is distinguishable from answer text |
| FR-AI-27 | Argument JSON shown in the UI is parsed defensively — partial/invalid streamed JSON must not break rendering |

### 6.9 Agent behaviour contract (system-prompt level)

| ID | Rule |
|---|---|
| FR-AI-28 | The system prompt names the domain, the status enum and the §2.3 transition rules, so the model never invents a status |
| FR-AI-29 | When intent is ambiguous (which task? which assignee? relative date like "friday"), the agent calls `ask_user` rather than guessing |
| FR-AI-30 | Relative dates are resolved against the current date, which the frontend supplies in shared state (`context.today`) so client and model agree |
| FR-AI-31 | The agent explains its next action in one short sentence before calling a tool, and reports failures honestly rather than claiming success |

---

## 7. Phase boundaries

| | Phase 1 | Phase 2 |
|---|---|---|
| Backend | §3, §2 | §6 agent bean, tools (§6.3, §6.4), approval state |
| Frontend | §4 | §5, §6.2, §6.7, §6.8 |
| Demo value | "it is a normal admin app" | "the same app now has an AI coworker" |

Phasing rule: **Phase 1 must be fully usable and demoable on its own.** No Phase 1
screen may require the AI layer. Phase 2 may add screens and behaviour, and may
extend `POST /api` (e.g. nothing required beyond what Phase 1 already has, except
`FR-B-07` bulk status which Phase 1's list page also uses).

---

## 8. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | List endpoints respond in < 300 ms at seed scale on localhost; AI runs are streaming and show partial output within 2 s of model start |
| NFR-2 | Every mutating backend endpoint is idempotent-safe under retry (PUT/PATCH with `expectedVersion`, POST bodies carry a client-supplied request key where duplication is possible) |
| NFR-3 | Backend logs must never include API keys or full model prompts containing user data |
| NFR-4 | The AI layer is behind one switch (`/agent` availability + frontend feature flag); disabling it leaves the CRUD app fully functional |
| NFR-5 | Frontend: `npm run lint` → `npm run type-check` → `npx vitest run` are green; backend `./gradlew test` is green |
| NFR-6 | Frontend tests live under `src/**/__tests__/` (jsdom). Minimum coverage of this feature: form validation, filter→request mapping, event reducer for AG-UI events, state-delta application |
| NFR-7 | The AG-UI event stream is handled by a single pure reducer in the frontend, unit-testable without a network or a model |
| NFR-8 | No secrets committed; model config comes from `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY` |
| NFR-9 | One documented CORS/proxy strategy per environment, documented in the implementation task doc |
| NFR-10 | Demo must run offline-capable against a local model endpoint (Ollama); no cloud-only feature |

---

## 9. Acceptance criteria

### Phase 1

| ID | Given / When / Then |
|---|---|
| AC-1.1 | Given the seeded store, when I open `/tasks`, then I see a paged, sorted list with badges and working filters for every `FR-B-01` filter |
| AC-1.2 | Given an invalid form, when I submit, then inline field errors appear per `FR-B-12` and nothing is created |
| AC-1.3 | Given an `IN_REVIEW` task, when I try to move it straight to `BACKLOG`, then the API returns `409` and the UI explains the legal next statuses |
| AC-1.4 | Given a blocked filter, when I clear filters, then the request returns to the unfiltered page 0 |
| AC-1.5 | Given 3 selected tasks, when I bulk-change status with one illegal target, then nothing changes and the response names the offending task |
| AC-1.6 | Given the AI panel is never opened, then every screen and endpoint above behaves identically |

### Phase 2

| ID | Given / When / Then |
|---|---|
| AC-2.1 | Given I am on `/tasks/new`, when I type *"create a high priority task called Fix login redirect due friday, tags bug and auth"*, then the form opens **prefilled** and marked unsaved, and **no** task exists in the list until I press Save |
| AC-2.2 | Given a prefill with an unresolved assignee, when it completes, then the form shows the resolved fields, the missing field is called out, and my later manual edit is not overwritten |
| AC-2.3 | Given the task list, when I ask *"what's overdue and blocked?"*, then the answer is grounded in `query_tasks` output and rendered with a task list card |
| AC-2.4 | Given I ask *"mark these three login tasks in review"*, then a bulk confirmation card lists current→target per task, illegal ones are blocked with reasons, and nothing changes until I approve |
| AC-2.5 | Given I reject an approval, then no write occurs and the assistant acknowledges and offers an alternative |
| AC-2.6 | Given an ambiguous request, when I ask *"set it to done"* with no referent, then the agent asks a clarifying question instead of guessing a task |
| AC-2.7 | Given the model is stopped or the endpoint is down, when I run the assistant, then I see a clear error card and the CRUD app is unaffected |
| AC-2.8 | Given I reload the page mid-confirmation, then the pending action is restored from the locally persisted state document and can still be approved or dismissed |
| AC-2.9 | Given any run, when I watch the transcript, then I can see streamed text, each tool call with its arguments and result, and the final state of the run |
| AC-2.10 | Given the agent changes shared state, when I inspect `draft`, then the change is visible in the form and the agent's next turn sees my edits |

---

## 10. Implementation notes (constraints the task docs must respect)

Not implementation detail, but hard constraints that any implementation task must
respect:

1. Backend is Spring Boot **4.1.1 / Java 21 / servlet** with AG-UI wired **without
   starters**: `ag-ui-spring-webmvc-server` (endpoint + auto-config) plus
   `ag-ui-spring-ai`. Never add the WebFlux server or a starter alongside them.
2. Because the `ag-ui-spring-ai-webmvc-boot-starter` is not used, the `Agent` bean must
   be declared explicitly and the `ag-ui.spring-ai.*` properties are **not** read —
   `shareState` / `stateUpdates` must be set on `SpringAiAgent.builder(...)` in code.
3. Frontend must add `@ag-ui/client` (1.0.2) and remove/rewrite the scaffold
   `App.spec.ts` assertion on `You did it!`.
4. The AG-UI Spring servers register no CORS config, so `FR-B-10`/`NFR-9` must be
   solved explicitly.
5. The reference implementation and protocol docs live in a separate AG-UI clone —
   trust its module READMEs over its `docs/sdk/java/**` pages.

---

## 11. Downstream artefacts (to be produced next)

| Doc | Contents |
|---|---|
| `feature-spec/backend-tasks.md` | Requirement-ID → backend task breakdown: domain + persistence, REST contract, validation/error envelope, seed data, agent bean, backend tools, approval state, tests |
| `feature-spec/frontend-tasks.md` | Requirement-ID → frontend task breakdown: shell/routing, stores, API client, list + form + dashboard, AG-UI client wiring, event reducer, shared-state sync, tool handlers, tool-result cards, tests |
| `feature-spec/demo-script.md` | Ordered walkthrough proving each acceptance criterion in §9, incl. the offline Ollama configuration |

Each downstream doc must cite the requirement IDs it satisfies, and must not
introduce behaviour that contradicts this contract without amending it here first.
