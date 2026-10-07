# FE-04 — Task list page

| | |
|---|---|
| Status | Done (2026-10-07) |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §4.2 |
| Satisfies | FR-F-04, FR-F-06, FR-F-07, FR-F-08, part of FR-F-03 |
| Depends on | FE-03 |
| Blocks | FE-05, FE-07 |
| Parallel-safe | No |

## 1. Objective

The main screen: a sortable, paged task table with selection, bulk actions, per-row
quick actions, and distinct loading / empty / error states. AC-1.1 and AC-1.6 become
provable here.

## 2. Context you need before starting

Read FE-01 (shell, tokens, routes), FE-02 (types, `statusFlow`, `ApiError`) and FE-03
(store) reports. You have `useTaskStore` with `tasks`, `query`, `listState`, `listError`,
`selectedIds`, `totalElements`, `totalPages` and every action. FE-05 will add the filter
bar **into this page**; render a `TaskFilters` placeholder slot now.

## 3. Scope

### 3.1 In scope

- [x] `src/views/TaskListView.vue`
- [x] `src/components/task/TaskTable.vue`, `StatusBadge.vue`, `PriorityTag.vue`,
      `BulkActionBar.vue`, `ConfirmDialog.vue`, `EmptyState.vue`, `LoadingBlock.vue`,
      `ErrorBlock.vue`
- [x] `src/components/task/TaskStatusControl.vue` (shared with FE-06 — build it here,
      it is needed by the row quick action)
- [x] `src/__tests__/TaskListView.spec.ts`, `src/__tests__/TaskTable.spec.ts`,
      `src/__tests__/StatusBadge.spec.ts`

### 3.2 Out of scope

- The filter bar contents (FE-05) — render `<TaskFilters />` as a stub component that
  FE-05 replaces.
- URL ⇄ query synchronisation (FE-05). This task reads/writes the store only.
- The dashboard (FE-07), detail/form (FE-06).

## 4. Design

### 4.1 `TaskListView.vue`

```
<h1>Tasks</h1>  [Search within results → q filter]  [TaskFilters stub]  [+ New task]
<LoadingBlock v-if="listState === 'loading' && tasks.length === 0" />
<ErrorBlock   v-else-if="listState === 'error'" :error="listError" @retry="fetchList" />
<EmptyState   v-else-if="tasks.length === 0" />
<TaskTable    v-else />
<BulkActionBar v-if="selectedIds.length > 0" />
<Pagination />
```

- `onMounted` → `tasks.setView('task-list')` and `fetchList()` if `listState === 'idle'`.
- The header shows `{{ totalElements }} task(s)` and, when `isFiltered`, an
  "active filters" summary line (FE-05 fills the chips).
- `+ New task` → `RouterLink to="/tasks/new"`.
- Keep the previous page's rows visible while refetching (only the skeleton shows on a
  cold load) and dim the table with `aria-busy="true"`.

### 4.2 `TaskTable.vue`

Columns (FR-F-04), in order: checkbox · title (+ tag chips) · status · priority ·
assignee · due date · updated · actions.

| Column | Rendering |
|---|---|
| checkbox | header checkbox toggles `selectAll(tasks.map(t => t.id))`; indeterminate state via `:indeterminate` |
| title | `RouterLink` to `/tasks/{id}`; truncated with CSS ellipsis at 2 lines; tag chips (max 3 + `+n`) below |
| status | `<StatusBadge :status="t.status" />` |
| priority | `<PriorityTag :priority="t.priority" />` |
| assignee | `team.byId.get(t.assigneeId)?.displayName ?? 'Unassigned'`; unassigned in muted italic |
| due date | formatted `d MMM yyyy`; **visually flagged** when `t.isOverdue` — red text + a `title="Overdue"` tooltip; `—` when null |
| updated | relative time (`utils/dates.ts`: "3h ago", "2d ago"), `title` = absolute ISO |
| actions | kebab menu: **Change status** (opens `TaskStatusControl`), **Edit**, **Delete** |

- Sortable headers for `title`, `status`, `priority`, `dueDate`, `updatedAt`
  (`createdAt` too if you add a column): click cycles through asc/desc via
  `tasks.setSort(field)`; the active column shows a ▲/▼ and sets `aria-sort`.
  Sort state must be visually derived from `store.query`, not local state.
- Row click navigates to the detail route **unless** the click originated in the
  checkbox or the actions cell (`event.target.closest('a,button,input')` guard).
- Keyboard: every interactive cell is a real `button`/`a`/`input`; no `div` handlers.
- Empty `<tbody>` never renders — `EmptyState` handles it.

### 4.3 `TaskStatusControl.vue` (reused by FE-06)

```vue
<select :value="task.status" :disabled="disabled" @change="onPick">
  <option v-for="s in options" :value="s">{{ STATUS_LABEL[s] }}</option>
</select>
```
- `options` = `allowedTargets(task.status)`; if empty (`CANCELLED`) render a
  **Reopen as To-do** button instead (INV-2, `reopen: true`).
- If the current status is not itself in `options`, prepend it as the disabled first
  option labelled `"{current} (current)"` so the select shows the truth.
- On pick → `tasks.changeStatus(task.id, status, false)`. While in flight, disable the
  control and mark the row `aria-busy`.
