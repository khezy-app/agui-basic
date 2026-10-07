# Frontend implementation plan — spec-01 (Task Management)

Derived from `../../feature-spec/01-task-mgnt-feature-spec.md`.

| | |
|---|---|
| Frontend root | `frontend/` |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` |
| Stack | Vue 3.5 + Vite 8 + TypeScript, vue-router 5, Pinia 4, jsdom + Vitest |
| AI client | `@ag-ui/client` 1.0.2 (`HttpAgent`) — **must be added** |

Read this file first. It pins canonical names, the cross-side contracts that the backend
owns, and the order of work.

---

## 1. Task index

| Task | Title | Satisfies spec IDs | Depends on | Blocks | Parallel-safe |
|---|---|---|---|---|---|
| [FE-01](FE-01-scaffold-and-shell.md) | App shell, routing, layout, base styles | FR-F-01, FR-F-02, FR-F-03 (shell) | — | all UI tasks | — |
| [FE-02](FE-02-types-and-api-client.md) | Domain types + typed API client + error handling | FR-F-15, FR-F-16, NFR-8 | FE-01 | FE-03…FE-07 | after FE-01 |
| [FE-03](FE-03-task-store.md) | Task store: query, filters, selection, detail | FR-F-17 | FE-02 | FE-04…FE-06, FE-07 | no |
| [FE-04](FE-04-task-list-page.md) | Task list table, sort, paging, row actions, bulk bar | FR-F-04, FR-F-06, FR-F-07, FR-F-08 | FE-03 | FE-05 | no |
| [FE-05](FE-05-filter-bar-and-url-state.md) | Filter bar + URL query as the source of truth | FR-F-05 | FE-04 | FE-07 | after FE-04 |
| [FE-06](FE-06-task-detail-and-form.md) | Task detail, create/edit form, status control, delete | FR-F-09, FR-F-10, FR-F-11, FR-F-12 | FE-03 | FE-12 | no |
| [FE-07](FE-07-dashboard-page.md) | Dashboard cards, distribution, due-soon deep links | FR-F-13, FR-F-14 | FE-03, FE-05 | demo | after FE-07 deps |
| [FE-08](FE-08-agui-transport.md) | Vite proxy, `@ag-ui/client`, run lifecycle plumbing, feature flag | FR-AI-01, FR-AI-03, FR-AI-04, NFR-4, NFR-9 | FE-02 | FE-09…FE-13 | yes — after FE-02 |
| [FE-09](FE-09-event-reducer-and-transcript.md) | Pure event reducer + transcript store | FR-AI-08, FR-AI-22, FR-AI-23, FR-AI-24, FR-AI-25, FR-AI-26, FR-AI-27, NFR-7 | FE-08 | FE-10…FE-13 | no |
| [FE-10](FE-10-shared-state-sync.md) | Shared state document: schema, snapshot/delta, persistence, context feeding | FR-S-01…FR-S-06, FR-AI-30 | FE-09 | FE-11, FE-12 | no |
| [FE-11](FE-11-client-tools.md) | Client tool declarations + handlers | FR-AI-05…FR-AI-08, §6.2 | FE-06, FE-10 | FE-12, FE-13 | no |
| [FE-12](FE-12-approval-and-interrupt-flow.md) | Approval card, interrupt/resume, bulk status confirm flow | FR-AI-11, FR-AI-15…FR-AI-20, FR-S-01 | FE-11 | FE-13 | no |
| [FE-13](FE-13-cowork-panel-and-cards.md) | AI Cowork panel, composer, transcript UI, tool-result cards | FR-AI-21…FR-AI-23, FR-AI-26 | FE-12 | FE-14 | no |
| [FE-14](FE-14-verification.md) | Frontend verification, coverage audit, demo script support | NFR-5, NFR-6, §7 phase gate | all | — | no |

### Suggested execution order

```
FE-01 ─> FE-02 ─> FE-03 ─> FE-04 ─> FE-05 ─> FE-06 ─> FE-07 ─┐
             │                          │                   │
             └─> FE-08 ─> FE-09 ─> FE-10 ─> FE-11 ─> FE-12 ─┴─> FE-13 ─> FE-14