- On failure the control snaps back to `task.status` and the store has already toasted
  the backend's `detail` (AC-1.3). Do not optimistically change it (OPEN-9).

### 4.4 `BulkActionBar.vue`

Appears when `selectedIds.length > 0`; sticky to the bottom of the list.

- Text: "N selected" + **Clear**.
- **Change status…** → a small inline panel (not a modal) listing the selected tasks'
  current statuses and a target `<select>` built from the **intersection** of legal
  targets across the selection, with an explanatory line when the intersection is empty
  ("These tasks cannot all move to IN_REVIEW: 2 of them are already DONE"). This mirrors
  the AI bulk confirmation card (FE-12) so the two flows look the same.
- Confirm → `tasks.bulkChangeStatus(...)`; the panel stays open on failure so the user
  can pick another target, and shows the backend's multi-line `detail` (AC-1.5).
- **Delete selected** → `ConfirmDialog` listing titles, then per-id `deleteTask` calls in
  `Promise.allSettled`; successes are removed from the selection; failures are reported
  individually. Cap the selection at 100 ids (the backend bulk limit) and disable with a
  hint beyond that.

### 4.5 `ConfirmDialog.vue`

Reusable, promise-based:

```ts
export function useConfirm() {
  const state = ref<{ title: string; body: string; confirmLabel: string; danger?: boolean } | null>(null)
  const confirm = () => Promise<boolean>   // resolves via the dialog's events
}
```
Rendered once in `AppShell` (add a `<ConfirmDialog />` host there). Focus the confirm
button on open, `Escape` cancels, `role="dialog" aria-modal="true"`. Never use
`window.confirm` (also required by FR-AI-15 for the AI flow).

### 4.6 Loading / empty / error primitives (FR-F-03)

| Component | Contract |
|---|---|
| `LoadingBlock.vue` | `rows?: number` skeleton lines; `aria-busy`, `role="status"`, visually hidden "Loading tasks" |
| `ErrorBlock.vue` | props `error: ApiError`; shows `title` + `detail` + optional `retry` emit; never a raw stack or JSON |
| `EmptyState.vue` | props `title`, `description`, `actionLabel`, emits `action`; the task list passes "Create task" → `/tasks/new` (FR-F-03) |

Distinguish visually: skeleton (grey blocks) vs empty (icon + copy + CTA) vs error (red
border + retry). All three must be reachable in the demo — see FE-14's checklist for how
to force each.

### 4.7 Pagination

Inline in `TaskListView` (no separate component needed, but keep it in
`src/components/task/Pagination.vue` for reuse): prev/next + "Page X of Y" +
`totalElements` + a `size` `<select>` of 10/20/50/100 bound to `query.size`. Disable
prev/next at the boundaries and clamp on store errors (the store clamps too).

## 5. Implementation order

1. `StatusBadge.vue`, `PriorityTag.vue`, `LoadingBlock.vue`, `ErrorBlock.vue`,
   `EmptyState.vue`.
2. `ConfirmDialog.vue` + `useConfirm` + host in `AppShell`.
3. `TaskStatusControl.vue`.
4. `TaskTable.vue`.
5. `BulkActionBar.vue` + `Pagination.vue`.
6. `TaskListView.vue` (+ `TaskFilters.vue` stub).
7. Tests.

## 6. Tests

`src/__tests__/StatusBadge.spec.ts`
- renders the label for each of the 7 statuses with the matching CSS class.
- an unknown status string falls back to the raw value without crashing.

`src/__tests__/TaskTable.spec.ts` (mount with a stubbed store via `createTestingPinia`,
or a real store with mocked `taskApi` — pick one and be consistent)
- renders one row per task with title, badge, priority, assignee name, due date.
- an overdue task renders the overdue marker; a null due date renders `—`.
- clicking a sortable header calls `setSort` with the field; the active column reflects
  `query.sort`/`query.descending` via `aria-sort`.
- the header checkbox selects all page ids; indeterminate when partially selected.
- clicking a row navigates to `/tasks/{id}`; clicking the checkbox does **not**.
- the status dropdown lists exactly `allowedTargets(task.status)` and not `BACKLOG` for a
  `DONE` task; a `CANCELLED` row shows the reopen affordance (INV-2).

`src/__tests__/TaskListView.spec.ts`
- loading → `LoadingBlock`; error → `ErrorBlock` with title + detail and `retry` refetches;
  empty → `EmptyState` with the create CTA; ready → table.
- a filtered empty result says so distinctly from an unfiltered empty store.
- "N selected" bar appears only with a selection; clearing hides it.

`src/__tests__/BulkActionBar.spec.ts`
- target options are the intersection of legal targets; empty intersection shows the
  explanatory line and disables confirm.
- confirming calls `bulkChangeStatus` with the selected ids, the chosen status and
  `expectedVersions` built from loaded tasks.
- a rejected call keeps the panel open and renders the multi-line detail (AC-1.5).

## 7. Definition of done

- [x] `/tasks` renders every state distinctly; keyboard-reachable throughout.
- [x] Sorting and selection reflect `store.query` / `store.selectedIds`, not local copies.
- [x] No `window.confirm`, no direct `taskApi` usage, no optimistic status change.
- [x] lint / type-check / vitest pass; `HANDOFF.md` entry appended.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (intersection UX, delete strategy, table density) …
**Verification** lint / type-check / vitest → …
**Known gaps** …