```

Phase gate (spec §7): **FE-01…FE-07 must be demoable with the AI feature flag off**
before FE-08 starts.

---

## 2. Canonical names (pinned — do not rename)

### 2.1 Files

| Path | Responsibility |
|---|---|
| `src/config.ts` | runtime config: `API_BASE_URL`, `AGUI_URL`, `AGUI_ENABLED` |
| `src/domain/task.ts` | `TaskStatus`, `TaskPriority`, `Task`, `TaskQuery`, `PageResponse`, `TaskStats`, `TeamMember` (wire types) |
| `src/domain/statusFlow.ts` | **mirrored** transition table (OPEN-1) |
| `src/domain/validation.ts` | `validateTask`, `validatePatch`, field-error map mirroring spec §2.1 |
| `src/api/errors.ts` | `ApiError` class, `isApiError`, `toFieldErrors` |
| `src/api/client.ts` | `apiFetch<T>()` — the only place that knows URLs and error shapes |
| `src/api/tasks.ts` | `taskApi`: `list/get/create/patch/remove/changeStatus/bulkStatus/stats` |
| `src/api/team.ts` | `teamApi.list()` |
| `src/stores/tasks.ts` | `useTaskStore` (list query, filters, selection, detail, stats) |
| `src/stores/team.ts` | `useTeamStore` |
| `src/stores/ui.ts` | toasts/banners (`pushToast`, `dismissToast`) |
| `src/composables/confirm.ts` | `useConfirm()` singleton + `ConfirmDialog` host state (`confirm`, `settleConfirm`) |
| `src/composables/useTaskDraft.ts` | **AI draft seam** (`useTaskDraft`): `draft`/`dirtyFields`/`hasDraft`, `applyAiDraft`, `noteUserEdit`, `isAiSupplied`, `setTarget`, `clear` (FR-F-12, FR-S-03, FR-S-04) |
| `src/stores/cowork.ts` | `useCoworkStore` — agent instance, transcript, run status, shared state, pending approval |
| `src/agui/agent.ts` | `getAgent()` singleton `HttpAgent`, `threadId` persistence |
| `src/agui/reducer.ts` | **pure** `reduceEvent(state, event) → state` (NFR-7) |
| `src/agui/transcript.ts` | transcript types + selectors |
| `src/agui/state.ts` | `emptyState()`, `applySnapshot`, `applyDelta`, `mergePreservedKeys` (FR-S-02, FR-S-06) |
| `src/agui/persistence.ts` | session-scoped save/load of the state document + pending approval (FR-AI-20) |
| `src/agui/tools.ts` | client tool JSON Schemas (single declaration site, FR-AI-05) |
| `src/agui/handlers.ts` | tool-name → handler registry returning `ToolMessage`s (FR-AI-06, FR-AI-07) |
| `src/agui/resume.ts` | interrupt payload builders + validation (FE-12 contract) |
| `src/utils/dates.ts` | `todayIso()`, `formatDate`, `formatRelativeTime`, `isOverdueDisplay` |
| `src/utils/query.ts` | URL query ⇄ `TaskQuery` mapping |
| `src/views/DashboardView.vue`, `TaskListView.vue`, `TaskDetailView.vue`, `TaskFormView.vue`, `NotFoundView.vue` |
| `src/components/layout/AppShell.vue`, `SideNav.vue`, `TopBar.vue` |
| `src/components/task/TaskTable.vue`, `TaskFilters.vue`, `TaskForm.vue`, `TaskStatusControl.vue`, `StatusBadge.vue`, `PriorityTag.vue`, `BulkActionBar.vue`, `ConfirmDialog.vue`, `EmptyState.vue`, `LoadingBlock.vue`, `ErrorBlock.vue`, `TaskPagination.vue` |
| `src/components/dashboard/StatCards.vue`, `StatusDistribution.vue`, `PriorityBreakdown.vue`, `DueSoonList.vue` |
| `src/components/cowork/CoworkPanel.vue`, `Composer.vue`, `TranscriptView.vue`, `MessageItem.vue`, `ToolCallItem.vue`, `ReasoningBlock.vue`, `StopButton.vue`, `cards/TaskListCard.vue`, `TaskSummaryCard.vue`, `StatsCard.vue`, `ApprovalCard.vue`, `QuestionCard.vue`, `StatusChangeCard.vue`, `ErrorCard.vue` |
| `src/__tests__/**` | all tests (the ESLint vitest rules are scoped to this glob) |

### 2.2 Conventions

| Concern | Convention |
|---|---|
| SFCs | `<script setup lang="ts">`, Composition API, `defineProps` with types |
| Styling | Scoped CSS in the SFC; CSS custom properties for colours/status badges defined once in `src/assets/main.css` (replace the scaffold styles) |
| State | Pinia setup stores (`defineStore('tasks', () => { … })`) |
| Async | `async`/`await` in actions; components never call `api/*` directly, only stores |
| Errors | Caught in the store, converted to `ApiError`, surfaced by `ui` store toasts |
| Formatting | Prettier: no semicolons, single quotes, width 100, 2-space indent, LF. Run `npm run format` before finishing |
| Lint | `npm run lint` **mutates files** (oxlint --fix then eslint --fix). Run it, then re-read anything it changed |
| Types | `type` over `interface`; no `any` (use `unknown` + narrowing) |
| Tests | `src/**/__tests__/*.spec.ts`, jsdom, `@vue/test-utils` for components, plain vitest for pure modules |
| Dates | Client clock via `todayIso()`; **never** `new Date()` directly in components |

### 2.3 Verification commands

```sh
npm install          # no lockfile is committed
npm run lint         # mutates in place
npm run type-check
npx vitest run       # one-shot
npm run dev          # manual
```
Always verify in that order. Backend must be running for manual checks (see
`../spec-01-be/HANDOFF.md`).

---

## 3. Cross-side contracts (owned by the backend — do not redefine here)

Defined in `../spec-01-be/00-index.md` §3. Read them from there; the summary below is
only so you know what you are coding against.

| Contract | What the frontend must do with it |
|---|---|
| **C1 error envelope** | `{ type, title, status, detail, instance, errors[] }` → `ApiError`; `errors[].field` maps onto form controls; `type` suffix drives branching (`version-conflict`, `illegal-transition`, `unprocessable`) |
| **C2 list envelope** | `{ content, page, size, totalElements, totalPages }` |
| **C3 task shape** | 15 fields incl. server-owned `version` and derived `isOverdue` / `isUnassigned` (never sent back) |
| **C4 status flow** | mirrored in `src/domain/statusFlow.ts`; must stay identical to `TaskStatusMachine` |
| **C5 shared state** | the exact document from spec §5.1; the frontend **owns** it and sends it on every run |
| **C6 approval** | interrupt fields (`reason`, `message`, `metadata`, `responseSchema`) and the resume payload shapes |

Enum wire values are uppercase (`IN_REVIEW`). Labels come from the backend's `label()`
for display; if the frontend needs a label locally, keep a `STATUS_LABEL` map in
`src/domain/task.ts` and add a test asserting it covers all 7 values.

---

## 4. Handoff protocol (mandatory)

Before starting a task, an agent MUST read:

1. `00-index.md` (this file)
2. `HANDOFF.md` — the running log of completed tasks
3. Its own task doc
4. The task docs it `Depends on`

After finishing, append an entry to `HANDOFF.md`:

```markdown
## <TASK-ID> — <title> — <done | partial | blocked> — <YYYY-MM-DD>

**Files added**
- `path` — one line

**Files changed**
- `path` — what changed

**Decisions taken**
- …

**Contract changes** (C1–C6 or §2.1 names)
- …

**Verification performed**
- `npm run lint` → …
- `npm run type-check` → …
- `npx vitest run` → pass/fail + test count
- manual browser check

**Known gaps / follow-ups**
- …
```

Rules:
- Never leave `npm run type-check` or `npx vitest run` failing unless the entry says
  `partial`/`blocked` and explains why.
- One task per agent turn.
- If you must change a pinned name, edit this index in the same change and log it.

---

## 5. Open decisions and spec deviations

| ID | Topic | Decision taken here | Why |
|---|---|---|---|
| OPEN-1 (shared) | Legal-next-status knowledge | Mirror the C4 table in `src/domain/statusFlow.ts` and pin it with a unit test | Spec §3.1 fixes the backend endpoint list; adding an endpoint would contradict it |
| OPEN-7 | Component library | **None.** Hand-rolled SFCs with scoped CSS | No UI library is installed and spec §4 says "standard admin dashboard", not "specific library". Keeps the demo dependency-free |
| OPEN-8 | Toasts | One toast region in `AppShell`, max 3 visible, auto-dismiss 6 s, errors do not auto-dismiss | FR-F-15 without pulling in a notification library |
| OPEN-9 | Optimistic updates | **None** for mutations; refetch after every successful write | FR-AI-17 requires the UI to refresh from the authoritative result, and it keeps one code path for UI-driven and AI-driven mutations |
| OPEN-10 | Draft persistence | The AI draft is **not** persisted to localStorage; only the pending approval and the last state document are (sessionStorage, FR-AI-20) | A half-written form surviving a browser restart is surprising |
| OPEN-11 | Draft vs URL | When a draft arrives while the user is on `/tasks/:id/edit`, the form is patched **in place** without navigation; only a create-draft on a non-form route navigates to `/tasks/new` | FR-F-12 with minimal surprise (no route hijacking) |
| OPEN-12 | Global search box | The top-bar search writes `q` into the task-list URL query and navigates to `/tasks` | One filter mechanism, not two (FR-F-01 + FR-F-05) |
| OPEN-13 | Spec defect | Spec §4.3 `FR-F-12` points at a **`FR-F-30` that does not exist**. Interpreted as `FR-S-03` (a draft never submits) + `FR-F-12` itself | The spec should be amended to fix the cross-reference; until then FE-06 implements both readings, which are identical in effect |

---

## 6. Requirement coverage map

| Spec ID | Task |
|---|---|
| FR-F-01, FR-F-02 | FE-01 |
| FR-F-03 | FE-01 (shell-level), FE-04, FE-06, FE-07 (per-view states) |
| FR-F-04, FR-F-06, FR-F-07, FR-F-08 | FE-04 |
| FR-F-05 | FE-05 |
| FR-F-09, FR-F-10, FR-F-11 | FE-06 |
| FR-F-12 | FE-06 (rendering) + FE-10 (dirty marking) |
| FR-F-13, FR-F-14 | FE-07 |
| FR-F-15 | FE-02 (+ every task surfaces toasts) |
| FR-F-16 | FE-02 |
| FR-F-17 | FE-03 |
| FR-AI-01, FR-AI-03 | FE-08 |
| FR-AI-04 | FE-08 (history ownership), FE-09 (replay) |
| FR-AI-05, FR-AI-06, FR-AI-07, FR-AI-08 | FE-11, FE-09 |
| FR-AI-09, FR-AI-10 | backend only (BE-08) — FE renders their results |
| FR-AI-11 | FE-12 (enforcement is BE-09's) |
| FR-AI-12 | FE-11 (`assigneeName` resolution feedback) |
| FR-AI-13 | FE-06 (draft arrives, nothing is created) |
| FR-AI-14 | FE-12 (one approval per request) |
| FR-AI-15…FR-AI-18 | FE-12 |
| FR-AI-19 | FE-12 (bulk flow calls `POST /api/tasks/bulk-status`) |
| FR-AI-20 | FE-10 (persistence) + FE-12 (restore) |
| FR-AI-21, FR-AI-22 | FE-13 |
| FR-AI-23, FR-AI-24, FR-AI-25, FR-AI-26, FR-AI-27 | FE-09 (reducer), FE-13 (rendering) |
| FR-AI-28…FR-AI-31 | backend prompt (BE-07) — FE supplies `context.today` (FE-10) |
| FR-S-01…FR-S-06 | FE-10 |
| NFR-4 | FE-08 (feature flag) |
| NFR-5, NFR-6, NFR-7 | every task's tests; FE-14 audits |
| NFR-8 | FE-02 |
| NFR-9 | FE-08 (proxy) |
| AC-1.1…AC-1.6 | FE-04, FE-05, FE-06, FE-07, FE-14 |
| AC-2.1…AC-2.10 | FE-06, FE-10, FE-11, FE-12, FE-13, FE-14 |
